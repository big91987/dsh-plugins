import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { BrowserPreviewService } from './browser-service.ts'
import { resolveBrowserUrl } from './protocol.ts'

const TEXT_OUTPUT = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

function callingSessionId(agent: Agent | undefined): string {
  if (agent === undefined) throw new Error('browser preview tools require a calling Session')
  return agent.id
}

interface SnapshotImageValue {
  snapshot: JsonValue
  image: {
    attachmentId: string
    mediaType: 'image/png'
    bytes: number
    width: number
    height: number
    name?: string
  }
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function imageRef(value: SnapshotImageValue['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(value.attachmentId),
    mediaType: value.mediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...(value.name === undefined ? {} : { name: value.name }),
  }
}

/** Register Agent controls over the same Session page shown in the Web UI. */
export function registerBrowserPreviewTools(ctx: Context, service: BrowserPreviewService): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_preview_open',
    description: 'Open an http/https URL in this Session shared browser and show it in the DSH right panel.',
    parameters: { url: { type: 'string', required: true, description: 'Absolute http/https URL.' } },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => jsonValue(await service.open(callingSessionId(exec.agent), resolveBrowserUrl(args.url))),
    presentCall: args => ({ card: 'generic', title: `Open browser ${args.url}` }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_preview_snapshot',
    description: 'Capture the current viewport of this Session shared browser for visual inspection.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          snapshot: { type: 'json', required: true },
          image: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', const: 'image/png', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value.snapshot, null, 2) },
        { type: 'image', attachment: imageRef(value.image) },
      ],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec): Promise<SnapshotImageValue> {
      const sessionId = callingSessionId(exec.agent)
      const snapshot = await service.snapshot(sessionId)
      if (snapshot === undefined) throw new Error('browser preview is not open for this Session')
      const attachments = ctx.get('attachments')
      if (attachments === undefined) throw new Error('browser snapshot requires the DSH attachment service')
      const bytes = await service.screenshot(sessionId)
      const ref = await attachments.saveImage({ data: bytes, mediaType: 'image/png', name: 'browser-preview.png' })
      return {
        snapshot: jsonValue(snapshot),
        image: {
          attachmentId: ref.attachmentId,
          mediaType: 'image/png',
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...(ref.name === undefined ? {} : { name: ref.name }),
        },
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Inspect browser viewport' }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_preview_inspect',
    description: 'Inspect the DOM element at viewport coordinates in this Session shared browser.',
    parameters: {
      x: { type: 'number', required: true, description: 'Viewport X coordinate in CSS pixels.' },
      y: { type: 'number', required: true, description: 'Viewport Y coordinate in CSS pixels.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => jsonValue(await service.inspectPoint(callingSessionId(exec.agent), args)),
    presentCall: () => ({ card: 'generic', title: 'Inspect browser element' }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'browser_preview_close',
    description: 'Close this Session shared browser page and its DSH right panel.',
    parameters: {},
    output: TEXT_OUTPUT,
    execute: async (_args, exec) => { await service.close(callingSessionId(exec.agent)); return { ok: true } },
    presentCall: () => ({ card: 'generic', title: 'Close browser preview' }),
  })))
}
