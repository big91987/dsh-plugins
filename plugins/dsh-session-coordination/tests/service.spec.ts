import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SessionCoordination } from '../src/service.ts'

function header(id: string, options: Partial<SessionHeader> = {}): SessionHeader {
  return { version: 0, id: SessionId(id), createdAt: 10, cwd: '/project', ...options }
}

function event(seq: number, type: 'turn/start' | 'turn/end' = 'turn/start'): SessionEvent {
  return {
    seq,
    time: 20 + seq,
    type,
    data: type === 'turn/start' ? { turn: 1 } : { turn: 1, reason: { kind: 'completed' } },
  } as SessionEvent
}

function fixture() {
  const ctx = new Context()
  const targetHeader = header('target')
  const storedHeader = header('stored', { createdAt: 1 })
  const targetEvents = [event(0), event(1, 'turn/end')]
  const followup = vi.fn()
  const target = {
    id: targetHeader.id,
    status: 'idle',
    session: { id: targetHeader.id, header: targetHeader, events: targetEvents },
    followup,
  } as unknown as Agent
  const agents = new Map([[target.id, target]])
  const resume = vi.fn()
  ctx.provide('agents', { get: (id: SessionId) => agents.get(id), resume } as never)
  const readSession = vi.fn(async (id: SessionId) => ({
    session: id === targetHeader.id ? targetHeader : storedHeader,
    events: id === targetHeader.id ? targetEvents : [],
  }))
  ctx.provide('sessionQuery', {
    listSessions: vi.fn().mockResolvedValue([
      { header: storedHeader, live: false, persisted: true },
      { header: targetHeader, live: true, persisted: true },
    ]),
    readTitleSnapshots: vi.fn().mockResolvedValue([
      { status: 'fulfilled', sessionId: storedHeader.id, value: { session: storedHeader } },
      { status: 'fulfilled', sessionId: targetHeader.id, value: { session: targetHeader, title: { title: 'Target' } } },
    ]),
    readTitle: vi.fn(async (id: SessionId) => id === targetHeader.id ? { title: 'Target' } : undefined),
    readSession,
  } as never)
  const mount = vi.fn()
  ctx.provide('agentPresets', { mount } as never)
  return { ctx, target, targetHeader, storedHeader, agents, followup, mount, resume, readSession }
}

describe('SessionCoordination list and read', () => {
  it('returns newest-first live and stored rows without resuming either', async () => {
    const { ctx, resume } = fixture()
    const service = new SessionCoordination(ctx)

    await expect(service.listThreads()).resolves.toEqual([
      expect.objectContaining({ threadId: 'target', title: 'Target', status: 'idle', cursor: 1 }),
      expect.objectContaining({ threadId: 'stored', title: 'untitled', status: 'stored', cursor: -1 }),
    ])
    await expect(service.readThread(SessionId('target'), 0)).resolves.toEqual(
      expect.objectContaining({ threadId: 'target', cursor: 1, events: [event(1, 'turn/end')] }),
    )
    expect(resume).not.toHaveBeenCalled()
  })

  it('does not expose subagent-owned task Sessions as peer threads', async () => {
    const { ctx, readSession } = fixture()
    const subagent = header('task', { origin: 'subagent' })
    vi.mocked(ctx.sessionQuery.listSessions).mockResolvedValueOnce([
      { header: subagent, live: false, persisted: true },
    ])
    vi.mocked(ctx.sessionQuery.readTitleSnapshots).mockResolvedValueOnce([])
    const service = new SessionCoordination(ctx)

    await expect(service.listThreads()).resolves.toEqual([])
    readSession.mockResolvedValueOnce({ session: subagent, events: [] })
    await expect(service.readThread(subagent.id)).rejects.toThrow('subagent continuation')
  })
})

