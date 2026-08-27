/**
 * `/compact-img` command implementation: find image-bearing spans on the
 * session surface and replace each span with a text-only checkpoint.
 *
 * The replacement reuses the same durable surface contract as host compaction:
 * a `compaction/start` / `compaction/end` bracket plus a `user/message` node
 * whose `surfaceOp` replaces the span. A `user/message` surface replacement is
 * legal in an idle session (only `tool/result` replacements require an open
 * turn), so a human command can run it directly.
 *
 * @module dsh-compact-img/command
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { createUserMessage, BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, Message } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { findImageSpans, expandToBalancedSpan } from './spans.ts'
import { compactImgErrorText } from './error.ts'

/** Token cap for the image-description request. */
const SUMMARY_MAX_TOKENS = 4096

/** Instruction appended after the replayed span so the model condenses it. */
const CHECKPOINT_INSTRUCTION = [
  'You are condensing an earlier span of an AI coding-assistant conversation that included images.',
  'The images above are part of that span. Replace each image with a concise textual description of what it showed, then condense the whole span into a compact text checkpoint.',
  'Output ONLY the checkpoint text (plain text or Markdown). Keep it short and factual. Do not mention this instruction.',
].join('\n')

/** Preamble marking the replacement as established context. */
const CHECKPOINT_PREAMBLE =
  'This is a text checkpoint replacing an earlier conversation span that contained images. Treat it as established background and continue without restating it.'

/**
 * Return the visible checkpoint text from a completed summary stream.
 * Terminal provider failures take precedence over the empty-output fallback.
 */
export function summarizationText(assembler: BlockAssembler): string {
  const finishError = summarizationFinishError(assembler.finish)
  if (finishError !== undefined) throw finishError

  const text = assembler.blocks()
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
  if (text.length === 0) {
    throw new Error('image summarization produced no text content')
  }
  return text
}

/** Map a terminal summary finish to the provider-owned failure. */
function summarizationFinishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens': {
      const error = new Error(
        'image summarization truncated at the token cap (incomplete checkpoint)',
      ) as Error & { code?: string }
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}

/**
 * Replay the shadowed span's messages (images included) plus the instruction
 * through the session's current routed model, then return the text-only result
 * together with the model route that produced it.
 */
async function describeSpan(
  ctx: Context,
  session: Session,
  shadowedSeqs: readonly number[],
  agent: Agent,
  signal?: AbortSignal,
): Promise<{ text: string; provider: string; model: string }> {
  const llm = ctx.get('llm')
  if (llm === undefined) {
    throw new Error('dsh-compact-img: llm service is not mounted')
  }
  const target = routedTarget(session, agent)
  if (target === undefined) {
    throw new Error(
      'dsh-compact-img: no provider/model available for image summarization; route a request first',
    )
  }
  const header = session.requestHeader()
  const messages: Message[] = [
    ...shadowedSeqs
      .map(seq => session.deriveEventMessage(session.events[seq]!))
      .filter((message): message is Message => message !== null),
    createUserMessage({
      content: [{ type: 'text', text: CHECKPOINT_INSTRUCTION }],
      source: { kind: 'plugin', plugin: 'dsh-compact-img' },
    }),
  ]
  const assembler = new BlockAssembler()
  for await (const chunk of llm.stream({
    provider: target.provider,
    model: target.model,
    messages,
    ...header?.system === undefined ? {} : { system: header.system },
    maxTokens: SUMMARY_MAX_TOKENS,
    sessionId: session.id,
    purpose: 'compaction',
    ...signal === undefined ? {} : { signal },
  })) {
    assembler.push(chunk)
  }
  const text = summarizationText(assembler)
  return { text, provider: target.provider, model: target.model }
}

/** Resolve the model used for summarization: latest routed request, else agent options. */
function routedTarget(
  session: Session,
  agent: Agent,
): { provider: string; model: string } | undefined {
  const header = session.requestHeader()?.config
  if (header !== undefined && header.provider.length > 0 && header.model.length > 0) {
    return { provider: header.provider, model: header.model }
  }
  if (agent.options.provider !== undefined && agent.options.provider.length > 0
    && agent.options.model !== undefined && agent.options.model.length > 0) {
    return { provider: agent.options.provider, model: agent.options.model }
  }
  return undefined
}

/**
 * Replace one image-bearing span with a text checkpoint. Mirrors the host
 * compaction transaction shape: compaction/start → user/message(replace) →
 * compaction/end. The replacement message cites every shadowed node plus the
 * bracket events, so replay keeps full provenance.
 */
async function replaceSpanWithCheckpoint(
  session: Session,
  start: number,
  end: number,
  shadowedSeqs: readonly number[],
  text: string,
  provider: string,
  model: string,
): Promise<number> {
  const compactionId = CompactionId(randomUUID())
  const startEvent = session.append('compaction/start', { compactionId, turn: null })
  const checkpointMessage = createUserMessage({
    content: [
      { type: 'text', text: `${CHECKPOINT_PREAMBLE}\n\n${text}` },
    ],
    source: { kind: 'plugin', plugin: 'dsh-compact-img' },
  })
  const summaryEvent = session.append('compaction/summary', {
    compactionId,
    summary: [{ type: 'text', text }],
    shadowedRange: { start, end },
    shadowedSeqs: [...shadowedSeqs],
    shadowedTokenCount: 0,
    provider,
    model,
    maxTokens: SUMMARY_MAX_TOKENS,
  })
  session.append('user/message', checkpointMessage, {
    surfaceOp: { op: 'replace', start, end },
    sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs],
  })
  session.append('compaction/end', { compactionId, turn: null })
  return shadowedSeqs.length
}

/** Execute `/compact-img` against the invoking agent. */
async function executeCompactImg(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: 'error', text: 'Usage: /compact-img (no arguments)' }
  }
  const session = invocation.agent.session
  try {
    const spans = findImageSpans(session)
    if (spans.length === 0) {
      return { kind: 'success', text: 'No image-bearing history found.' }
    }
    const imageCount = spans.reduce((total, span) => total + span.seqs.length, 0)
    let replacedItems = 0
    for (const span of spans) {
      const range = expandToBalancedSpan(session, span)
      if (range === null) continue
      const shadowed = span.seqs
      const { text, provider, model } = await describeSpan(
        ctx,
        session,
        shadowed,
        invocation.agent,
        invocation.signal,
      )
      replacedItems += await replaceSpanWithCheckpoint(
        session,
        range.start,
        range.end,
        shadowed,
        text,
        provider,
        model,
      )
    }
    return {
      kind: 'success',
      text: `Replaced ${imageCount} image-bearing item(s) across ${spans.length} span(s) with text checkpoints. You can now switch to a text-only model.`,
    }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Compaction cancelled.' }
    if (error instanceof LlmError && error.code === 'UNSUPPORTED_CONTENT') {
      return {
        kind: 'error',
        text: 'The current model cannot see images; switch to a multi-modal model (e.g. kimi-k3) and retry.',
      }
    }
    throw error
  }
}

/** Register the `/compact-img` command. */
export function registerCompactImgCommand(
  ctx: Context,
  commands: {
    register(definition: CommandDefinition): () => void
  },
): void {
  commands.register({
    name: 'compact-img',
    description: 'Replace image-bearing history spans with text summaries so a text-only model can be selected',
    recordInput: false,
    handler: invocation => executeCompactImg(ctx, invocation),
  })
}
