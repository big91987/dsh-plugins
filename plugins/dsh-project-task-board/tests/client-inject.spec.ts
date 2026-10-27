import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { inject } from '../src/client/index.ts'

describe('task-board Client Cordis capabilities', () => {
  it('authorizes the Remote root and preset namespace read in a real plugin fiber', async () => {
    const root = new Context()
    const presets = { list: async () => ({ ok: true, value: { presets: [] } }) }
    const provider = await root.plugin({ apply(ctx) {
      for (const name of inject) if (name !== 'remote') ctx.provide(name, {})
      ctx.provide('remote', { agentPresets: presets })
    } })
    let read: unknown
    let failure: unknown
    const fiber = await root.plugin({ inject, apply(ctx) {
      try { read = ctx.remote.agentPresets }
      catch (error) { failure = error }
    } })
    try {
      expect(failure).toBeUndefined()
      expect(read).toBe(presets)
    } finally { await fiber.dispose(); await provider.dispose(); await root.fiber.dispose() }
  })
})
