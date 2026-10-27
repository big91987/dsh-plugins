// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserPreviewEntry } from '../src/client/BrowserPreview.tsx'
import { BrowserPreviewHostApi } from '../src/client/host-api.ts'

let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  document.body.innerHTML = '<div id="header"></div><div data-rightbar-col><div id="existing-panel"></div></div>'
  vi.stubGlobal('localStorage', document.defaultView!.localStorage)
  localStorage.clear()
  vi.spyOn(BrowserPreviewHostApi.prototype, 'state').mockResolvedValue(null)
  vi.spyOn(BrowserPreviewHostApi.prototype, 'subscribe').mockReturnValue(() => {})
  root = createRoot(document.querySelector('#header')!)
})

afterEach(async () => {
  await act(async () => root.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-dsh-browser-preview-active')
  document.body.innerHTML = ''
})

describe('DSH 0.2 preview panel', () => {
  it('opens its Session surface in the current rightbar and closes it again', async () => {
    // The shell implements the current ILayout face; old details actions are absent.
    const props = {
      sessionId: 'session-preview',
      layout: { openRightbar: () => {}, closeRightbar: () => {} },
      useInput: (selector: (state: { draft: string }) => unknown) => selector({ draft: '' }),
      inputActions: { setDraft: () => {} },
    } as unknown as ComponentProps<typeof BrowserPreviewEntry>
    await act(async () => root.render(createElement(BrowserPreviewEntry, props)))
    const open = document.querySelector<HTMLButtonElement>('button[aria-label="浏览器预览"]')!
    await act(async () => open.click())
    const column = document.querySelector('[data-rightbar-col]')!
    expect(column.querySelector('[data-dsh-browser-preview]')).not.toBeNull()
    expect(localStorage.getItem('dsh.browser-preview.visible.session-preview')).toBe('1')
    const close = column.querySelector<HTMLButtonElement>('button[aria-label="关闭预览"]')!
    await act(async () => close.click())
    expect(column.querySelector('[data-dsh-browser-preview]')).toBeNull()
    expect(localStorage.getItem('dsh.browser-preview.visible.session-preview')).toBeNull()
  })
})
