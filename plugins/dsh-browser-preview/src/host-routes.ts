import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { BrowserPreviewService } from './browser-service.ts'
import { BROWSER_PREVIEW_API_PREFIX, parseBrowserAction, type BrowserCommand } from './protocol.ts'

const BODY_LIMIT = 64 * 1024
const HEARTBEAT_MS = 15_000

function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  return normalized === '::1' || normalized.startsWith('127.') || normalized.startsWith('::ffff:127.')
}

/**
 * Admit same-origin browser traffic delivered by the local DSH server or a
 * local reverse-tunnel process. The Host authority may therefore change on
 * every ngrok run without becoming plugin configuration.
 */
export function isTrustedBrowserPreviewRequest(req: IncomingMessage): boolean {
  if (!isLoopback(req.socket.remoteAddress)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin === 'string') {
    if (typeof host !== 'string') return false
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  return req.headers['sec-fetch-site'] === 'same-origin'
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    const bytes = chunk as Buffer
    length += bytes.length
    if (length > BODY_LIMIT) throw new Error('body-too-large')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function querySessionId(req: IncomingMessage): string | undefined {
  const url = new URL(req.url ?? '/', 'http://dsh.invalid')
  const value = url.searchParams.get('sessionId')
  return value === null || value.trim() !== value || value === '' ? undefined : value
}

/** Execute one validated browser command against the addressed Session. */
export async function dispatchBrowserCommand(service: BrowserPreviewService, command: BrowserCommand): Promise<unknown> {
  switch (command.kind) {
    case 'navigate': return service.navigate(command.sessionId, command.url)
    case 'back': return service.back(command.sessionId)
    case 'forward': return service.forward(command.sessionId)
    case 'reload': return service.reload(command.sessionId)
    case 'close': await service.close(command.sessionId); return { ok: true }
    case 'inspect': return service.inspectPoint(command.sessionId, { x: command.x, y: command.y })
    case 'mouse':
    case 'wheel':
    case 'key': {
      const { sessionId, ...input } = command
      await service.dispatchInput(sessionId, input)
      return { ok: true }
    }
  }
}

/** Build the same-origin state, frame, event, and action routes. */
export function makeBrowserPreviewRoutes(service: BrowserPreviewService): WebRoute[] {
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (isTrustedBrowserPreviewRequest(req)) return true
    json(res, 403, { ok: false, error: 'forbidden' })
    return false
  }

  return [
    {
      kind: 'exact', path: `${BROWSER_PREVIEW_API_PREFIX}/state`, handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!guard(req, res)) return
        const sessionId = querySessionId(req)
        if (sessionId === undefined) return json(res, 400, { ok: false, error: 'session-required' })
        json(res, 200, { ok: true, snapshot: await service.snapshot(sessionId) ?? null })
      },
    },
    {
      kind: 'exact', path: `${BROWSER_PREVIEW_API_PREFIX}/frame`, handler: (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!guard(req, res)) return
        const sessionId = querySessionId(req)
        if (sessionId === undefined) return json(res, 400, { ok: false, error: 'session-required' })
        const frame = service.frame(sessionId)
        if (frame === undefined) return json(res, 404, { ok: false, error: 'frame-not-ready' })
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-frame-revision': String(frame.revision) })
        res.end(frame.bytes)
      },
    },
    {
      kind: 'exact', path: `${BROWSER_PREVIEW_API_PREFIX}/events`, handler: (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
        if (!guard(req, res)) return
        const sessionId = querySessionId(req)
        if (sessionId === undefined) return json(res, 400, { ok: false, error: 'session-required' })
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const push = (event: unknown): void => { res.write(`data: ${JSON.stringify(event)}\n\n`) }
        const unsubscribe = service.subscribe(sessionId, push)
        const heartbeat = setInterval(() => { res.write(': ping\n\n') }, HEARTBEAT_MS)
        const close = (): void => { clearInterval(heartbeat); unsubscribe() }
        req.once('close', close)
        res.once('close', close)
      },
    },
    {
      kind: 'exact', path: `${BROWSER_PREVIEW_API_PREFIX}/action`, handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!guard(req, res)) return
        if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return json(res, 415, { ok: false, error: 'json-required' })
        try {
          const command = parseBrowserAction(await readJson(req))
          if (command === undefined) return json(res, 400, { ok: false, error: 'invalid-action' })
          json(res, 200, { ok: true, result: await dispatchBrowserCommand(service, command) })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          json(res, message === 'body-too-large' ? 413 : 400, { ok: false, error: message })
        }
      },
    },
  ]
}
