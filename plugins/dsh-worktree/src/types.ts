/** Provider-neutral managed Worktree types. */

declare const brand: unique symbol

/** A string carrying a compile-time-only identity. */
type Branded<Name extends string> = string & { readonly [brand]: Name }

/** Stable identity of one managed Worktree. */
export type WorktreeId = Branded<'WorktreeId'>

/** Idempotency identity of one Worktree creation attempt. */
export type WorktreeOperationId = Branded<'WorktreeOperationId'>

/** Identity of the Session that owns a managed Worktree. */
export type WorktreeOwnerId = Branded<'WorktreeOwnerId'>

/** One optional setup command selected for a new Worktree. */
export interface WorktreeEnvironment {
  readonly name: string
  readonly command: string
}

/** Live progress from Worktree creation or setup. */
export type WorktreeCreationUpdate =
  | { readonly kind: 'stage', readonly stage: 'creating' | 'setting-up' }
  | { readonly kind: 'output', readonly stream: 'stdout' | 'stderr', readonly text: string }

/** Inputs for one managed Worktree creation attempt. */
export interface CreateWorktreeRequest {
  readonly operationId: WorktreeOperationId
  readonly sourceCwd: string
  readonly environment?: WorktreeEnvironment
  readonly signal?: AbortSignal
  readonly onUpdate?: (update: WorktreeCreationUpdate) => void
}

/** Retained setup outcome for a usable managed Worktree. */
export type WorktreeSetupResult =
  | { readonly kind: 'skipped' }
  | {
    readonly kind: 'completed'
    readonly exitCode: number | null
    readonly signal: NodeJS.Signals | null
    readonly stdout: string
    readonly stderr: string
  }

/** Durable facts for one managed Worktree. */
export interface ManagedWorktree {
  readonly id: WorktreeId
  readonly path: string
  readonly cwd: string
  readonly repositoryRoot: string
  readonly repositoryCommonDir: string
  readonly sourceHead: string
  readonly ownerId?: WorktreeOwnerId
  readonly setup: WorktreeSetupResult
}

/** Inputs for removing one known managed Worktree. */
export interface DeleteWorktreeRequest {
  readonly id: WorktreeId
  readonly force: boolean
  readonly signal?: AbortSignal
}

/** Repository-owned recovery reference for one managed Worktree. */
export interface WorktreeSnapshot {
  readonly id: WorktreeId
  readonly ref: string
  readonly sourceHead: string
  readonly repositoryRoot: string
  readonly repositoryCommonDir: string
  readonly relativeCwd: string
  readonly ownerId?: WorktreeOwnerId
}
