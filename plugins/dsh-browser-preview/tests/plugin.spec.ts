import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import * as BrowserPreviewPlugin from '../src/index.ts'

describe('dsh-browser-preview plugin lifecycle', () => {
  it('registers four Agent tools and four same-origin browser routes', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const register = vi.fn(() => vi.fn())
    ctx.provide('webServer', { register } as never)

    const fiber = await ctx.plugin(BrowserPreviewPlugin)

    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual([
      'browser_preview_open', 'browser_preview_snapshot', 'browser_preview_inspect', 'browser_preview_close',
    ])
    expect(register).toHaveBeenCalledTimes(4)
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })
})
