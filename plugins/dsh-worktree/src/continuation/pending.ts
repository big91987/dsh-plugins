import type { ManagedWorktree, WorktreeEnvironment } from '../types.ts'
import type { ContinuationEvent, ContinuationSessionHeader } from './service.ts'

export type PendingSessionStage =
  | 'queued'
  | 'creating'
  | 'setting-up'
  | 'worktree-ready'
  | 'published'
  | 'failed'
  | 'cancelled'

export interface PendingSessionOutput {
  readonly text: string
  readonly truncated: boolean
}

export interface PendingSessionSnapshot {
  readonly id: string
  readonly sourceSessionId: string
  readonly atSeq?: number
  readonly environment?: WorktreeEnvironment
  readonly attempt: number
  readonly stage: PendingSessionStage
  readonly sessionId?: string
  readonly worktree?: ManagedWorktree
  readonly setupOutput: {
    readonly stdout: PendingSessionOutput
    readonly stderr: PendingSessionOutput
  }
  readonly continuedWithoutSetup: boolean
  readonly error?: string
  readonly failureKind?: 'worktree' | 'setup' | 'publication'
}

export class TextTail {
  private bytes = Buffer.alloc(0)
  private dropped = false

  constructor(private readonly maxBytes: number) {}

  push(text: string): void {
    this.bytes = Buffer.concat([this.bytes, Buffer.from(text)])
    if (this.bytes.length > this.maxBytes) {
      this.dropped = true
      this.bytes = this.bytes.subarray(this.bytes.length - this.maxBytes)
    }
  }

  finish(): PendingSessionOutput {
    return { text: this.bytes.toString('utf8'), truncated: this.dropped }
  }
}

export interface PendingRecord {
  readonly id: string
  readonly sourceSessionId: string
  readonly atSeq?: number
  environment?: WorktreeEnvironment
  attempt: number
  stage: PendingSessionStage
  stdout: TextTail
  stderr: TextTail
  worktree?: ManagedWorktree
  sessionId?: string
  error?: string
  failureKind?: 'worktree' | 'setup' | 'publication'
  continuedWithoutSetup: boolean
  prepared?: {
    readonly header: ContinuationSessionHeader
    readonly events: readonly ContinuationEvent[]
    readonly seed: readonly ContinuationEvent[]
  }
  workspaceAttached?: boolean
  titleAssigned?: boolean
  controller?: AbortController
  running?: Promise<void>
}

export function snapshot(record: PendingRecord): PendingSessionSnapshot {
  return {
    id: record.id,
    sourceSessionId: record.sourceSessionId,
    ...(record.atSeq === undefined ? {} : { atSeq: record.atSeq }),
    ...(record.environment === undefined ? {} : { environment: record.environment }),
    attempt: record.attempt,
    stage: record.stage,
    ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
    ...(record.worktree === undefined ? {} : { worktree: record.worktree }),
    setupOutput: { stdout: record.stdout.finish(), stderr: record.stderr.finish() },
    continuedWithoutSetup: record.continuedWithoutSetup,
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(record.failureKind === undefined ? {} : { failureKind: record.failureKind }),
  }
}
