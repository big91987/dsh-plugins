import { describe, expect, it, vi } from 'vitest'
import { SessionContinuation, type ContinuationHost } from '../src/continuation/service.ts'

function sourceLog() {
  return {
    session: { id: 'source-session', createdAt: 1, cwd: '/project', agentPreset: 'coding' },
    events: [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: 2, data: { text: 'build it' } },
      { type: 'turn/end', seq: 2, time: 3, data: { turn: 1 } },
      { type: 'turn/start', seq: 3, time: 4, data: { turn: 2 } },
    ],
  }
}

describe('SessionContinuation.continueInChat', () => {
  it('publishes a same-directory child from cold completed history and attaches its Workspace', async () => {
    const source = sourceLog()
    const attachSession = vi.fn(() => Promise.resolve())
    const create = vi.fn((_options: Parameters<ContinuationHost['agents']['create']>[0]) => Promise.resolve())
    const mount = vi.fn(() => Promise.resolve({ mounted: true }))
    const host: ContinuationHost = {
      sessionQuery: {
        readSession: vi.fn(() => Promise.resolve(source)),
        traceSession: vi.fn(),
      },
      agents: { create },
      agentPresets: { mount },
      workspaceRegistry: {
        list: () => [{ id: 'workspace-1', sessionIds: ['source-session'], attachSession }],
        create: vi.fn(),
      },
    }
    const continuation = new SessionContinuation(host)

    const result = await continuation.continueInChat({ sourceSessionId: 'source-session' })

    expect(result.sessionId).toMatch(/^session-/)
    expect(host.sessionQuery.readSession).toHaveBeenCalledWith('source-session')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: result.sessionId,
      seed: source.events.slice(0, 3),
      meta: {
        cwd: '/project',
        parentSession: 'source-session',
        seedLength: 3,
        agentPreset: 'coding',
      },
    }))
    const setup = create.mock.calls[0]?.[0]?.setup
    expect(setup).toBeTypeOf('function')
    await expect(setup?.({ child: true })).resolves.toBeUndefined()
    expect(mount).toHaveBeenCalledWith({ child: true }, 'coding')
    expect(attachSession).toHaveBeenCalledWith(result.sessionId)
  })

  it('returns the published child identity in an attachment failure', async () => {
    const source = sourceLog()
    const host: ContinuationHost = {
      sessionQuery: { readSession: vi.fn(() => Promise.resolve(source)), traceSession: vi.fn() },
      agents: { create: vi.fn(() => Promise.resolve()) },
      agentPresets: { mount: vi.fn(() => Promise.resolve()) },
      workspaceRegistry: {
        list: () => [{
          id: 'workspace-1',
          sessionIds: ['source-session'],
          attachSession: vi.fn(() => Promise.reject(new Error('ledger unavailable'))),
        }],
        create: vi.fn(),
      },
    }
    const continuation = new SessionContinuation(host)

    await expect(continuation.continueInChat({ sourceSessionId: 'source-session' })).rejects.toMatchObject({
      name: 'ContinuationWorkspaceAttachError',
      workspaceId: 'workspace-1',
      sessionId: expect.stringMatching(/^session-/),
    })
  })
})
