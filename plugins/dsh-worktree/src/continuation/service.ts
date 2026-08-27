import { randomUUID } from 'node:crypto'
import { WorktreeOperationId, WorktreeOwnerId } from '../brand.ts'
import type {
  CreateWorktreeRequest,
  DeleteWorktreeRequest,
  ManagedWorktree,
  WorktreeEnvironment,
  WorktreeId,
  WorktreeOwnerId as WorktreeOwnerIdType,
} from '../types.ts'
import { completedHistory } from './history.ts'
import { snapshot, TextTail } from './pending.ts'
import type { PendingRecord, PendingSessionSnapshot } from './pending.ts'

export type { PendingSessionOutput, PendingSessionSnapshot, PendingSessionStage } from './pending.ts'

export interface ContinuationEvent {
  readonly type: string
  readonly seq: number
  readonly time?: number
  readonly data?: unknown
  readonly [key: string]: unknown
}

export interface ContinuationSessionHeader {
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string
  readonly origin?: string
  readonly agentPreset?: string
  readonly [key: string]: unknown
}

export interface ContinuationWorkspace {
  readonly id: string
  readonly sessionIds: readonly string[]
  attachSession(sessionId: string): Promise<void>
}

export interface ContinuationHost {
  readonly sessionQuery: {
    readSession(sessionId: string): Promise<{
      readonly session: ContinuationSessionHeader
      readonly events: readonly ContinuationEvent[]
    }>
    traceSession(sessionId: string): Promise<{
      readonly ancestors: readonly { readonly header: ContinuationSessionHeader }[]
    }>
  }
  readonly agents: {
    create(options: {
      readonly sessionId: string
      readonly seed: readonly ContinuationEvent[]
      readonly meta: Readonly<Record<string, unknown>>
      readonly signal?: AbortSignal
      readonly setup: (agentContext: unknown) => Promise<unknown>
    }): Promise<{ readonly agent: { readonly session: unknown } }>
    get(sessionId: string): { readonly session: unknown } | undefined
  }
  readonly agentPresets: {
    mount(agentContext: unknown, presetId?: string): Promise<unknown>
  }
  readonly sessionTitle: {
    rename(session: unknown, title: string): unknown
  }
  readonly workspaceRegistry: {
    list(): readonly ContinuationWorkspace[]
    create(cwd: string): Promise<ContinuationWorkspace>
  }
}

export interface ContinueInWorktreeRequest {
  readonly sourceSessionId: string
  readonly atSeq?: number
  readonly environment?: WorktreeEnvironment
}

export interface ContinueInWorktreeResult {
  readonly pendingSessionId: string
}

export interface ContinuationWorktrees {
  create(request: CreateWorktreeRequest): Promise<ManagedWorktree>
  delete(request: DeleteWorktreeRequest): Promise<void>
  setOwner(id: WorktreeId, ownerId: WorktreeOwnerIdType, signal?: AbortSignal): Promise<void>
}

/** A child exists even though attaching its Workspace ledger failed. */
export class ContinuationWorkspaceAttachError extends Error {
  constructor(
    readonly sessionId: string,
    readonly workspaceId: string,
    cause: unknown,
  ) {
    super(`session "${sessionId}" was continued but could not attach to workspace "${workspaceId}"`, { cause })
    this.name = 'ContinuationWorkspaceAttachError'
  }
}

function resolveSessionPreset(
  header: ContinuationSessionHeader,
  events: readonly ContinuationEvent[],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'agent-preset/selected' || typeof event.data !== 'object' || event.data === null) continue
    const selected = (event.data as Record<string, unknown>).agentPreset
    if (typeof selected === 'string') return selected
  }
  return header.agentPreset
}

function resolveSessionTitle(events: readonly ContinuationEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'session/title' || typeof event.data !== 'object' || event.data === null) continue
    const title = (event.data as Record<string, unknown>).title
    if (typeof title === 'string' && title !== '') return title
  }
  return undefined
}

function increasedForkTitle(title: string): string {
  const ascii = /^(.*?)\((\d+)\)$/u.exec(title)
  if (ascii?.[1] !== undefined && ascii[2] !== undefined) return `${ascii[1]}(${BigInt(ascii[2]) + 1n})`
  const fullWidth = /^(.*?)（(\d+)）$/u.exec(title)
  if (fullWidth?.[1] !== undefined && fullWidth[2] !== undefined) {
    return `${fullWidth[1]}（${BigInt(fullWidth[2]) + 1n}）`
  }
  return `${title} (1)`
}

async function continuationWorkspace(
  host: ContinuationHost,
  header: ContinuationSessionHeader,
): Promise<ContinuationWorkspace | undefined> {
  const workspaces = host.workspaceRegistry.list()
  const direct = workspaces.find(workspace => workspace.sessionIds.includes(header.id))
  if (direct !== undefined || header.origin !== 'subagent') return direct
  const lineage = await host.sessionQuery.traceSession(header.id)
  for (const ancestor of lineage.ancestors) {
    const workspace = workspaces.find(candidate => candidate.sessionIds.includes(ancestor.header.id))
    if (workspace !== undefined) return workspace
  }
  return undefined
}

