import type { Context } from '@deepseek-ai/cordis'
import { LocalWorktreeManager } from './git/manager.ts'
import type { LocalWorktreeConfig } from './git/manager.ts'
import type {
  WorktreeId as WorktreeIdType,
  WorktreeOperationId as WorktreeOperationIdType,
  WorktreeOwnerId as WorktreeOwnerIdType,
} from './types.ts'

export { WorktreeId, WorktreeOperationId, WorktreeOwnerId } from './brand.ts'
export { LocalWorktreeManager } from './git/manager.ts'
export type { LocalWorktreeConfig } from './git/manager.ts'
export type {
  CreateWorktreeRequest,
  DeleteWorktreeRequest,
  ManagedWorktree,
  WorktreeCreationUpdate,
  WorktreeEnvironment,
  WorktreeSetupResult,
  WorktreeSnapshot,
} from './types.ts'
export type WorktreeId = WorktreeIdType
export type WorktreeOperationId = WorktreeOperationIdType
export type WorktreeOwnerId = WorktreeOwnerIdType

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktrees: LocalWorktreeManager
  }
}

export const name = 'dsh-worktree'

/** Install the local managed Worktree service for this bundle scope. */
export function apply(ctx: Context, config: LocalWorktreeConfig): void {
  const manager = new LocalWorktreeManager(config)
  ctx.provide('worktrees', manager)
  ctx.effect(() => async () => { await manager.dispose() })
}
