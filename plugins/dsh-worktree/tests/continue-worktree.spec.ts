import { describe, expect, it, vi } from 'vitest'
import { WorktreeId } from '../src/brand.ts'
import {
  SessionContinuation,
  type ContinuationHost,
  type ContinuationWorktrees,
} from '../src/continuation/service.ts'
import type { ManagedWorktree } from '../src/types.ts'

function setupHost() {
  const source = {
    session: { id: 'source-session', createdAt: 1, cwd: '/project', agentPreset: 'coding' },
    events: [
      { type: 'turn/start', seq: 0, time: 1 },
      { type: 'user/message', seq: 1, time: 2 },
      { type: 'turn/end', seq: 2, time: 3 },
    ],
  }
  const attachSession = vi.fn(() => Promise.resolve())
  const workspace = { id: 'new-workspace', sessionIds: [] as string[], attachSession }
  const createAgent = vi.fn((_options: Parameters<ContinuationHost['agents']['create']>[0]) => Promise.resolve())
  const host: ContinuationHost = {
    sessionQuery: { readSession: vi.fn(() => Promise.resolve(source)), traceSession: vi.fn() },
    agents: { create: createAgent },
    agentPresets: { mount: vi.fn(() => Promise.resolve()) },
    workspaceRegistry: { list: () => [], create: vi.fn(() => Promise.resolve(workspace)) },
  }
  return { host, createAgent, attachSession }
}

function managed(setup: ManagedWorktree['setup'] = { kind: 'skipped' }): ManagedWorktree {
  return {
    id: WorktreeId('managed-1'),
    path: '/managed/project',
    cwd: '/managed/project',
    repositoryRoot: '/project',
    repositoryCommonDir: '/project/.git',
    sourceHead: 'abc123',
    setup,
  }
}

describe('SessionContinuation.continueInWorktree', () => {
  it('publishes only after Worktree readiness, attaches a new Workspace, and assigns owner', async () => {
    const { host, createAgent, attachSession } = setupHost()
    const setOwner = vi.fn(() => Promise.resolve())
    const worktrees: ContinuationWorktrees = {
      create: vi.fn(async request => {
        request.onUpdate?.({ kind: 'stage', stage: 'creating' })
        return managed()
      }),
      delete: vi.fn(() => Promise.resolve()),
      setOwner,
    }
    const continuation = new SessionContinuation(host, worktrees)

    const { pendingSessionId } = continuation.continueInWorktree({ sourceSessionId: 'source-session' })
    expect(continuation.pending(pendingSessionId)?.stage).toBe('queued')
    await vi.waitFor(() => { expect(continuation.pending(pendingSessionId)?.stage).toBe('published') })

    const snapshot = continuation.pending(pendingSessionId)
    expect(snapshot?.worktree).toEqual(managed())
    expect(snapshot?.sessionId).toMatch(/^session-/)
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      seed: expect.arrayContaining([expect.objectContaining({ type: 'turn/end' })]),
      meta: expect.objectContaining({ cwd: '/managed/project', parentSession: 'source-session' }),
    }))
    expect(host.workspaceRegistry.create).toHaveBeenCalledWith('/managed/project')
    expect(attachSession).toHaveBeenCalledWith(snapshot?.sessionId)
    expect(setOwner).toHaveBeenCalledWith(WorktreeId('managed-1'), snapshot?.sessionId, expect.any(AbortSignal))
  })

  it('retains a usable Worktree after setup failure and can publish it explicitly', async () => {
    const { host } = setupHost()
    const worktrees: ContinuationWorktrees = {
      create: vi.fn(() => Promise.resolve(managed({
        kind: 'completed', exitCode: 7, signal: null, stdout: '', stderr: 'failed\n',
      }))),
      delete: vi.fn(() => Promise.resolve()),
      setOwner: vi.fn(() => Promise.resolve()),
    }
    const continuation = new SessionContinuation(host, worktrees)
    const { pendingSessionId } = continuation.continueInWorktree({ sourceSessionId: 'source-session' })
    await vi.waitFor(() => { expect(continuation.pending(pendingSessionId)?.stage).toBe('failed') })
    expect(continuation.pending(pendingSessionId)).toMatchObject({
      failureKind: 'setup',
      worktree: { id: WorktreeId('managed-1') },
    })

    continuation.continuePendingWithoutSetup(pendingSessionId)
    await vi.waitFor(() => { expect(continuation.pending(pendingSessionId)?.stage).toBe('published') })
    expect(continuation.pending(pendingSessionId)?.continuedWithoutSetup).toBe(true)
    expect(worktrees.create).toHaveBeenCalledOnce()
  })

  it('retries owner assignment without creating or attaching a second child', async () => {
    const { host, createAgent, attachSession } = setupHost()
    let ownerAttempts = 0
    const setOwner = vi.fn(() => {
      ownerAttempts++
      return ownerAttempts === 1 ? Promise.reject(new Error('owner ledger unavailable')) : Promise.resolve()
    })
    const worktrees: ContinuationWorktrees = {
      create: vi.fn(() => Promise.resolve(managed())),
      delete: vi.fn(() => Promise.resolve()),
      setOwner,
    }
    const continuation = new SessionContinuation(host, worktrees)
    const { pendingSessionId } = continuation.continueInWorktree({ sourceSessionId: 'source-session' })
    await vi.waitFor(() => { expect(continuation.pending(pendingSessionId)?.stage).toBe('failed') })
    const childId = continuation.pending(pendingSessionId)?.sessionId
    expect(childId).toMatch(/^session-/)

    continuation.retryPending(pendingSessionId)
    await vi.waitFor(() => { expect(continuation.pending(pendingSessionId)?.stage).toBe('published') })

    expect(continuation.pending(pendingSessionId)?.sessionId).toBe(childId)
    expect(createAgent).toHaveBeenCalledOnce()
    expect(attachSession).toHaveBeenCalledOnce()
    expect(setOwner).toHaveBeenCalledTimes(2)
    expect(worktrees.create).toHaveBeenCalledOnce()
  })
})