/** Publish same-directory and managed-Worktree child Sessions. */
export class SessionContinuation {
  private readonly records = new Map<string, PendingRecord>()
  private readonly observers = new Set<(snapshot: PendingSessionSnapshot) => void>()

  constructor(
    private readonly host: ContinuationHost,
    private readonly worktrees?: ContinuationWorktrees,
    private readonly maxSetupOutputBytes: number = 1_048_576,
  ) {
    if (!Number.isSafeInteger(maxSetupOutputBytes) || maxSetupOutputBytes < 1) {
      throw new TypeError('dsh-worktree: maxSetupOutputBytes must be a positive safe integer')
    }
  }

  private async createChild(
    header: ContinuationSessionHeader,
    events: readonly ContinuationEvent[],
    seed: readonly ContinuationEvent[],
    cwd: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ readonly id: string; readonly session: unknown }> {
    const presetId = resolveSessionPreset(header, events)
    const childId = `session-${randomUUID()}`
    const handle = await this.host.agents.create({
      sessionId: childId,
      seed,
      meta: {
        ...(cwd === undefined ? {} : { cwd }),
        parentSession: header.id,
        seedLength: seed.length,
        ...(presetId === undefined ? {} : { agentPreset: presetId }),
      },
      ...(signal === undefined ? {} : { signal }),
      setup: async agentContext => { await this.host.agentPresets.mount(agentContext, presetId) },
    })
    return { id: childId, session: handle.agent.session }
  }

  continueInWorktree(request: ContinueInWorktreeRequest): ContinueInWorktreeResult {
    const id = `pending-${randomUUID()}`
    const record: PendingRecord = {
      id,
      sourceSessionId: request.sourceSessionId,
      ...(request.atSeq === undefined ? {} : { atSeq: request.atSeq }),
      ...(request.environment === undefined ? {} : { environment: request.environment }),
      attempt: 1,
      stage: 'queued',
      stdout: new TextTail(this.maxSetupOutputBytes),
      stderr: new TextTail(this.maxSetupOutputBytes),
      continuedWithoutSetup: false,
    }
    this.records.set(id, record)
    this.emit(record)
    queueMicrotask(() => { this.startAttempt(record) })
    return { pendingSessionId: id }
  }

  pending(id: string): PendingSessionSnapshot | undefined {
    const record = this.records.get(id)
    return record === undefined ? undefined : snapshot(record)
  }

  listPending(): readonly PendingSessionSnapshot[] {
    return [...this.records.values()].map(snapshot)
  }

  observePending(observer: (value: PendingSessionSnapshot) => void): () => void {
    this.observers.add(observer)
    return () => { this.observers.delete(observer) }
  }

  continuePendingWithoutSetup(id: string): void {
    const record = this.requireRecord(id)
    if (record.stage !== 'failed' || record.failureKind !== 'setup' || record.worktree === undefined) {
      throw new Error(`pending Session ${id} has no retained Worktree`)
    }
    record.continuedWithoutSetup = true
    delete record.error
    delete record.failureKind
    record.stage = 'worktree-ready'
    this.emit(record)
    queueMicrotask(() => { this.startPublication(record) })
  }

  retryPending(id: string, environment?: WorktreeEnvironment): void {
    const record = this.requireRecord(id)
    if (record.stage !== 'failed') throw new Error(`pending Session ${id} is not failed`)
    record.attempt++
    if (record.failureKind === 'publication' && record.worktree !== undefined) {
      delete record.error
      delete record.failureKind
      record.stage = 'worktree-ready'
      this.emit(record)
      queueMicrotask(() => { this.startPublication(record) })
      return
    }
    const previous = record.worktree
    if (environment !== undefined) record.environment = environment
    record.stage = 'queued'
    delete record.error
    delete record.failureKind
    record.continuedWithoutSetup = false
    record.stdout = new TextTail(this.maxSetupOutputBytes)
    record.stderr = new TextTail(this.maxSetupOutputBytes)
    this.emit(record)
    queueMicrotask(() => { this.startAttempt(record, previous) })
  }

  async cancelPending(id: string): Promise<void> {
    const record = this.requireRecord(id)
    if (record.stage === 'published') throw new Error(`pending Session ${id} is already published`)
    if (record.sessionId !== undefined) {
      throw new Error(`pending Session ${id} already has child Session ${record.sessionId}`)
    }
    record.controller?.abort('pending Session cancelled')
    await record.running
    if (record.worktree !== undefined) {
      if (this.worktrees === undefined) throw new Error('dsh-worktree: Worktree provider is unavailable')
      await this.worktrees.delete({ id: record.worktree.id, force: true })
      delete record.worktree
    }
    record.stage = 'cancelled'
    delete record.error
    delete record.failureKind
    this.emit(record)
  }

  dismissPending(id: string): void {
    const record = this.requireRecord(id)
    if (!['failed', 'cancelled', 'published'].includes(record.stage)) {
      throw new Error(`pending Session ${id} is not dismissible`)
    }
    this.records.delete(id)
  }