describe('SessionCoordination delivery', () => {
  it('delivers an attributed next-turn message to a live peer', async () => {
    const { ctx, followup } = fixture()
    const service = new SessionCoordination(ctx)

    const receipt = await service.sendMessage(SessionId('sender'), SessionId('target'), 'check this')

    expect(receipt.messageId).toBeTruthy()
    expect(followup).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: 'check this' }],
      source: { kind: 'session-relay', form: 'relay', senderSessionId: SessionId('sender') },
    }))
  })

  it('coalesces concurrent cold resumes and owns the resulting handle', async () => {
    const { ctx, target, agents, followup, mount, resume } = fixture()
    agents.delete(target.id)
    const dispose = vi.fn().mockResolvedValue(undefined)
    resume.mockImplementation(async (options: { setup?: (agentCtx: Context) => Promise<void> }) => {
      await options.setup?.(ctx)
      return { agent: target, dispose }
    })
    const service = new SessionCoordination(ctx)

    await Promise.all([
      service.sendMessage(SessionId('sender-a'), target.id, 'one'),
      service.sendMessage(SessionId('sender-b'), target.id, 'two'),
    ])

    expect(resume).toHaveBeenCalledOnce()
    expect(mount).toHaveBeenCalledOnce()
    expect(followup).toHaveBeenCalledTimes(2)
    await service.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('cold-resumes a stored Session with its last routed provider/model so the persona {{model}} variable resolves', async () => {
    const { ctx, target, agents, readSession, resume } = fixture()
    agents.delete(target.id)
    const dispose = vi.fn().mockResolvedValue(undefined)
    const resumeOptions: { resumeSessionId?: unknown; agentOptions?: unknown }[] = []
    resume.mockImplementation(async (options: {
      resumeSessionId?: unknown
      agentOptions?: unknown
      setup?: (agentCtx: Context) => Promise<void>
    }) => {
      resumeOptions.push({ resumeSessionId: options.resumeSessionId, agentOptions: options.agentOptions })
      await options.setup?.(ctx)
      return { agent: target, dispose }
    })
    // The stored Session was last routed on deepseek-official / deepseek-v4-pro.
    readSession.mockResolvedValueOnce({
      session: header('target', { origin: undefined }),
      events: [
        event(0),
        {
          seq: 1,
          time: 30,
          type: 'request/header',
          data: {
            header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
            reason: 'initial',
          },
        } as SessionEvent,
        event(2, 'turn/end'),
      ],
    })
    const service = new SessionCoordination(ctx)

    await service.sendMessage(SessionId('sender'), target.id, 'check this')

    expect(resume).toHaveBeenCalledOnce()
    expect(resumeOptions[0]).toEqual({
      resumeSessionId: target.id,
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    })
  })

  it('cold-resumes without agentOptions when the stored Session has no request/header event', async () => {
    const { ctx, target, agents, readSession, resume } = fixture()
    agents.delete(target.id)
    const dispose = vi.fn().mockResolvedValue(undefined)
    const resumeOptions: { agentOptions?: unknown }[] = []
    resume.mockImplementation(async (options: { agentOptions?: unknown }) => {
      resumeOptions.push({ agentOptions: options.agentOptions })
      return { agent: target, dispose }
    })
    readSession.mockResolvedValueOnce({
      session: header('target', { origin: undefined }),
      events: [event(0), event(1, 'turn/end')],
    })
    const service = new SessionCoordination(ctx)

    await service.sendMessage(SessionId('sender'), target.id, 'check this')

    expect(resume).toHaveBeenCalledOnce()
    expect(resumeOptions[0]).toEqual({ agentOptions: undefined })
  })

  it('rejects cold resumption of a stored subagent Session', async () => {
    const { ctx, target, agents, readSession } = fixture()
    agents.delete(target.id)
    readSession.mockResolvedValueOnce({ session: header('target', { origin: 'subagent' }), events: [] })
    const service = new SessionCoordination(ctx)

    await expect(service.sendMessage(SessionId('sender'), target.id, 'no')).rejects.toThrow('subagent continuation')
  })
})

describe('SessionCoordination wait', () => {
  it('returns immediately for idle targets and wakes when any running target becomes idle', async () => {
    const { ctx, target } = fixture()
    const service = new SessionCoordination(ctx)

    await expect(service.waitThreads([{ threadId: target.id, afterCursor: 1 }], 1_000)).resolves.toHaveLength(1)
    Object.assign(target, { status: 'running' })
    const waiting = service.waitThreads([{ threadId: target.id, afterCursor: 1 }], 1_000)
    Object.assign(target, { status: 'idle' })
    ctx.emit('agent/status', { agent: target, status: 'idle' })
    await expect(waiting).resolves.toEqual([expect.objectContaining({ threadId: 'target', status: 'idle' })])
  })

  it('validates target count and supports a zero-time snapshot', async () => {
    const { ctx, target } = fixture()
    const service = new SessionCoordination(ctx)

    await expect(service.waitThreads([], 0)).rejects.toThrow('1 to 8')
    await expect(service.waitThreads([{ threadId: target.id }], 0)).resolves.toHaveLength(1)
  })
})
