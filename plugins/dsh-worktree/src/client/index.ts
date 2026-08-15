import type { Context } from '@deepseek-ai/cordis'

/** Observable proof that the external Worktree browser plugin loaded. */
export interface DshWorktreeClientProbe {
  readonly loaded: true
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshWorktreeClientProbe: DshWorktreeClientProbe
  }
}

/**
 * Provide the Worktree browser loading probe for this plugin scope.
 * @param ctx - browser Cordis plugin context.
 */
export function apply(ctx: Context): void {
  ctx.provide('dshWorktreeClientProbe', { loaded: true })
  ctx.effect(() => {
    document.documentElement.dataset.dshWorktreeProbe = 'loaded'
    return () => { delete document.documentElement.dataset.dshWorktreeProbe }
  }, 'dsh-worktree: browser loading marker')
}
