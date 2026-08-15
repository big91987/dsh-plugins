import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as SessionCoordinationProbePlugin from '../src/index.ts'

describe('dsh-session-coordination host plugin', () => {
  it('provides its probe service for exactly the plugin lifetime', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(SessionCoordinationProbePlugin)
    const services = ctx as Context & {
      dshSessionCoordinationProbe?: { readonly loaded: true }
    }

    expect(services.dshSessionCoordinationProbe).toEqual({ loaded: true })

    await fiber.dispose()

    expect(services.dshSessionCoordinationProbe).toBeUndefined()
  })
})
