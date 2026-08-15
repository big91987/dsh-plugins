import type { Context } from '@deepseek-ai/cordis'

/** Observable proof that the external Session Coordination Host plugin loaded. */
export interface DshSessionCoordinationProbe {
  readonly loaded: true
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshSessionCoordinationProbe: DshSessionCoordinationProbe
  }
}

export const name = 'dsh-session-coordination'

/**
 * Provide the Session Coordination loading probe for this plugin scope.
 * @param ctx - Cordis plugin context.
 */
export function apply(ctx: Context): void {
  ctx.provide('dshSessionCoordinationProbe', { loaded: true })
}
