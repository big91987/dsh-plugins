import { describe, expect, it, vi } from 'vitest'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { HostExecutionRunner, SessionLaunchError, type HostExecutionServices } from '../src/host-runner.ts'

function task(): TaskRecord {
  return { ...createTask({ title: 'Run me', description: '', prompt: 'do work' }, 1, 'task-a'), workspaceId: 'workspace-a', mode: 'preset-a', permission: 'workspace-write' }
}
function services() {
  return {
    workspace: { list: vi.fn(() => [{ id: 'workspace-a' }]) },
    agentPresets: { list: vi.fn(async () => [{ id: 'preset-a' }]) },
    sessions: {
      create: vi.fn(async (_input: unknown) => ({ sessionId: 'session-a' })),
      rename: vi.fn(async (_input: unknown) => ({ title: 'Run me', seq: 1 })),
      prompt: vi.fn(async (_input: unknown, _signal?: AbortSignal) => ({ accepted: true })),
    },
  }
}
function runner(api: unknown, command?: ConstructorParameters<typeof HostExecutionRunner>[1]) {
  return new HostExecutionRunner(api as HostExecutionServices, command)
}
function event(seq: number, time: number, kind = 'complete') {
  return { event: { type: 'turn/end', seq, time, data: { reason: { kind } } } }
}
function observations(records = [event(10, 1_100)], hasMore = false) {
  const page = vi.fn(async (_request: { beforeSeq?: number; maxMessages?: number }) => ({ records, hasMore }))
  const follow = vi.fn(async function* (_request: unknown, signal: AbortSignal) {
    try { yield { type: 'snapshot', cursor: records[0]?.event.seq ?? 0, records, hasMore } }
    finally { expect(signal.aborted).toBe(false) }
  })
  return { list: vi.fn(async () => ({ items: [{ sessionId: 'session-a', running: false }] })), follow, page }
}

describe('HostExecutionRunner with official controllers', () => {
  it('validates workspace and preset and applies permission before sending the identified prompt', async () => {
    const api = services()
    const execute = vi.fn(async (_id, line: string, signal: AbortSignal) => {
      expect(line).toBe('/permission workspace-write')
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(api.sessions.prompt).not.toHaveBeenCalled()
      return { kind: 'success' as const }
    })
    await expect(runner(api, { execute }).launch(task())).resolves.toBe('session-a')
    expect(api.sessions.create).toHaveBeenCalledWith({ workspaceId: 'workspace-a', agentPreset: 'preset-a' })
    expect(api.sessions.prompt).toHaveBeenCalledWith({ requestId: expect.any(String), sessionId: 'session-a', mode: 'queue', content: [{ type: 'text', text: 'do work' }] }, expect.any(AbortSignal))
    expect(execute).toHaveBeenCalledOnce()
  })
  it('fails closed before creating a session when workspace or preset pins are invalid', async () => {
    const api = services()
    api.workspace.list.mockReturnValue([])
    await expect(runner(api).launch(task())).rejects.toThrow('workspace not found')
    expect(api.sessions.create).not.toHaveBeenCalled()
    api.workspace.list.mockReturnValue([{ id: 'workspace-a' }])
    api.agentPresets.list.mockResolvedValue([])
    await expect(runner(api).launch(task())).rejects.toThrow('agent preset not found')
    api.agentPresets.list.mockResolvedValue([{ id: 'preset-a', broken: 'unavailable' }] as never)
    await expect(runner(api).launch(task())).rejects.toThrow('agent preset is unavailable')
    expect(api.sessions.create).not.toHaveBeenCalled()
  })
  it.each(['absent', 'unacknowledged', 'error', 'throw'] as const)('preserves the created session and sends no prompt when permission is %s', async kind => {
    const api = services()
    const commands = kind === 'absent' ? undefined : { execute: async () => {
      if (kind === 'throw') throw new Error('timed out')
      return kind === 'unacknowledged' ? undefined : { kind: 'error' as const, text: 'denied' }
    } }
    const launch = runner(api, commands).launch(task())
    await expect(launch).rejects.toBeInstanceOf(SessionLaunchError)
    await expect(launch).rejects.toMatchObject({ sessionId: 'session-a' })
    expect(api.sessions.prompt).not.toHaveBeenCalled()
  })
  it('keeps power session state unknown after controller read failure', async () => {
    const api = { sessions: { list: async () => { throw new Error('offline') } } }
    await expect(runner(api).listRunning()).resolves.toEqual({ known: false })
  })
  it('settles the first execution turn and pages with the exact opening cursor', async () => {
    const sessions = observations([event(300, 3_000, 'error')], true)
    sessions.page.mockImplementation(async request => request.beforeSeq === undefined
      ? { records: [event(300, 3_000, 'error')], hasMore: true }
      : { records: [event(100, 1_100), event(90, 900)], hasMore: false })
    await expect(runner({ sessions }).inspect('session-a', 1_000)).resolves.toEqual({ outcome: 'succeeded' })
    expect(sessions.page.mock.calls[0]?.[0]).toEqual({ address: { kind: 'session', sessionId: 'session-a' }, throughSeq: 300, maxMessages: 100 })
    expect(sessions.page.mock.calls[1]?.[0].beforeSeq).toBe(300)
    expect(sessions.follow.mock.calls[0]?.[1].aborted).toBe(true)
  })
  it('reuses one session list and waits on history faults', async () => {
    const sessions = observations([event(10, 1_100, 'error')])
    const host = runner({ sessions })
    const running = await host.listRunning()
    expect(running).toMatchObject({ known: true, count: 0 })
    if (!running.known) throw new Error('expected known')
    await expect(host.inspect('session-a', 1_000, running.items)).resolves.toMatchObject({ outcome: 'failed' })
    expect(sessions.list).toHaveBeenCalledOnce()
    sessions.page.mockRejectedValue(new Error('offline'))
    await expect(host.inspect('session-a', 1_000, running.items)).resolves.toEqual({ outcome: 'pending' })
  })
  it('skips full rescans while the history head is unchanged, then clears its memo on disappearance', async () => {
    const sessions = observations([{ event: { type: 'assistant/message', seq: 40, time: 4_000, data: {} } }] as never)
    const host = runner({ sessions })
    await host.inspect('session-a', 1_000)
    await host.inspect('session-a', 1_000)
    expect(sessions.page).toHaveBeenCalledOnce()
    expect(sessions.follow).toHaveBeenCalledTimes(2)
    sessions.list.mockResolvedValue({ items: [] })
    await expect(host.inspect('session-a')).resolves.toEqual({ outcome: 'cancelled', error: 'execution session no longer exists' })
    expect(sessions.follow).toHaveBeenCalledTimes(2)
  })
  it('rescans when the opening cursor advances even if the latest projected record stays the same', async () => {
    const records = [{ event: { type: 'assistant/message', seq: 40, time: 4_000, data: {} } }]
    let cursor = 40
    const sessions = observations(records as never)
    sessions.follow.mockImplementation(async function* () { yield { type: 'snapshot', cursor, records, hasMore: false } } as never)
    const host = runner({ sessions })
    await host.inspect('session-a', 1_000)
    cursor = 41
    await host.inspect('session-a', 1_000)
    expect(sessions.page).toHaveBeenCalledTimes(2)
  })

})
