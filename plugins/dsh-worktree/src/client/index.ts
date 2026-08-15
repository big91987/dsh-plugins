import type { Context } from '@deepseek-ai/cordis'
import worktreeRemote from '../remote-client.ts'

interface ClientRemoteMount {
  $mount(contribution: typeof worktreeRemote): Promise<() => Promise<void>>
}

/** Required Client service that transports strict Typert invocations. */
export const inject = ['remote']

/** Mount the Worktree Remote namespace for the lifetime of this browser plugin. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = (ctx as Context & { remote: ClientRemoteMount }).remote
  return remote.$mount(worktreeRemote)
}
