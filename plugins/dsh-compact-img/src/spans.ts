/**
 * Surface-span discovery for `/compact-img`: find the current-surface nodes
 * whose content carries an image block and expand them to a tool-pairing
 * balanced span suitable for `compactSurfaceRegion`.
 *
 * @module dsh-compact-img/spans
 */

import type { Session } from '@deepseek-ai/dsh-session'
import { toolPairingBalancedBefore, toolPairingBalancedAfter } from '@deepseek-ai/dsh-compaction'
import { contentHasImage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** One contiguous run of image-bearing surface nodes. */
export interface ImageSpan {
  /** First surface seq of the run, inclusive. */
  readonly start: number
  /** Last surface seq of the run, inclusive. */
  readonly end: number
  /** Every surface seq in the run, in surface order. */
  readonly seqs: readonly number[]
}

/**
 * Returns true when a session surface node's derived content carries an image.
 * Uses the same recursive `contentHasImage` walk the host image policy uses, so
 * nested tool-result images (a `read_image` tool result) are found.
 */
export function nodeHasImage(session: Session, seq: number): boolean {
  const event = session.events[seq]
  if (event === undefined) return false
  const message = session.deriveEventMessage(event)
  if (message === null) return false
  return contentHasImage(message.content)
}

/**
 * Group the image-bearing surface nodes of a session into contiguous runs.
 * Only nodes present on the current surface are considered; shadowed (already
 * replaced) nodes are skipped by construction because we iterate surface.nodes.
 * @param session - session whose current surface is scanned.
 * @returns runs of image-bearing seqs in surface order; empty when none.
 */
export function findImageSpans(session: Session): ImageSpan[] {
  const nodes = [...session.surface.nodes]
  const runs: ImageSpan[] = []
  let current: number[] | undefined
  for (const seq of nodes) {
    if (nodeHasImage(session, seq)) {
      current ??= []
      current.push(seq)
    } else if (current !== undefined) {
      runs.push(spanOf(current))
      current = undefined
    }
  }
  if (current !== undefined) runs.push(spanOf(current))
  return runs
}

/**
 * Expand an image-bearing span to the widest tool-pairing-balanced boundaries
 * that enclose it, walking outward from the span's edges. This keeps assistant
 * tool-call/result pairs intact, which `compactSurfaceRegion` requires.
 * @param session - session owning the surface.
 * @param span - image-bearing run found by {@link findImageSpans}.
 * @returns the expanded inclusive start/end seqs, or `null` when no balanced
 * enclosing range exists (defensive; a full-session span is always balanced).
 */
export function expandToBalancedSpan(
  session: Session,
  span: ImageSpan,
): { start: number; end: number } | null {
  const nodes = [...session.surface.nodes]
  const startIdx = nodes.indexOf(span.start)
  const endIdx = nodes.lastIndexOf(span.end)
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return null

  let lo = startIdx
  let hi = endIdx
  // Walk outward from the span edges until both boundaries are balanced.
  // A tool-call inside the span with its result outside (or vice versa) keeps
  // widening until the pairing closes; the full surface is always balanced.
  for (let guard = 0; guard <= nodes.length; guard += 1) {
    const loBalanced = toolPairingBalancedBefore(session, nodes[lo]!)
    const hiBalanced = toolPairingBalancedAfter(session, nodes[hi]!)
    if (loBalanced && hiBalanced) return { start: nodes[lo]!, end: nodes[hi]! }
    if (!loBalanced && lo > 0) lo -= 1
    if (!hiBalanced && hi < nodes.length - 1) hi += 1
    if (lo === 0 && hi === nodes.length - 1) break
  }
  // Full-surface span is balanced by construction (tool-pairing invariant).
  return { start: nodes[0]!, end: nodes[nodes.length - 1]! }
}

function spanOf(seqs: number[]): ImageSpan {
  return { start: seqs[0]!, end: seqs[seqs.length - 1]!, seqs: Object.freeze([...seqs]) }
}

/** Count image blocks nested in content (used for reporting). */
export function countImagesInBlocks(blocks: readonly ContentBlock[]): number {
  let count = 0
  for (const block of blocks) {
    if (block.type === 'image') count += 1
    else if (block.type === 'tool-result') count += countImagesInBlocks(block.content)
  }
  return count
}
