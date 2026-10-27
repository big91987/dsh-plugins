import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionSummary, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { WorkspaceRegistry, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommandResult } from '@deepseek-ai/dsh-commands/types'
import type { TaskRecord } from './core/tasks.ts'

/** Narrow Host business services; these are the official controller/registry faces. */
export interface HostExecutionServices {
  sessions: Pick<SessionController, 'create' | 'rename' | 'prompt' | 'list' | 'follow' | 'page'>
  workspace: Pick<WorkspaceRegistry, 'list'>
  agentPresets: Pick<AgentPresetRegistry, 'list'>
}
export type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/types'
type ExecutionSessionId = SessionId

export interface SessionCommandDispatcher {
  execute(
    sessionId: ExecutionSessionId,
    line: string,
    signal: AbortSignal,
  ): Promise<CommandResult | undefined>
}

export type ExecutionInspection =
  | { outcome: 'pending' }
  | { outcome: 'succeeded' }
  | { outcome: 'failed'; error: string }
  | { outcome: 'cancelled'; error: string }

/** A post-create launch failure that still identifies the session to the ledger. */
export class SessionLaunchError extends Error {
  constructor(readonly sessionId: string, cause: unknown) {
    super(`execution session ${sessionId} failed during launch: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'SessionLaunchError'
  }
}

function isErrorTurnEnd(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const reason = (data as { reason?: unknown }).reason
  return typeof reason === 'object' && reason !== null && (reason as { kind?: unknown }).kind === 'error'
}

export class HostExecutionRunner {
  /**
   * Newest scanned event seq per session whose complete backward scan found
   * no matching turn/end. While a session's newest seq is unchanged a
   * re-scan cannot change the outcome, so only a one-message probe runs per
   * poll tick instead of up to 100 history pages.
   */
  private readonly scanMemos = new Map<string, number>()

  constructor(
    private readonly api: HostExecutionServices,
    private readonly commands?: SessionCommandDispatcher,
  ) {}

  async launch(task: TaskRecord): Promise<string> {
    if (task.workspaceId !== undefined) {
      const workspaces = this.api.workspace.list()
      if (!workspaces.some(item => item.id === task.workspaceId)) {
        throw new Error(`workspace not found: ${task.workspaceId}`)
      }
    }
    if (task.mode !== undefined) {
      const presets = await this.api.agentPresets.list()
      const preset = presets.find(item => item.id === task.mode)
      if (preset === undefined) throw new Error(`agent preset not found: ${task.mode}`)
      if (preset.broken !== undefined) throw new Error(`agent preset is unavailable: ${preset.broken}`)
    }
    const created = await this.api.sessions.create({
      ...(task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId as WorkspaceId }),
      ...(task.mode === undefined ? {} : { agentPreset: task.mode }),
    })
    const sessionId = created.sessionId
    try {
      await this.api.sessions.rename({ sessionId, title: task.title })
      if (task.permission !== undefined) {
        if (this.commands === undefined) throw new Error('permission command dispatcher is unavailable')
        const command = await this.commands.execute(sessionId, `/permission ${task.permission}`, AbortSignal.timeout(30_000))
        if (command === undefined) throw new Error('permission command was not acknowledged')
        if (command.kind !== 'success') throw new Error(command.text ?? 'permission command failed')
      }
      await this.api.sessions.prompt({
        requestId: `task-board-${crypto.randomUUID()}` as SessionRequestId,
        sessionId,
        mode: 'queue' as const,
        content: [{ type: 'text' as const, text: task.prompt !== '' ? task.prompt : task.title }],
      }, AbortSignal.timeout(30_000))
    } catch (error) {
      throw new SessionLaunchError(sessionId, error)
    }
    return sessionId
  }

  async listRunning(): Promise<{ known: true; count: number; items: SessionSummary[] } | { known: false }> {
    try {
      const response = await this.api.sessions.list({}, AbortSignal.timeout(30_000))
      return { known: true, count: response.items.filter(item => item.running).length, items: [...response.items] }
    } catch {
      return { known: false }
    }
  }

  /**
   * Resolve one execution's outcome. The caller may pass the session list it
   * already fetched this poll tick; otherwise inspect lists sessions itself.
   * Sharing the list keeps a poll with E open executions at one list RPC
   * instead of 1 + E.
   */
  async inspect(sessionId: string, startedAt = 0, sessions?: readonly SessionSummary[]): Promise<ExecutionInspection> {
    let items: readonly SessionSummary[]
    if (sessions !== undefined) {
      items = sessions
    } else {
      const response = await this.api.sessions.list({}, AbortSignal.timeout(30_000))
      items = response.items
    }
    const summary = items.find(item => item.sessionId === sessionId)
    if (summary === undefined) {
      this.scanMemos.delete(sessionId)
      return { outcome: 'cancelled', error: 'execution session no longer exists' }
    }
    if (summary.running) return { outcome: 'pending' }
    // Probe the newest event before paging: SessionSummary.updatedAt tracks
    // human prompts, not event appends, so only the history head proves
    // whether a re-scan could find anything new.
    const lifetime = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(30_000)])
    const address = { kind: 'session' as const, sessionId: summary.sessionId }
    let probe: Extract<import('@deepseek-ai/dsh-api-session-controller/types').SessionFollowFrame, { type: 'snapshot' }> | undefined
    try {
      for await (const frame of this.api.sessions.follow({ address, maxMessages: 1 }, signal)) {
        if (frame.type !== 'snapshot') return { outcome: 'pending' }
        probe = frame
        break
      }
    } catch { return { outcome: 'pending' } }
    finally { lifetime.abort() }
    if (probe === undefined) return { outcome: 'pending' }
    // The opening cursor is the durable log watermark even when projection
    // records omit a newer ignorable event; it fences both paging and memo reuse.
    const newestSeq = probe.cursor
    if (newestSeq !== undefined && this.scanMemos.get(sessionId) === newestSeq) return { outcome: 'pending' }
    const events: Array<{ event: { type: string; seq?: number; time?: number; data: unknown } }> = []
    let beforeSeq: number | undefined
    let reachedExecutionBoundary = false
    for (let page = 0; page < 100; page += 1) {
      let history: import('@deepseek-ai/dsh-api-session-controller/types').SessionPage
      try {
        history = await this.api.sessions.page({
          address, throughSeq: probe.cursor, maxMessages: 100,
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
        }, AbortSignal.timeout(30_000))
      } catch { return { outcome: 'pending' } }
      events.push(...history.records)
      const oldestTime = history.records.reduce<number | undefined>((oldest, entry) => {
        const time = entry.event.time
        return typeof time !== 'number' ? oldest : oldest === undefined ? time : Math.min(oldest, time)
      }, undefined)
      if (!history.hasMore || (oldestTime !== undefined && oldestTime <= startedAt)) {
        reachedExecutionBoundary = true
        break
      }
      const oldestSeq = history.records.reduce<number | undefined>((oldest, entry) => {
        const seq = entry.event.seq
        return typeof seq !== 'number' ? oldest : oldest === undefined ? seq : Math.min(oldest, seq)
      }, undefined)
      if (oldestSeq === undefined || oldestSeq === beforeSeq) return { outcome: 'pending' }
      beforeSeq = oldestSeq
    }
    if (!reachedExecutionBoundary) return { outcome: 'pending' }
    const turnEnd = events
      .filter(entry => entry.event.type === 'turn/end' && (
        startedAt <= 0 || (typeof entry.event.time === 'number' && entry.event.time >= startedAt)
      ))
      .sort((a, b) => (a.event.seq ?? Number.MAX_SAFE_INTEGER) - (b.event.seq ?? Number.MAX_SAFE_INTEGER))[0]
    if (turnEnd === undefined) {
      // Complete scan, no match: remember the head so later ticks probe only.
      if (newestSeq !== undefined) this.scanMemos.set(sessionId, newestSeq)
      return { outcome: 'pending' }
    }
    this.scanMemos.delete(sessionId)
    return isErrorTurnEnd(turnEnd.event.data)
      ? { outcome: 'failed', error: 'agent turn ended with an error' }
      : { outcome: 'succeeded' }
  }
}
