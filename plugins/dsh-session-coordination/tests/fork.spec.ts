import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SessionCoordination } from '../src/service.ts'

const source = { version: 0, id: SessionId('source'), createdAt: 1, cwd: '/repo' } as SessionHeader
const events = [
  { seq: 0, time: 1, type: 'turn/start', data: { turn: 1 } },
  { seq: 1, time: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  { seq: 2, time: 3, type: 'session/title', data: { title: 'Source' } },
  { seq: 3, time: 4, type: 'turn/start', data: { turn: 2 } },
] as SessionEvent[]

describe('SessionCoordination fork', () => {
  it('creates a same-directory child from only balanced completed history', async () => {
    const ctx = new Context()
    ctx.provide('agents', {
      get: vi.fn(),
      create: vi.fn(async (options: { setup: (ctx: Context) => Promise<void> }) => {
        await options.setup(ctx)
        return { agent: {}, dispose: vi.fn() }
      }),
    } as never)
    ctx.provide('sessionQuery', {
      readSession: vi.fn().mockResolvedValue({ session: source, events }),
    } as never)
    const mount = vi.fn().mockResolvedValue({ accidental: 'return value must be swallowed' })
    ctx.provide('agentPresets', { mount } as never)
    const attachSession = vi.fn().mockResolvedValue(undefined)
    ctx.provide('workspaceRegistry', {
      list: () => [{ id: 'workspace', sessionIds: [source.id], attachSession }],
    } as never)
    const service = new SessionCoordination(ctx)

    const result = await service.forkThread(source.id, 1)

    expect(result.threadId).toMatch(/^session-/)
    expect(ctx.agents.create).toHaveBeenCalledWith(expect.objectContaining({
      seed: [...events.slice(0, 3), expect.objectContaining({ type: 'session/end-seed', data: { inherited: true } })],
      inheritedEventCount: 3,
      meta: expect.objectContaining({ cwd: '/repo', parentSession: source.id, isSeeded: true }),
    }))
    expect(attachSession).toHaveBeenCalledWith(result.threadId)
  })

  it('rejects a source with no completed turn', async () => {
    const ctx = new Context()
    ctx.provide('agents', { get: vi.fn(), create: vi.fn() } as never)
    ctx.provide('sessionQuery', { readSession: vi.fn().mockResolvedValue({ session: source, events: events.slice(0, 1) }) } as never)
    ctx.provide('agentPresets', { mount: vi.fn() } as never)
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const service = new SessionCoordination(ctx)

    await expect(service.forkThread(source.id)).rejects.toThrow('no completed turn')
  })
})
