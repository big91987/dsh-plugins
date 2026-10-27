import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

function resolveSessionPreset(snapshot: { header: Parameters<typeof agentPresetProjectionDefinition.init>[0]; events: SessionEvent[] }): string | undefined {
  return snapshot.events.reduce(agentPresetProjectionDefinition.apply, agentPresetProjectionDefinition.init(snapshot.header)) ?? undefined
}
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq, SessionLogOffset, buildForkSeed, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import { completedHistory } from './history.ts'
import type {
  ThreadMessageReceipt,
  ThreadRead,
  ThreadStatus,
  ThreadSummary,
  ThreadWaitTarget,
} from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Durable message sent from one independent Session to another. */
    'agent-message': {
      kind: 'agent-message'
      form: 'relay'
      senderSessionId: SessionId
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionCoordination: SessionCoordination
  }
}

function cursorOf(events: readonly SessionEvent[]): number {
  return events.at(-1)?.seq ?? -1
}

/**
 * Recover the provider/model a Session was last routed on from its event log.
 * A cold-resumed agent needs `AgentOptions.provider/model` so the deployment
 * persona's `{{model}}` prompt variable resolves; otherwise prompt assembly
 * fails with `prompt variable "{{model}}" has no value` (the variable provider
 * reads `agent.options.model`, which is empty when resume passes no options).
 * The latest `request/header` event is the authoritative route the session
 * actually used.
 */
function lastRoutedAgentOptions(events: readonly SessionEvent[]): AgentOptions | undefined {
  let provider: string | undefined
  let model: string | undefined
  for (const event of events) {
    if (event.type !== 'request/header') continue
    const config = event.data.header.config
    if (config.provider.length > 0) provider = config.provider
    if (config.model.length > 0) model = config.model
  }
  if (provider === undefined || model === undefined) return undefined
  return { provider, model }
}

/** Coordinates independent top-level Sessions without making them subagents. */
export class SessionCoordination {
  private readonly resumptions = new Map<SessionId, Promise<Agent>>()
  private readonly ownedHandles = new Set<AgentHandle>()

  constructor(private readonly ctx: Context) {}

  /** List every logical Session without resuming stored entries. */
  async listThreads(signal?: AbortSignal): Promise<ThreadSummary[]> {
    signal?.throwIfAborted()
    const records = (await this.ctx.sessionQuery.listSessions(signal))
      .filter(record => record.header.origin !== 'subagent')
    const titles = await this.ctx.sessionQuery.readTitleSnapshots(records.map(record => record.header.id), signal)
    const titleById = new Map(titles.map(result => [
      result.sessionId,
      result.status === 'fulfilled' ? result.value.title?.title ?? 'untitled' : 'untitled',
    ]))
    const rows = await Promise.all(records.map(async (record): Promise<ThreadSummary> => {
      const snapshot = await this.ctx.sessionQuery.readSession(record.header.id)
      return {
        threadId: record.header.id,
        title: titleById.get(record.header.id) ?? 'untitled',
        status: this.statusOf(record.header.id),
        ...(record.header.cwd === undefined ? {} : { cwd: record.header.cwd }),
        cursor: cursorOf(snapshot.events),
        updatedAt: snapshot.events.at(-1)?.time ?? record.header.createdAt,
      }
    }))
    return rows.sort((left, right) => right.updatedAt - left.updatedAt
      || String(left.threadId).localeCompare(String(right.threadId)))
  }

  /** Read one exact event suffix without resuming the Session. */
  async readThread(threadId: SessionId, afterCursor: number = -1): Promise<ThreadRead> {
    if (!Number.isSafeInteger(afterCursor)) throw new TypeError('session-coordination: afterCursor must be a safe integer')
    const snapshot = await this.ctx.sessionQuery.readSession(threadId)
    if (snapshot.session.origin === 'subagent') {
      throw new Error(`session-coordination: Session ${threadId} is owned by subagent continuation`)
    }
    const title = await this.ctx.sessionQuery.readTitle(threadId)
    return {
      threadId,
      title: title?.title ?? 'untitled',
      status: this.statusOf(threadId),
      ...(snapshot.session.cwd === undefined ? {} : { cwd: snapshot.session.cwd }),
      cursor: cursorOf(snapshot.events),
      updatedAt: snapshot.events.at(-1)?.time ?? snapshot.session.createdAt,
      header: structuredClone(snapshot.session),
      events: structuredClone(snapshot.events.filter(event => event.seq > afterCursor)),
    }
  }

