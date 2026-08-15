import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerTools } from '../src/tools.ts'

const signal = new AbortController().signal

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join('')
}

async function fixture() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const coordination = {
    listThreads: vi.fn().mockResolvedValue([{ threadId: SessionId('peer'), title: 'Peer', status: 'idle', cursor: 3, updatedAt: 10 }]),
    readThread: vi.fn().mockResolvedValue({ threadId: SessionId('peer'), title: 'Peer', status: 'idle', cursor: 3, updatedAt: 10, header: { id: SessionId('peer'), createdAt: 1 }, events: [] }),
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'message-1' }),
    waitThreads: vi.fn().mockResolvedValue([{ threadId: SessionId('peer'), title: 'Peer', status: 'idle', cursor: 4, updatedAt: 11, header: { id: SessionId('peer'), createdAt: 1 }, events: [] }]),
    forkThread: vi.fn().mockResolvedValue({ threadId: SessionId('forked') }),
  }
  ctx.provide('sessionCoordination', coordination as never)
  registerTools(ctx)
  const agent = { id: SessionId('caller'), session: { id: SessionId('caller') } }
  const call = (name: string, args: unknown) => ctx.tools.execute({
    callId: CallId(`call-${name}`),
    name,
    arguments: args,
    signal,
    agent: agent as never,
  })
  return { ctx, coordination, call }
}

describe('Session coordination model tools', () => {
  it('registers and routes five Codex-compatible peer Session tools', async () => {
    const { ctx, coordination, call } = await fixture()
    expect(ctx.tools.schemas().map(schema => schema.name).filter(name => name.endsWith('thread') || name.endsWith('threads')))
      .toEqual(['list_threads', 'read_thread', 'send_message_to_thread', 'wait_threads', 'fork_thread'])

    expect(text(await call('list_threads', {}))).toContain('peer')
    expect(text(await call('read_thread', { thread_id: 'peer', after_cursor: 2 }))).toContain('Peer')
    expect(text(await call('send_message_to_thread', { thread_id: 'peer', message: 'hello' }))).toContain('message-1')
    expect(text(await call('wait_threads', { targets: [{ thread_id: 'peer', after_cursor: 3 }], timeout_ms: 25 }))).toContain('peer')
    expect(text(await call('fork_thread', { thread_id: 'peer', at_seq: 7 }))).toContain('forked')
    expect(coordination.sendMessage).toHaveBeenCalledWith(SessionId('caller'), SessionId('peer'), 'hello', signal)
  })

  it('requires a calling Session for cross-Session delivery', async () => {
    const { ctx } = await fixture()
    const result = await ctx.tools.execute({
      callId: CallId('call-no-agent'),
      name: 'send_message_to_thread',
      arguments: { thread_id: 'peer', message: 'hello' },
      signal,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('calling Session')
  })
})
