import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The Node build transformer is intentionally plain ESM.
import { transformWorkspaceClient } from '../scripts/build-workspace-client.mjs'

describe('rc.6 Workspace compatibility transform', () => {
  it('derives the replacement from the pinned official bundle and adds both continuation actions', async () => {
    const require = createRequire(import.meta.url)
    const official = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-workspace/client'), 'utf8')

    const transformed = transformWorkspaceClient(
      official,
      'var DSHWorktreeRemoteBundle = { default: { package: "dsh-worktree", descriptors: [] } };',
    )

    expect(transformed).toContain('id: "dsh-worktree"')
    expect(transformed).not.toContain('id: "@deepseek-ai/dsh-client-ui-workspace"')
    expect(transformed).toContain('id: "continue-chat"')
    expect(transformed).toContain('id: "continue-worktree"')
    expect(transformed).toContain('"menu.continueChat": "在新聊天中继续"')
    expect(transformed).toContain('"menu.continueWorktree": "在新工作树中继续"')
    expect(transformed).toContain('ctx.remote.$mount(DSH_WORKTREE_REMOTE)')
    expect(transformed).toContain('ctx.get("remote.dshWorktree")')
    expect(transformed).toContain('worktreeRemote.continueInChat')
    expect(transformed).toContain('DSHWorktreeRemoteBundle.default ?? DSHWorktreeRemoteBundle')
    expect(transformed).toContain('ctx.sessions.open(result.value.sessionId)')
    expect(transformed).toContain('function PendingWorktrees')
    expect(transformed).toContain('worktreeRemote.listPending()')
    expect(transformed).toContain('worktreeRemote.retryPending')
    expect(transformed).toContain('worktreeRemote.cancelPending')
    expect(transformed).toContain('worktreeRemote.continuePendingWithoutSetup')
    expect(transformed).toContain('worktreeRemote.dismissPending')
    expect(transformed).toContain('t("pending.action.open")')
    expect(transformed).toContain('(0, react_jsx_runtime.jsx)(PendingWorktrees')
    expect(transformed).toContain('onContextMenu: (e) =>')
    expect(transformed).toContain('new DOMRect(e.clientX, e.clientY, 0, 0)')
    expect(transformed).toContain('getAnchorRect: contextMenuPoint === null ? void 0')
  })
})
