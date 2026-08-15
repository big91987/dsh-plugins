import type { Context } from '@deepseek-ai/cordis'
import { SessionCoordination } from './service.ts'
import { registerTools } from './tools.ts'

export { ContinuationUnavailableError, completedHistory } from './history.ts'
export { SessionCoordination } from './service.ts'
export type {
  ThreadMessageReceipt,
  ThreadRead,
  ThreadStatus,
  ThreadSummary,
  ThreadWaitTarget,
} from './types.ts'

export const name = 'dsh-session-coordination'

/** Install peer Session coordination and its five model tools when Host services exist. */
export function apply(ctx: Context): void {
  ctx.inject(
    ['agents', 'agentPresets', 'sessionQuery', 'workspaceRegistry', 'tools'],
    coordinationContext => {
      const service = new SessionCoordination(coordinationContext)
      coordinationContext.provide('sessionCoordination', service)
      coordinationContext.effect(() => async () => { await service.dispose() })
      registerTools(coordinationContext)
    },
  )
}
