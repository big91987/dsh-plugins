/**
 * `/compact-img`: replace image-bearing spans of session history with a text
 * checkpoint so a text-only model can be selected for the same session.
 *
 * The command scans the current surface for nodes whose content carries an
 * image block (a `read_image` tool result, a pasted user image, ...), expands
 * the span to tool-pairing-balanced boundaries, asks the session's current
 * multi-modal model to condense the span (images included) into text, and
 * replaces the span with that text checkpoint via the durable surface
 * `user/message` replace contract. Afterwards the host image-admission gate
 * (`selectModel` in api-proxy) sees no images in the session history and
 * allows switching to a text-only model.
 *
 * @module dsh-compact-img
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerCompactImgCommand } from './command.ts'

export const name = 'dsh-compact-img'
export const inject = ['commands'] as const

export { findImageSpans, expandToBalancedSpan, nodeHasImage, countImagesInBlocks } from './spans.ts'
export type { ImageSpan } from './spans.ts'
export { registerCompactImgCommand } from './command.ts'
export { compactImgErrorText } from './error.ts'
export type { CompactImgErrorCode } from './error.ts'

/** Register the `/compact-img` human command. */
export function apply(ctx: Context): void {
  registerCompactImgCommand(ctx, ctx.commands)
}
