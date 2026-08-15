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
export { NodeSetupRuntime } from './git/setup.ts'
export type { SetupRuntime } from './git/setup.ts'
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
export const inject = ['subprocess']

/** Install the local managed Worktree service for this bundle scope. */
export function apply(ctx: Context, config: LocalWorktreeConfig): void {
  const services = ctx as Context & { subprocess: import('./git/setup.ts').SetupRuntime }
  const manager = new LocalWorktreeManager(config, services.subprocess)
  ctx.provide('worktrees', manager)
  ctx.effect(() => async () => { await manager.dispose() })
}
