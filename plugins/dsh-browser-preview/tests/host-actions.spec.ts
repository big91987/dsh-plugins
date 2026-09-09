import { describe, expect, it } from 'vitest'
import type { BrowserPreviewService } from '../src/browser-service.ts'
import { dispatchBrowserCommand } from '../src/host-routes.ts'

describe('dispatchBrowserCommand', () => {
  it('routes navigation through the Session browser service', async () => {
    const calls: unknown[] = []
    const service = {
      navigate: async (...args: unknown[]) => { calls.push(['navigate', ...args]); return { status: 'ready' } },
    } as unknown as BrowserPreviewService

    const result = await dispatchBrowserCommand(service, {
      kind: 'navigate', sessionId: 's1', url: 'https://example.com/',
    })

    expect(calls).toEqual([['navigate', 's1', 'https://example.com/']])
    expect(result).toEqual({ status: 'ready' })
  })

  it('routes browser input without returning synthetic state', async () => {
    const calls: unknown[] = []
    const service = {
      dispatchInput: async (...args: unknown[]) => { calls.push(args) },
    } as unknown as BrowserPreviewService

    const result = await dispatchBrowserCommand(service, {
      kind: 'wheel', sessionId: 's1', x: 4, y: 5, deltaX: 0, deltaY: 80,
    })

    expect(calls).toEqual([['s1', { kind: 'wheel', x: 4, y: 5, deltaX: 0, deltaY: 80 }]])
    expect(result).toEqual({ ok: true })
  })

  it('returns the real element hit by an inspect command', async () => {
    const service = {
      inspectPoint: async () => ({ tagName: 'BUTTON', selector: '#save', text: 'Save', outerHtml: '<button id="save">Save</button>', rect: { x: 1, y: 2, width: 3, height: 4 } }),
    } as unknown as BrowserPreviewService

    await expect(dispatchBrowserCommand(service, {
      kind: 'inspect', sessionId: 's1', x: 10, y: 20,
    })).resolves.toMatchObject({ selector: '#save' })
  })
})
