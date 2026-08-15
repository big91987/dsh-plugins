import { spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import type { WorktreeCreationUpdate, WorktreeEnvironment, WorktreeSetupResult } from '../types.ts'

interface SetupOutcome {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

interface SetupHandle {
  readonly stdout: Readable | undefined
  readonly stderr: Readable | undefined
  readonly done: Promise<SetupOutcome>
  terminate(): void
  waitForExit(signal?: AbortSignal): Promise<boolean>
}

export interface SetupRuntime {
  spawn(spec: {
    readonly argv: readonly string[]
    readonly cwd: string
    readonly stdio: { readonly stdin: 'ignore', readonly stdout: 'pipe', readonly stderr: 'pipe' }
    readonly graceMs: number
    readonly env: NodeJS.ProcessEnv
    readonly signal?: AbortSignal
  }): SetupHandle
}

export interface SetupOptions {
  readonly environment: WorktreeEnvironment
  readonly sourceWorkspace: string
  readonly worktreeWorkspace: string
  readonly maxOutputBytes: number
  readonly graceMs: number
  readonly signal?: AbortSignal
  readonly onUpdate?: (update: WorktreeCreationUpdate) => void
}

function scrubbedParentEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/KEY|PASSWORD|SECRET|TOKEN/i.test(key) && !key.toUpperCase().startsWith('DSH_')) {
      env[key] = value
    }
  }
  return env
}

/** Test and standalone adapter; the installed plugin uses the Host subprocess service. */
export class NodeSetupRuntime implements SetupRuntime {
  spawn(spec: Parameters<SetupRuntime['spawn']>[0]): SetupHandle {
    const executable = spec.argv[0]
    if (executable === undefined) throw new Error('dsh-worktree: setup command has no executable')
    const child = spawn(executable, spec.argv.slice(1), {
      cwd: spec.cwd,
      detached: process.platform !== 'win32',
      env: { ...scrubbedParentEnvironment(), ...spec.env },
      stdio: 'pipe',
    })
    child.stdin.end()
    let terminated = false
    let killTimer: NodeJS.Timeout | undefined
    const terminate = (): void => {
      if (terminated || child.exitCode !== null || child.signalCode !== null) return
      terminated = true
      try {
        if (process.platform === 'win32') child.kill('SIGTERM')
        else process.kill(-child.pid!, 'SIGTERM')
      } catch {
        // The dedicated process group has already exited.
      }
      killTimer = setTimeout(() => {
        try {
          if (process.platform === 'win32') child.kill('SIGKILL')
          else process.kill(-child.pid!, 'SIGKILL')
        } catch {
          // The dedicated process group exited during the grace period.
        }
      }, spec.graceMs)
      killTimer.unref()
    }
    const onAbort = (): void => { terminate() }
    spec.signal?.addEventListener('abort', onAbort, { once: true })
    if (spec.signal?.aborted === true) terminate()
    const done = new Promise<SetupOutcome>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (exitCode, signal) => {
        if (killTimer !== undefined) clearTimeout(killTimer)
        spec.signal?.removeEventListener('abort', onAbort)
        resolve({ exitCode, signal })
      })
    })
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      done,
      terminate,
      waitForExit: async signal => {
        if (signal?.aborted === true) return false
        await done.catch(() => {})
        return true
      },
    }
  }
}

async function retainOutput(
  input: Readable,
  stream: 'stdout' | 'stderr',
  maxBytes: number,
  onUpdate?: (update: WorktreeCreationUpdate) => void,
): Promise<string> {
  let retained = Buffer.alloc(0)
  const decoder = new StringDecoder('utf8')
  for await (const chunk of input) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array)
    retained = Buffer.concat([retained, bytes])
    if (retained.length > maxBytes) retained = retained.subarray(retained.length - maxBytes)
    const text = decoder.write(bytes)
    if (text !== '') onUpdate?.({ kind: 'output', stream, text })
  }
  const finalText = decoder.end()
  if (finalText !== '') onUpdate?.({ kind: 'output', stream, text: finalText })
  return retained.toString('utf8')
}

/** Run setup through the Host's tree-scoped subprocess service. */
export async function runSetup(runtime: SetupRuntime, options: SetupOptions): Promise<WorktreeSetupResult> {
  const argv = process.platform === 'win32'
    ? ['cmd.exe', '/d', '/s', '/c', options.environment.command]
    : ['/bin/sh', '-c', options.environment.command]
  const handle = runtime.spawn({
    argv,
    cwd: options.worktreeWorkspace,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: options.graceMs,
    env: {
      DSH_SOURCE_WORKSPACE: options.sourceWorkspace,
      DSH_WORKTREE_WORKSPACE: options.worktreeWorkspace,
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  if (handle.stdout === undefined || handle.stderr === undefined) {
    throw new Error('dsh-worktree: subprocess dropped requested setup output pipes')
  }
  try {
    const [outcome, stdout, stderr] = await Promise.all([
      handle.done,
      retainOutput(handle.stdout, 'stdout', options.maxOutputBytes, options.onUpdate),
      retainOutput(handle.stderr, 'stderr', options.maxOutputBytes, options.onUpdate),
    ])
    if (options.signal?.aborted === true) throw new Error('dsh-worktree: setup aborted')
    return { kind: 'completed', ...outcome, stdout, stderr }
  } catch (error) {
    handle.terminate()
    await handle.waitForExit()
    throw error
  }
}
