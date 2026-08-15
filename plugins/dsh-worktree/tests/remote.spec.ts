import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { WorktreeRemote } from '../src/remote.ts'
import { TYPERT } from '../src/typert.ts'

describe('WorktreeRemote', () => {
  it('publishes only zod-backed strict codecs accepted by the rc.6 loader', () => {
    for (const invocation of TYPERT.invocations) {
      for (const parameter of invocation.parameters) {
        expect(parameter.codec.mode).toBe('strict')
        expect(parameter.codec.typeSymbol).not.toBe('')
        expect(parameter.codec.schema).toHaveProperty('_zod')
      }
      expect(invocation.result.mode).toBe('strict')
      expect(invocation.result.typeSymbol).not.toBe('')
      expect(invocation.result.schema).toHaveProperty('_zod')
    }
  })

  it('delegates browser operations to the scoped Session continuation service', async () => {
    const ctx = new Context()
    const continuation = {
      continueInChat: vi.fn(() => Promise.resolve({ sessionId: 'child-session' })),
      continueInWorktree: vi.fn(() => ({ pendingSessionId: 'pending-1' })),
      pending: vi.fn(() => undefined),
      listPending: vi.fn(() => []),
      retryPending: vi.fn(),
      cancelPending: vi.fn(() => Promise.resolve()),
      continuePendingWithoutSetup: vi.fn(),
      dismissPending: vi.fn(),
    }
    ctx.provide('sessionContinuation', continuation as never)
    const remote = new WorktreeRemote(ctx)
    const signal = new AbortController().signal

    await expect(remote.continueInChat({ sourceSessionId: 'source' }, signal))
      .resolves.toEqual({ sessionId: 'child-session' })
    expect(remote.continueInWorktree({ sourceSessionId: 'source' }))
      .toEqual({ pendingSessionId: 'pending-1' })
    expect(remote.pending('missing')).toBeNull()
    expect(remote.listPending()).toEqual([])
    remote.retryPending({ id: 'pending-1' })
    await remote.cancelPending('pending-1')
    remote.continuePendingWithoutSetup('pending-1')
    remote.dismissPending('pending-1')

    expect(continuation.continueInChat).toHaveBeenCalledWith({ sourceSessionId: 'source', signal })
    expect(continuation.retryPending).toHaveBeenCalledWith('pending-1', undefined)
  })
})