  async dispose(): Promise<void> {
    for (const record of this.records.values()) record.controller?.abort('session continuation disposed')
    await Promise.allSettled([...this.records.values()].flatMap(record => record.running ?? []))
    this.observers.clear()
  }

  private requireRecord(id: string): PendingRecord {
    const record = this.records.get(id)
    if (record === undefined) throw new Error(`unknown pending Session ${id}`)
    return record
  }

  private emit(record: PendingRecord): void {
    const value = snapshot(record)
    for (const observer of this.observers) observer(value)
  }

  private startAttempt(record: PendingRecord, previous?: ManagedWorktree): void {
    if (record.stage !== 'queued' || this.records.get(record.id) !== record) return
    const attempt = record.attempt
    const running = this.runAttempt(record, attempt, previous)
    record.running = running
    void running.finally(() => {
      if (record.running === running) delete record.running
    })
  }

  private async runAttempt(record: PendingRecord, attempt: number, previous?: ManagedWorktree): Promise<void> {
    const controller = new AbortController()
    record.controller = controller
    try {
      if (this.worktrees === undefined) throw new Error('dsh-worktree: Worktree provider is unavailable')
      if (previous !== undefined) {
        await this.worktrees.delete({ id: previous.id, force: true })
        delete record.worktree
      }
      if (record.attempt !== attempt) return
      const source = await this.host.sessionQuery.readSession(record.sourceSessionId)
      const seed = completedHistory(source.session.id, source.events, record.atSeq)
      if (source.session.cwd === undefined) throw new Error(`source Session ${record.sourceSessionId} has no working directory`)
      record.prepared = { header: source.session, events: source.events, seed }
      const worktree = await this.worktrees.create({
        operationId: WorktreeOperationId(`${record.id}:${String(record.attempt)}`),
        sourceCwd: source.session.cwd,
        ...(record.environment === undefined ? {} : { environment: record.environment }),
        signal: controller.signal,
        onUpdate: update => {
          if (record.attempt !== attempt || this.records.get(record.id) !== record) return
          if (update.kind === 'stage') record.stage = update.stage
          else record[update.stream].push(update.text)
          this.emit(record)
        },
      })
      if (record.attempt !== attempt) return
      record.worktree = worktree
      controller.signal.throwIfAborted()
      if (worktree.setup.kind === 'completed' && worktree.setup.exitCode !== 0) {
        record.error = `setup exited with code ${String(worktree.setup.exitCode)}`
        record.failureKind = 'setup'
        record.stage = 'failed'
        this.emit(record)
        return
      }
      record.stage = 'worktree-ready'
      this.emit(record)
      await this.publish(record, controller.signal)
    } catch (error) {
      if (record.attempt !== attempt || this.records.get(record.id) !== record) return
      if (controller.signal.aborted) {
        record.stage = 'cancelled'
      } else {
        record.error = error instanceof Error ? error.message : String(error)
        record.failureKind = record.worktree === undefined ? 'worktree' : 'publication'
        record.stage = 'failed'
      }
      this.emit(record)
    } finally {
      if (record.attempt === attempt && record.controller === controller) delete record.controller
    }
  }

  private startPublication(record: PendingRecord): void {
    if (record.stage !== 'worktree-ready') return
    const controller = new AbortController()
    record.controller = controller
    const running = this.publish(record, controller.signal).catch(error => {
      record.error = error instanceof Error ? error.message : String(error)
      record.failureKind = 'publication'
      record.stage = 'failed'
      this.emit(record)
    }).finally(() => {
      if (record.controller === controller) delete record.controller
      if (record.running === running) delete record.running
    })
    record.running = running
  }

  private async publish(record: PendingRecord, signal: AbortSignal): Promise<void> {
    const prepared = record.prepared
    const worktree = record.worktree
    if (prepared === undefined || worktree === undefined || this.worktrees === undefined) {
      throw new Error(`pending Session ${record.id} is missing publication state`)
    }
    const created = record.sessionId === undefined
      ? await this.createChild(prepared.header, prepared.events, prepared.seed, worktree.cwd, signal)
      : undefined
    const childId = created?.id ?? record.sessionId
    if (childId === undefined) throw new Error(`pending Session ${record.id} has no child identity`)
    record.sessionId = childId
    if (record.titleAssigned !== true) {
      const title = resolveSessionTitle(prepared.events)
      if (title !== undefined) {
        const session = created?.session ?? this.host.agents.get(childId)?.session
        if (session === undefined) throw new Error(`pending Session ${record.id} child is not live`)
        this.host.sessionTitle.rename(session, increasedForkTitle(title))
      }
      record.titleAssigned = true
    }
    if (record.workspaceAttached !== true) {
      const workspace = await this.host.workspaceRegistry.create(worktree.cwd)
      try {
        await workspace.attachSession(childId)
      } catch (error) {
        throw new ContinuationWorkspaceAttachError(childId, workspace.id, error)
      }
      record.workspaceAttached = true
    }
    await this.worktrees.setOwner(worktree.id, WorktreeOwnerId(childId), signal)
    delete record.error
    delete record.failureKind
    record.stage = 'published'
    this.emit(record)
  }
}
