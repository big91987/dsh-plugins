/** HTTP prefix owned by the browser-preview plugin. */
export const BROWSER_PREVIEW_API_PREFIX = '/api/browser-preview'

/** Browser viewport in CSS pixels. */
export interface BrowserViewport {
  readonly width: number
  readonly height: number
}

/** Current user-visible browser state. */
export interface BrowserSnapshot {
  readonly sessionId: string
  readonly url: string
  readonly title: string
  readonly viewport: BrowserViewport
  readonly frameRevision: number
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly status: 'idle' | 'loading' | 'ready' | 'failed'
  readonly error?: string
}

/** Viewport coordinate in CSS pixels. */
export interface ViewportPoint {
  readonly x: number
  readonly y: number
}

/** Compact DOM information returned for an annotated element. */
export interface ElementTarget {
  readonly tagName: string
  readonly selector: string
  readonly text: string
  readonly outerHtml: string
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}

export type MouseEventKind = 'move' | 'down' | 'up'
export type MouseButton = 'none' | 'left' | 'middle' | 'right'

/** Browser input admitted at the Host HTTP boundary. */
export type BrowserInput =
  | { readonly kind: 'mouse'; readonly event: MouseEventKind; readonly x: number; readonly y: number; readonly button: MouseButton }
  | { readonly kind: 'wheel'; readonly x: number; readonly y: number; readonly deltaX: number; readonly deltaY: number }
  | { readonly kind: 'key'; readonly event: 'down' | 'up'; readonly key: string; readonly text?: string }

/** Browser command posted by the Web client. */
export type BrowserCommand =
  | { readonly kind: 'navigate'; readonly sessionId: string; readonly url: string }
  | { readonly kind: 'back' | 'forward' | 'reload' | 'close'; readonly sessionId: string }
  | ({ readonly sessionId: string } & BrowserInput)
  | { readonly kind: 'inspect'; readonly sessionId: string; readonly x: number; readonly y: number }

/** Event emitted to one Session's Web clients. */
export type BrowserPreviewEvent =
  | { readonly kind: 'snapshot'; readonly snapshot: BrowserSnapshot }
  | { readonly kind: 'frame'; readonly revision: number }
  | { readonly kind: 'open-panel'; readonly snapshot: BrowserSnapshot }
  | { readonly kind: 'close-panel' }

/** Normalize a supported browser URL or fail at the caller boundary. */
export function resolveBrowserUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('browser preview requires an absolute http/https URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('browser preview accepts only http/https URLs')
  }
  return url.href
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function sessionId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() === value && value !== '' ? value : undefined
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Parse one untrusted client command. */
export function parseBrowserAction(value: unknown): BrowserCommand | undefined {
  const input = record(value)
  if (input === undefined || typeof input.kind !== 'string') return undefined
  const id = sessionId(input.sessionId)
  if (id === undefined) return undefined

  if (input.kind === 'navigate') {
    if (typeof input.url !== 'string') return undefined
    try {
      return { kind: 'navigate', sessionId: id, url: resolveBrowserUrl(input.url) }
    } catch {
      return undefined
    }
  }
  if (input.kind === 'back' || input.kind === 'forward' || input.kind === 'reload' || input.kind === 'close') {
    return { kind: input.kind, sessionId: id }
  }
  if (input.kind === 'inspect') {
    if (!finite(input.x) || !finite(input.y)) return undefined
    return { kind: 'inspect', sessionId: id, x: input.x, y: input.y }
  }
  if (input.kind === 'mouse') {
    if (!finite(input.x) || !finite(input.y)) return undefined
    if (input.event !== 'move' && input.event !== 'down' && input.event !== 'up') return undefined
    const button = input.button ?? 'none'
    if (button !== 'none' && button !== 'left' && button !== 'middle' && button !== 'right') return undefined
    return { kind: 'mouse', sessionId: id, event: input.event, x: input.x, y: input.y, button }
  }
  if (input.kind === 'wheel') {
    if (!finite(input.x) || !finite(input.y) || !finite(input.deltaX) || !finite(input.deltaY)) return undefined
    return { kind: 'wheel', sessionId: id, x: input.x, y: input.y, deltaX: input.deltaX, deltaY: input.deltaY }
  }
  if (input.kind === 'key') {
    if ((input.event !== 'down' && input.event !== 'up') || typeof input.key !== 'string' || input.key === '') return undefined
    if (input.text !== undefined && typeof input.text !== 'string') return undefined
    return { kind: 'key', sessionId: id, event: input.event, key: input.key, ...(input.text === undefined ? {} : { text: input.text }) }
  }
  return undefined
}
