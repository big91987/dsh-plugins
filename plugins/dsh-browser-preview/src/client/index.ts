import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { BrowserPreviewEntry } from './BrowserPreview.tsx'

export const inject = ['slots', 'layout'] as const

/** Add the browser button to each Session header and render its right panel. */
export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.session.header.utilities', () => {
    try {
      return ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'browser-preview',
        order: 90,
        label: '浏览器预览',
        inject: () => ({ layout: ctx.layout }),
      }, BrowserPreviewEntry)
    } catch (error) {
      console.error('[dsh-browser-preview] header registration failed', error)
      return () => {}
    }
  })
}
