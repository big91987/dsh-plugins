import type { Context } from '@deepseek-ai/cordis'

/** Observable proof that the external Worktree Host plugin loaded. */
export interface DshWorktreeProbe {
  readonly loaded: true
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshWorktreeProbe: DshWorktreeProbe
  }
}

export const name = 'dsh-worktree'

/**
 * Provide the Worktree loading probe for this plugin scope.
 * @param ctx - Cordis plugin context.
 */
export function apply(ctx: Context): void {
  ctx.provide('dshWorktreeProbe', { loaded: true })
}
