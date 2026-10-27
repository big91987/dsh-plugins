import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { WorktreeRemote } from '../src/remote.ts'
import { TYPERT } from '../src/typert.ts'

describe('WorktreeRemote', () => {
  it('registers its manifest through the real 0.2 Typert loader and validates browser requests', async () => {
    const require = createRequire(import.meta.url)
    const hostRequire = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
    const { validateTypertManifest } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-typert-loader')).href)
    const manifest = validateTypertManifest('dsh-worktree', TYPERT)
    expect(manifest.invocations.map((invocation: { method: string }) => invocation.method)).not.toContain('continueInChat')
    const continuation = manifest.invocations.find((invocation: { method: string }) => invocation.method === 'continueInWorktree')
    const request = continuation.parameters[0].codec.create()
    expect(request.parse({ sourceSessionId: 'source', environment: { name: 'setup', command: 'npm ci' } })).toEqual({ sourceSessionId: 'source', environment: { name: 'setup', command: 'npm ci' } })
    expect(request.safeParse({ sourceSessionId: '' }).success).toBe(false)
    expect(continuation.result.create().parse({ pendingSessionId: 'pending-1' })).toEqual({ pendingSessionId: 'pending-1' })
    const retry = manifest.invocations.find((invocation: { method: string }) => invocation.method === 'retryPending')
    expect(retry.parameters[0].codec.create().parse({ id: 'pending-1' })).toEqual({ id: 'pending-1' })
    expect(retry.result.create().parse(undefined)).toBeUndefined()
  })

  it('delegates browser operations to the scoped Session continuation service', async () => {
    const ctx = new Context()
    const continuation = {
      continueInWorktree: vi.fn(() => ({ pendingSessionId: 'pending-1' })),
      pending: vi.fn(() => undefined),
      listPending: vi.fn(() => []),
      retryPending: vi.fn(),
      cancelPending: vi.fn(() => Promise.resolve()),
      continuePendingWithoutSetup: vi.fn(),
      dismissPending: vi.fn(),
    }
    const worktrees = {
      list: vi.fn(() => Promise.resolve([{
        path: '/managed/abcd/project',
        cwd: '/managed/abcd/project/packages/app',
        repositoryRoot: '/source/project',
      }])),
    }
    ctx.provide('sessionContinuation', continuation as never)
    ctx.provide('worktrees', worktrees as never)
    const remote = new WorktreeRemote(ctx)

    expect(remote.continueInWorktree({ sourceSessionId: 'source' }))
      .toEqual({ pendingSessionId: 'pending-1' })
    expect(remote.pending('missing')).toBeNull()
    expect(remote.listPending()).toEqual([])
    await expect(remote.listWorkspaceMappings()).resolves.toEqual([{
      sourceWorkspacePath: '/source/project/packages/app',
      worktreeWorkspacePath: '/managed/abcd/project/packages/app',
    }])
    remote.retryPending({ id: 'pending-1' })
    await remote.cancelPending('pending-1')
    remote.continuePendingWithoutSetup('pending-1')
    remote.dismissPending('pending-1')

    expect(continuation.continueInWorktree).toHaveBeenCalledWith({ sourceSessionId: 'source' })
    expect(continuation.retryPending).toHaveBeenCalledWith('pending-1', undefined)
    expect(worktrees.list).toHaveBeenCalledOnce()
  })
})
