import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as WorktreePlugin from '../src/index.ts'

describe('dsh-worktree host plugin', () => {
  it('provides its Worktree service for exactly the plugin lifetime', async () => {
    const ctx = new Context()
    ctx.provide('subprocess', new WorktreePlugin.NodeSetupRuntime())
    const fiber = await ctx.plugin(WorktreePlugin, { worktreeRoot: '/tmp/dsh-worktree-host-spec' })
    const services = ctx as Context & {
      worktrees?: WorktreePlugin.LocalWorktreeManager
    }

    expect(services.worktrees).toBeInstanceOf(WorktreePlugin.LocalWorktreeManager)

    await fiber.dispose()

    expect(services.worktrees).toBeUndefined()
  })
})
