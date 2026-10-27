import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewService } from '../src/browser-service.ts'
import { registerBrowserPreviewTools } from '../src/browser-tools.ts'

describe('browser preview Agent tools', () => {
  it('registers the shared-browser surface and addresses the calling Session', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const service = {
      open: vi.fn().mockResolvedValue({ sessionId: 's1', url: 'https://example.com/', title: 'Example', viewport: { width: 1280, height: 800 }, frameRevision: 1, canGoBack: false, canGoForward: false, status: 'ready' }),
    } as unknown as BrowserPreviewService
    registerBrowserPreviewTools(ctx, service)

    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual([
      'browser_preview_open', 'browser_preview_snapshot', 'browser_preview_inspect', 'browser_preview_close',
    ])

    const result = await ctx.tools.execute({
      callId: ToolCallId('open-browser'),
      name: 'browser_preview_open',
      arguments: { url: 'https://example.com' },
      signal: new AbortController().signal,
      agent: { id: SessionId('s1') } as never,
    })
    expect(result.isError).toBe(false)
    expect(service.open).toHaveBeenCalledWith('s1', 'https://example.com/')
  })
})
