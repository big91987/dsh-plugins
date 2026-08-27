import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The Node build transformer is intentionally plain ESM.
import { projectWorktreeWorkspaces, transformWorkspaceClient } from '../scripts/build-workspace-client.mjs'

describe('0.1.1-rc.2 Workspace compatibility transform', () => {
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

  it('retains the official fork action and adds only the Worktree continuation action', async () => {
    const require = createRequire(import.meta.url)
    const official = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-workspace/client'), 'utf8')

    const transformed = transformWorkspaceClient(
      official,
      'var DSHWorktreeRemoteBundle = { default: { package: "dsh-worktree", descriptors: [] } };',
    )

    expect(transformed).toContain('id: "dsh-worktree"')
    expect(transformed).not.toContain('id: "@deepseek-ai/dsh-client-ui-workspace"')
    expect(transformed).toContain('id: "fork"')
    expect(transformed).toContain('label: t("menu.fork")')
    expect(transformed).not.toContain('id: "continue-chat"')
    expect(transformed).toContain('id: "continue-worktree"')
    expect(transformed).toContain('if (id === "fork") onFork(node.id);')
    expect(transformed).not.toContain('"menu.continueChat": "在新聊天中继续"')
    expect(transformed).toContain('"menu.continueWorktree": "在新工作树中继续"')
    expect(transformed).toContain('ctx.remote.$mount(DSH_WORKTREE_REMOTE)')
    expect(transformed).toContain('ctx.get("remote.dshWorktree")')
    expect(transformed).not.toContain('worktreeRemote.continueInChat')
    expect(transformed).toContain('DSHWorktreeRemoteBundle.default ?? DSHWorktreeRemoteBundle')
    expect(transformed).toContain('ctx.sessions.open(childId)')
    expect(transformed).toContain('function PendingWorktrees')
    expect(transformed).toContain('worktreeRemote.listPending()')
    expect(transformed).toContain('worktreeRemote.listWorkspaceMappings()')
    expect(transformed).toContain('worktreeRemote.retryPending')
    expect(transformed).toContain('worktreeRemote.cancelPending')
    expect(transformed).toContain('worktreeRemote.continuePendingWithoutSetup')
    expect(transformed).toContain('worktreeRemote.dismissPending')
    expect(transformed).not.toContain('t("pending.action.open")')
    expect(transformed).toContain('open(item.sessionId)')
    expect(transformed).toContain('worktreeRemote.dismissPending(item.id)')
    expect(transformed).toContain('autoOpenPendingIds.has(item.id)')
    expect(transformed).toContain('autoOpenPendingIds.add(result.value.pendingSessionId)')
    expect(transformed).toContain('projectWorktreeWorkspaces(rawWorkspaces, worktreeMappings)')
    expect(transformed).toContain('row.worktree')
    expect(transformed).toContain('t("session.worktree")')
    expect(transformed).toContain('style: { display: "inline-flex", flex: "none"')
    expect(transformed).toContain('(0, react_jsx_runtime.jsx)(PendingWorktrees, { open, t, visible: wide })')
    expect(transformed).toContain('onContextMenu: (e) =>')
    expect(transformed).toContain('new DOMRect(e.clientX, e.clientY, 0, 0)')
    expect(transformed).toContain('getAnchorRect: contextMenuPoint === null ? void 0')
  })
})
