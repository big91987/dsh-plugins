import {
  BROWSER_PREVIEW_API_PREFIX,
  type BrowserCommand,
  type BrowserPreviewEvent,
  type BrowserSnapshot,
  type ElementTarget,
} from '../protocol.ts'

interface ApiReply<T> { readonly ok: boolean; readonly result?: T; readonly snapshot?: T; readonly error?: string }
type SessionlessCommand = BrowserCommand extends infer Command
  ? Command extends { readonly sessionId: string } ? Omit<Command, 'sessionId'> : never
  : never

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as ApiReply<T>
  if (!response.ok || !body.ok) throw new Error(body.error ?? `browser preview request failed (${response.status})`)
  return (body.result ?? body.snapshot) as T
}

/** Same-origin HTTP/SSE client for one Session browser page. */
export class BrowserPreviewHostApi {
  constructor(readonly sessionId: string) {}

  async state(): Promise<BrowserSnapshot | null> {
    return json<BrowserSnapshot | null>(await fetch(`${BROWSER_PREVIEW_API_PREFIX}/state?sessionId=${encodeURIComponent(this.sessionId)}`, { cache: 'no-store' }))
  }

  async action<T = unknown>(command: SessionlessCommand): Promise<T> {
    return json<T>(await fetch(`${BROWSER_PREVIEW_API_PREFIX}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...command, sessionId: this.sessionId }),
    }))
  }

  frameUrl(revision: number): string {
    return `${BROWSER_PREVIEW_API_PREFIX}/frame?sessionId=${encodeURIComponent(this.sessionId)}&revision=${revision}`
  }

  subscribe(listener: (event: BrowserPreviewEvent) => void): () => void {
    const source = new EventSource(`${BROWSER_PREVIEW_API_PREFIX}/events?sessionId=${encodeURIComponent(this.sessionId)}`)
    source.onmessage = event => {
      try { listener(JSON.parse(event.data) as BrowserPreviewEvent) } catch { /* malformed server event: wait for the next authoritative event */ }
    }
    return () => { source.close() }
  }

  navigate(url: string): Promise<BrowserSnapshot> { return this.action({ kind: 'navigate', url }) }
  inspect(x: number, y: number): Promise<ElementTarget> { return this.action({ kind: 'inspect', x, y }) }
}
