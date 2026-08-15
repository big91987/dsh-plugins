import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as WorktreeProbePlugin from '../src/index.ts'

describe('dsh-worktree host plugin', () => {
  it('provides its probe service for exactly the plugin lifetime', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(WorktreeProbePlugin)
    const services = ctx as Context & {
      dshWorktreeProbe?: { readonly loaded: true }
    }

    expect(services.dshWorktreeProbe).toEqual({ loaded: true })

    await fiber.dispose()

    expect(services.dshWorktreeProbe).toBeUndefined()
  })
})