  /** Deliver one attributed ordinary follow-up, cold-resuming a stored Session when required. */
  async sendMessage(
    senderSessionId: SessionId,
    targetSessionId: SessionId,
    text: string,
    signal?: AbortSignal,
  ): Promise<ThreadMessageReceipt> {
    if (text === '') throw new TypeError('session-coordination: message must not be empty')
    signal?.throwIfAborted()
    const source = await this.ctx.sessionQuery.readSession(targetSessionId)
    if (source.session.origin === 'subagent') {
      throw new Error(`session-coordination: Session ${targetSessionId} is owned by subagent continuation`)
    }
    const target = await this.ensureTarget(targetSessionId, source, signal)
    signal?.throwIfAborted()
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'agent-message', form: 'relay', senderSessionId },
    })
    target.followup(message)
    return { messageId: String(message.id) }
  }

  /** Wait for any running target to become idle, then return every requested suffix. */
  async waitThreads(
    targets: readonly ThreadWaitTarget[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ThreadRead[]> {
    if (targets.length < 1 || targets.length > 8) {
      throw new RangeError('session-coordination: wait requires 1 to 8 targets')
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) {
      throw new RangeError('session-coordination: timeoutMs must be an integer from 0 through 2147483647')
    }
    signal?.throwIfAborted()
    const running = targets.every(target => this.statusOf(target.threadId) === 'running')
    if (timeoutMs > 0 && running) {
      await this.waitForIdle(new Set(targets.map(target => target.threadId)), timeoutMs, signal)
    }
    return Promise.all(targets.map(target => this.readThread(target.threadId, target.afterCursor)))
  }

  /** Continue a completed source prefix in a new same-directory Session. */
  async forkThread(
    sourceSessionId: SessionId,
    atSeq?: number,
    signal?: AbortSignal,
  ): Promise<{ threadId: SessionId }> {
    signal?.throwIfAborted()
    const source = await this.ctx.sessionQuery.readSession(sourceSessionId)
    if (source.session.origin === 'subagent') {
      throw new Error(`session-coordination: Session ${sourceSessionId} is owned by subagent continuation`)
    }
    const history = completedHistory(String(sourceSessionId), source.events, atSeq)
    const seed = buildForkSeed(history, SessionSeq(history.at(-1)!.seq))
    const preset = resolveSessionPreset({ header: source.session, events: source.events })
    const threadId = SessionId(`session-${randomUUID()}`)
    const handle = await this.ctx.agents.create({
      sessionId: threadId,
      seed,
      inheritedEventCount: SessionLogOffset(history.length),
      meta: {
        ...(source.session.cwd === undefined ? {} : { cwd: source.session.cwd }),
        parentSession: sourceSessionId,
        isSeeded: true,
        delegationDepth: source.session.delegationDepth,
        ...(preset === undefined ? {} : { agentPreset: preset }),
      },
      ...(signal === undefined ? {} : { signal }),
      setup: async agentCtx => { await this.ctx.agentPresets.mount(agentCtx, preset) },
    })
    this.ownedHandles.add(handle)
    const workspace = this.ctx.workspaceRegistry.list()
      .find(candidate => candidate.sessionIds.includes(sourceSessionId))
    await workspace?.attachSession(threadId)
    return { threadId }
  }

  /** Dispose only cold-resumed Agent handles owned by this plugin. */
  async dispose(): Promise<void> {
    await Promise.allSettled([...this.ownedHandles].map(handle => handle.dispose()))
    this.ownedHandles.clear()
  }

  private statusOf(id: SessionId): ThreadStatus {
    return this.ctx.agents.get(id)?.status ?? 'stored'
  }

  private async ensureTarget(
    id: SessionId,
    source: Awaited<ReturnType<Context['sessionQuery']['readSession']>>,
    signal?: AbortSignal,
  ): Promise<Agent> {
    const live = this.ctx.agents.get(id)
    if (live !== undefined) return live
    let pending = this.resumptions.get(id)
    if (pending === undefined) {
      pending = this.resumeTarget(id, source, signal).finally(() => { this.resumptions.delete(id) })
      this.resumptions.set(id, pending)
    }
    return pending
  }

  private async resumeTarget(
    id: SessionId,
    source: Awaited<ReturnType<Context['sessionQuery']['readSession']>>,
    signal?: AbortSignal,
  ): Promise<Agent> {
    const preset = resolveSessionPreset({ header: source.session, events: source.events })
    // Cold-resume must restore the Session's last routed model: the persona
    // template's `{{model}}` variable reads agent.options.model, and without
    // agentOptions the resumed agent has no model, failing prompt assembly.
    const agentOptions = lastRoutedAgentOptions(source.events)
    let handle: AgentHandle
    try {
      handle = await this.ctx.agents.resume({
        resumeSessionId: id,
        ...(signal === undefined ? {} : { signal }),
        ...(agentOptions === undefined ? {} : { agentOptions }),
        setup: async agentCtx => { await this.ctx.agentPresets.mount(agentCtx, preset) },
      })
    } catch (error) {
      const concurrent = this.ctx.agents.get(id)
      if (concurrent !== undefined) return concurrent
      throw error
    }
    this.ownedHandles.add(handle)
    return handle.agent
  }

  private waitForIdle(targets: ReadonlySet<SessionId>, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let disposeStatus = (): void => {}
      let timer: ReturnType<typeof setTimeout>
      const onAbort = (): void => {
        const reason = signal?.reason
        finish(reason instanceof Error ? reason : new Error('session-coordination: wait aborted'))
      }
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        disposeStatus()
        signal?.removeEventListener('abort', onAbort)
        if (error === undefined) resolve()
        else reject(error)
      }
      disposeStatus = this.ctx.on('agent/status', ({ agent, status }) => {
        if (status === 'idle' && targets.has(agent.id)) finish()
      })
      timer = setTimeout(finish, timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      if ([...targets].some(id => this.statusOf(id) !== 'running')) finish()
    })
  }
}
