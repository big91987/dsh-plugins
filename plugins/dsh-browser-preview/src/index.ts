import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { BrowserPreviewService, PlaywrightBrowserLauncher } from './browser-service.ts'
import { registerBrowserPreviewTools } from './browser-tools.ts'
import { makeBrowserPreviewRoutes } from './host-routes.ts'

export const name = 'dsh-browser-preview'
export const inject = ['tools', 'webServer'] as const

/** Browser process and viewport configuration. */
export interface Config {
  /** Optional Chrome/Chromium executable used instead of an installed channel. */
  executablePath?: string
  /** Shared page viewport width in CSS pixels. */
  viewportWidth?: number
  /** Shared page viewport height in CSS pixels. */
  viewportHeight?: number
}

export const Config: z<Config> = z.object({
  executablePath: z.string(),
  viewportWidth: z.number().min(640).max(3840).default(1280),
  viewportHeight: z.number().min(480).max(2160).default(800),
})

/** Mount the Session browser service, Agent tools, and same-origin Web routes. */
export function apply(ctx: Context, config: Config = {}): void {
  const service = new BrowserPreviewService(
    new PlaywrightBrowserLauncher(config.executablePath),
    { width: config.viewportWidth ?? 1280, height: config.viewportHeight ?? 800 },
  )
  registerBrowserPreviewTools(ctx, service)
  ctx.effect(() => {
    const disposers = makeBrowserPreviewRoutes(service).map(route => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'browser-preview: web routes')
  ctx.effect(() => () => { void service.dispose() }, 'browser-preview: browser lifecycle')
}

export { BrowserPreviewService, PlaywrightBrowserLauncher } from './browser-service.ts'
export type { BrowserLauncher, BrowserRuntime } from './browser-service.ts'
export { BROWSER_PREVIEW_API_PREFIX } from './protocol.ts'
