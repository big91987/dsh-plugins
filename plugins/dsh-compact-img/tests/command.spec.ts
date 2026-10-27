import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CommandId, type CommandDefinition, type CommandInvocation } from '@deepseek-ai/dsh-commands'
import { createUserMessage, createAssistantMessage, createToolResultMessage, contentHasImage } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { Session, SessionId, KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { registerCompactImgCommand } from '../src/command.ts'

const sdkRequire = createRequire(realpathSync(new URL('../../../node_modules/@deepseek-ai/dsh/package.json', import.meta.url)))
const { releasedV4SessionFormatCodec: codec, assertReleasedV4Relationships } = await import(pathToFileURL(sdkRequire.resolve('@deepseek-ai/dsh-session-format-v3-to-v4')).href)
function assertNativeHistory(session: Session): void {
  const header = { version: 4, id: session.id, createdAt: 1, isSeeded: false, delegationDepth: 0 }
  const events: ReturnType<Session['snapshotEvents']>[number][] = []
  const context = {
    emitEvent(event: ReturnType<Session['snapshotEvents']>[number]) { events.push(event) },
    emitRun(run: { expand(): ReturnType<Session['snapshotEvents']> }) { events.push(...run.expand()) },
  }
  const decoder = codec.createDecoder(codec.encodeHeader(header, 0), 'strict')
  for (const event of session.snapshotEvents()) decoder.decodeRow(codec.encodeEvent(event), context)
  const inheritedEventCount = decoder.finish(context)
  assertReleasedV4Relationships({ header, inheritedEventCount, events }, KNOWN_SESSION_EVENT_TYPES)
}

function imageSession() {
  const session = Session.create(SessionId('compact-image-session'))
  session.append('user/message', createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'image', attachment: {
      attachmentId: AttachmentId('image-one'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
    } }],
  }), { surfaceOp: 'append' })
  return session
}

function commandFor(ctx: Context): CommandDefinition {
  let definition: CommandDefinition | undefined
  registerCompactImgCommand(ctx, { register(command) { definition = command; return () => {} } })
  return definition!
}

function invocationFor(session: Session): CommandInvocation {
  return {
    commandId: CommandId('compact-command'), rawInput: '', attachments: [],
    signal: new AbortController().signal,
    agent: { id: session.id, session, options: { provider: 'fixture', model: 'vision-fixture' } } as never,
  }
}

