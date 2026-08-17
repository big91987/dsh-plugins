import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { join, relative } from 'node:path'
import type { WorktreeEnvironment } from './types.ts'
import type { LocalWorktreeManager } from './git/manager.ts'
import type {
  ContinueInChatRequest,
  ContinueInChatResult,
  ContinueInWorktreeRequest,
  ContinueInWorktreeResult,
  SessionContinuation,
} from './continuation/service.ts'
import type { PendingSessionSnapshot } from './continuation/pending.ts'

/** Wire request for a same-directory continuation. */
export interface ContinueInChatWireRequest {
  /** Durable source Session identity. */
  readonly sourceSessionId: string
  /** Optional source event anchor. */
  readonly atSeq?: number
}

/** Wire request for retrying one failed pending Worktree operation. */
export interface RetryPendingRequest {
  /** Process-local pending operation identity. */
  readonly id: string
  /** Replacement setup environment; omission keeps the preceding selection. */
  readonly environment?: WorktreeEnvironment
}

/** Browser projection from an internal Worktree Workspace to its source project. */
export interface WorktreeWorkspaceMapping {
  /** Workspace path selected by the source Session. */
  readonly sourceWorkspacePath: string
  /** Workspace path inside the managed Worktree. */
  readonly worktreeWorkspacePath: string
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`dsh-worktree: ${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') throw new TypeError(`dsh-worktree: ${label} must be a non-empty string`)
  return value
}

function optionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value)) throw new TypeError(`dsh-worktree: ${label} must be a safe integer`)
  return value as number
}

function continuationRequest(value: unknown): ContinueInChatWireRequest {
  const input = record(value, 'continuation request')
  const atSeq = optionalInteger(input.atSeq, 'atSeq')
  return {
    sourceSessionId: string(input.sourceSessionId, 'sourceSessionId'),
    ...(atSeq === undefined ? {} : { atSeq }),
  }
}

function environment(value: unknown): WorktreeEnvironment | undefined {
  if (value === undefined) return undefined
  const input = record(value, 'environment')
  return { name: string(input.name, 'environment.name'), command: string(input.command, 'environment.command') }
}

/** Browser-facing Remote facade over the Host continuation service. */
export class WorktreeRemote extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'dshWorktreeRemote', { namespace: 'dshWorktree' })
  }

  /** Continue a completed source prefix in a new same-directory Session. */
  async continueInChat(request: ContinueInChatWireRequest, signal: AbortSignal): Promise<ContinueInChatResult> {
    return this.continuation.continueInChat({ ...continuationRequest(request), signal })
  }

  /** Begin a managed-Worktree continuation and return immediately. */
  continueInWorktree(request: ContinueInWorktreeRequest): ContinueInWorktreeResult {
    const input = record(request, 'Worktree continuation request')
    const base = continuationRequest(input)
    const selected = environment(input.environment)
    return this.continuation.continueInWorktree({
      ...base,
      ...(selected === undefined ? {} : { environment: selected }),
    })
  }

  /** Read one pending operation, returning null when absent. */
  pending(id: string): PendingSessionSnapshot | null {
    return this.continuation.pending(string(id, 'pending id')) ?? null
  }

  /** List pending operations in creation order. */
  listPending(): readonly PendingSessionSnapshot[] {
    return this.continuation.listPending()
  }

  /** List durable mappings used to present Worktree Sessions under their source project. */
  async listWorkspaceMappings(): Promise<readonly WorktreeWorkspaceMapping[]> {
    return (await this.worktrees.list()).map(worktree => {
      const relativeCwd = relative(worktree.path, worktree.cwd)
      return {
        sourceWorkspacePath: relativeCwd === ''
          ? worktree.repositoryRoot
          : join(worktree.repositoryRoot, relativeCwd),
        worktreeWorkspacePath: worktree.cwd,
      }
    })
  }

  /** Retry one failed pending operation. */
  retryPending(request: RetryPendingRequest): void {
    const input = record(request, 'retry request')
    this.continuation.retryPending(string(input.id, 'pending id'), environment(input.environment))
  }

  /** Cancel one unpublished operation and remove its retained Worktree. */
  async cancelPending(id: string): Promise<void> {
    await this.continuation.cancelPending(string(id, 'pending id'))
  }

  /** Publish a retained Worktree despite setup failure. */
  continuePendingWithoutSetup(id: string): void {
    this.continuation.continuePendingWithoutSetup(string(id, 'pending id'))
  }

  /** Remove one terminal pending row. */
  dismissPending(id: string): void {
    this.continuation.dismissPending(string(id, 'pending id'))
  }

  private get continuation(): SessionContinuation {
    return (this.ctx as Context & { sessionContinuation: SessionContinuation }).sessionContinuation
  }

  private get worktrees(): LocalWorktreeManager {
    return (this.ctx as Context & { worktrees: LocalWorktreeManager }).worktrees
  }
}
