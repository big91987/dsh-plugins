import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { findImageSpans, expandToBalancedSpan, countImagesInBlocks, nodeHasImage } from '../src/spans.ts'

/** Build a fake session surface with events per seq. */
function fakeSession(events: Array<SessionEvent | undefined>): Session {
  const nodes: number[] = []
  events.forEach((event, seq) => {
    if (event !== undefined) nodes.push(seq)
  })
  return {
    events,
    surface: { nodes, replaceGeneration: 0 },
    deriveEventMessage(event: SessionEvent): Message | null {
      if (event.type === 'user/message') return event.data as Message
      if (event.type === 'tool/result') return (event as { data: { message: Message } }).data.message
      return null
    },
  } as unknown as Session
}

function text(seq: number): SessionEvent {
  return {
    seq,
    type: 'user/message',
    data: { role: 'user', content: [{ type: 'text', text: `msg-${seq}` }] },
  } as unknown as SessionEvent
}

function withImage(seq: number): SessionEvent {
  return {
    seq,
    type: 'user/message',
    data: {
      role: 'user',
      content: [
        { type: 'text', text: 'prompt' },
        { type: 'image', attachment: { attachmentId: AttachmentId(`a-${seq}`), mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
      ] as ContentBlock[],
    },
  } as unknown as SessionEvent
}

function toolResultWithImage(seq: number): SessionEvent {
  return {
    seq,
    type: 'tool/result',
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: CallId(`call-${seq}`),
          content: [
            { type: 'text', text: 'read image' },
            { type: 'image', attachment: { attachmentId: AttachmentId(`a-${seq}`), mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
          ] as ContentBlock[],
        }],
      },
    },
  } as unknown as SessionEvent
}

describe('nodeHasImage', () => {
  it('detects a top-level image block', () => {
    const session = fakeSession([text(0), withImage(1)])
    expect(nodeHasImage(session, 1)).toBe(true)
    expect(nodeHasImage(session, 0)).toBe(false)
  })

  it('detects an image nested inside a tool-result', () => {
    const session = fakeSession([toolResultWithImage(0)])
    expect(nodeHasImage(session, 0)).toBe(true)
  })

  it('returns false for absent seqs and non-message events', () => {
    const session = fakeSession([undefined, text(1)])
    expect(nodeHasImage(session, 0)).toBe(false)
    expect(nodeHasImage(session, 99)).toBe(false)
  })
})

describe('findImageSpans', () => {
  it('finds a single contiguous run', () => {
    const session = fakeSession([text(0), withImage(1), withImage(2), text(3)])
    const spans = findImageSpans(session)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toEqual({ start: 1, end: 2, seqs: [1, 2] })
  })

  it('finds multiple runs separated by text', () => {
    const session = fakeSession([withImage(0), text(1), withImage(2)])
    const spans = findImageSpans(session)
    expect(spans).toHaveLength(2)
    expect(spans[0]!.seqs).toEqual([0])
    expect(spans[1]!.seqs).toEqual([2])
  })

  it('finds nested tool-result images', () => {
    const session = fakeSession([toolResultWithImage(0)])
    const spans = findImageSpans(session)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.seqs).toEqual([0])
  })

  it('returns empty when no images', () => {
    const session = fakeSession([text(0), text(1)])
    expect(findImageSpans(session)).toEqual([])
  })
})

describe('expandToBalancedSpan', () => {
  it('keeps a span whose edges are already balanced unchanged', () => {
    // A surface of user messages only has no tool calls, so every cut is
    // balanced; the span [1,1] is returned as-is.
    const session = fakeSession([text(0), withImage(1), text(2)])
    const range = expandToBalancedSpan(session, { start: 1, end: 1, seqs: [1] })
    expect(range).toEqual({ start: 1, end: 1 })
  })

  it('expands a mid-surface span outward when the surface is balanced', () => {
    const session = fakeSession([text(0), text(1), withImage(2), text(3), text(4)])
    const range = expandToBalancedSpan(session, { start: 2, end: 2, seqs: [2] })
    expect(range).toEqual({ start: 2, end: 2 })
  })
})

describe('countImagesInBlocks', () => {
  it('counts top-level and nested images', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'x' },
      { type: 'image', attachment: { attachmentId: AttachmentId('a'), mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
      {
        type: 'tool-result',
        toolCallId: CallId('c'),
        content: [
          { type: 'image', attachment: { attachmentId: AttachmentId('b'), mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
        ],
      },
    ]
    expect(countImagesInBlocks(blocks)).toBe(2)
  })
})
