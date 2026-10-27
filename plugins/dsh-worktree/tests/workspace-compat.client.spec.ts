import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The Node build transformer is intentionally plain ESM.
import { projectWorktreeWorkspaces, startWorktreePolling, transformWorkspaceClient } from '../scripts/build-workspace-client.mjs'

describe('0.2.0-rc.2 Workspace compatibility transform', () => {
  it('projects managed Worktree Workspaces into their original project, including nested Worktrees', () => {
    const projected = projectWorktreeWorkspaces([
      { workspaceId: 'source', path: '/repo/app', title: 'repo', sessionIds: ['source-session'] },
      { workspaceId: 'first', path: '/managed/one/app', title: 'app', sessionIds: ['first-session'] },
      { workspaceId: 'second', path: '/managed/two/app', title: 'app', sessionIds: ['second-session'] },
    ], [
      { sourceWorkspacePath: '/repo/app', worktreeWorkspacePath: '/managed/one/app' },
      { sourceWorkspacePath: '/managed/one/app', worktreeWorkspacePath: '/managed/two/app' },
    ])

    expect(projected).toEqual([{
      workspaceId: 'source',
      path: '/repo/app',
      title: 'repo',
      sessionIds: ['source-session', 'first-session', 'second-session'],
      worktreeSessionIds: ['first-session', 'second-session'],
    }])
  })

  it('waits for a pending refresh before scheduling the next poll and stops after disposal', async () => {
    const requests: Array<() => void> = []
    const scheduled: Array<() => void> = []
    const cleared: unknown[] = []
    const stop = startWorktreePolling(() => new Promise<void>(resolve => requests.push(resolve)), () => {}, {
      setTimeout: (callback: () => void, milliseconds: number) => { expect(milliseconds).toBe(500); scheduled.push(callback); return 1 },
      clearTimeout: (timer: unknown) => cleared.push(timer),
    })
    expect(requests).toHaveLength(1)
    expect(scheduled).toHaveLength(0)
    requests[0]!()
    await Promise.resolve()
    await Promise.resolve()
    expect(scheduled).toHaveLength(1)
    scheduled[0]!()
    expect(requests).toHaveLength(2)
    stop()
    requests[1]!()
    await Promise.resolve()
    await Promise.resolve()
    expect(scheduled).toHaveLength(1)
    expect(cleared).toEqual([1])
  })

  it('loads with the 0.2 module services and preserves the native Workspace service and fork', async () => {
    const require = createRequire(import.meta.url)
    const official = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-workspace/client'), 'utf8')
    const transformed = transformWorkspaceClient(official, 'var DSHWorktreeRemoteBundle = { default: {} };')
    let plugin: Record<string, any> = {}
    const runtime = {
      '@deepseek-ai/dsh-client-store': {},
      '@deepseek-ai/cordis': { Service: class {} },
      'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }) },
      react: { Component: class {} },
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    // Expose private entry points only inside this test VM, without shipping test APIs.
    const executable = transformed.replace('return module.exports;',
      'Object.assign(module.exports, { UiWorkspaceService, ForkSessionMenuItem, ContinueWorktreeMenuItem }); return module.exports;')
    runInNewContext(executable, { window: { __ModuleLoader__: { load: ({ factory }: any) => {
      plugin = factory((id: keyof typeof runtime) => {
        if (!(id in runtime)) throw new Error(`unsupported 0.2 client import: ${id}`)
        return runtime[id]
      })
    } } } })
    expect(typeof plugin.UiWorkspaceService.prototype.connectWorkspace).toBe('function')
    const nativeForks: string[] = []
    const closed: boolean[] = []
    const fork = plugin.ForkSessionMenuItem({ sessionId: 'source', useMenuOpenState: () => [true, (value: boolean) => closed.push(value)], useShortcuts: (select: any) => select([]), forkSession: (id: string) => nativeForks.push(id), t: (key: string) => key })
    fork.props.onSelect()
    expect(nativeForks).toEqual(['source'])
    expect(closed).toEqual([false])
    const continued: string[] = []
    const continuation = plugin.ContinueWorktreeMenuItem({ sessionId: 'source', useMenuOpenState: () => [true, (value: boolean) => closed.push(value)], continueInWorktree: (id: string) => continued.push(id), t: (key: string) => key })
    continuation.props.onSelect()
    expect(continued).toEqual(['source'])
    expect(closed).toEqual([false, false])
  })
})