describe('compact-img current Session contract', () => {
  it('replaces an image with a durable text checkpoint that survives replay', async () => {
    const ctx = new Context()
    // Only the provider transport is isolated; the Session and durable replay are real.
    ctx.provide('llm', { async *stream() {
      yield { type: 'text-delta', index: 0, text: 'A screenshot shows the save button.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } } as never)
    const session = imageSession()
    const result = await commandFor(ctx).handler(invocationFor(session))
    expect(result.kind).toBe('success')
    assertNativeHistory(session)
    const messages = session.deriveMessages()
    expect(messages).toHaveLength(1)
    expect(contentHasImage(messages[0]!.content)).toBe(false)
    expect(messages[0]!.content).toEqual([{ type: 'text', text: expect.stringContaining('A screenshot shows the save button.') }])
    expect(messages[0]!.source).toMatchObject({ kind: 'compact-checkpoint', sourceCommandId: 'compact-command' })
    const resumed = Session.create(session.id, session.snapshotEvents())
    expect(resumed.deriveMessages()).toEqual(messages)
  })

  it('replaces a balanced tool-call and image-result span without losing its provenance', async () => {
    const ctx = new Context()
    ctx.provide('llm', { async *stream() {
      yield { type: 'text-delta', index: 0, text: 'The image-reading tool returned a save-button screenshot.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } } as never)
    const session = Session.create(SessionId('compact-tool-image-session'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const callId = ToolCallId('read-image')
    const call = session.append('assistant/message', {
      turn: 1, step: 1, stream: [],
      message: createAssistantMessage({
        source: { provider: 'fixture', model: 'vision-fixture' },
        content: [{ type: 'tool-call', id: callId, name: 'read_image', arguments: '{}' }],
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'read_image', arguments: '{}' })
    const resultEvent = session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({ callId, isError: false, content: [{ type: 'image', attachment: {
        attachmentId: AttachmentId('image-one'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
      } }] }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect((await commandFor(ctx).handler(invocationFor(session))).kind).toBe('success')
    const checkpoint = session.snapshotEvents().find(event => event.surfaceOp !== 'append' && event.surfaceOp?.op === 'replace')!
    expect(checkpoint.sourceEventSeqs).toEqual(expect.arrayContaining([call.seq, resultEvent.seq]))
    assertNativeHistory(session)
    const messages = session.deriveMessages()
    expect(messages).toHaveLength(1)
    expect(contentHasImage(messages[0]!.content)).toBe(false)
    expect(Session.create(session.id, session.snapshotEvents()).deriveMessages()).toEqual(messages)
  })

  it('keeps image history intact when the provider fails before replacement', async () => {
    const ctx = new Context()
    ctx.provide('llm', { async *stream() {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'credential rejected' } } }
    } } as never)
    const session = imageSession()
    await expect(commandFor(ctx).handler(invocationFor(session))).rejects.toThrow('credential rejected')
    expect(session.deriveMessages()).toHaveLength(1)
    expect(contentHasImage(session.deriveMessages()[0]!.content)).toBe(true)
  })
})


describe('compact-img surface order and recovery', () => {
  it('sends every visible image in surface order after an earlier replacement', async () => {
    const session = imageSession()
    const original = session.snapshotEvents()[0]!
    const content = session.deriveMessages()[0]!.content
    session.append('user/message', createUserMessage({
      source: { kind: 'user' }, content,
    }), { surfaceOp: 'append' })
    const replacement = session.append('user/message', createUserMessage({
      source: { kind: 'user' }, content,
    }), { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
    expect(session.surface.nodes).toEqual([replacement.seq, 1])
    const summarized: unknown[] = []
    const ctx = new Context()
    ctx.provide('llm', { async *stream(request: { messages: Array<{ content: Parameters<typeof contentHasImage>[0] }> }) {
      summarized.push(...request.messages.filter(message => contentHasImage(message.content)))
      yield { type: 'text-delta', index: 0, text: 'Both visible screenshots.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } } as never)
    expect((await commandFor(ctx).handler(invocationFor(session))).kind).toBe('success')
    expect(summarized).toHaveLength(2)
    assertNativeHistory(session)
    expect(session.deriveMessages().some(message => contentHasImage(message.content))).toBe(false)
    assertNativeHistory(session)
    expect(Session.create(session.id, session.snapshotEvents()).deriveMessages()).toEqual(session.deriveMessages())
  })

  it('closes a failed replacement and lets the original history be retried', async () => {
    const session = imageSession()
    const append = session.append.bind(session)
    const spy = vi.spyOn(session, 'append').mockImplementationOnce((...args: Parameters<typeof session.append>) => append(...args))
    spy.mockImplementation((...args: Parameters<typeof session.append>) => {
      if (args[0] === 'user/message' && typeof args[2]?.surfaceOp === 'object') {
        spy.mockImplementation((...retry: Parameters<typeof session.append>) => append(...retry))
        throw new Error('replacement rejected')
      }
      return append(...args)
    })
    const ctx = new Context()
    ctx.provide('llm', { async *stream() {
      yield { type: 'text-delta', index: 0, text: 'A screenshot.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } } as never)
    await expect(commandFor(ctx).handler(invocationFor(session))).rejects.toThrow('replacement rejected')
    expect(session.snapshotEvents().at(-1)?.type).toBe('compaction/end')
    assertNativeHistory(session)
    expect(contentHasImage(session.deriveMessages()[0]!.content)).toBe(true)
    expect((await commandFor(ctx).handler(invocationFor(session))).kind).toBe('success')
    assertNativeHistory(session)
    expect(Session.create(session.id, session.snapshotEvents()).deriveMessages()).toEqual(session.deriveMessages())
  })
})
