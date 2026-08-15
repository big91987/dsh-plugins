import { spawn } from 'node:child_process'

export interface GitRunOptions {
  readonly cwd: string
  readonly signal?: AbortSignal
  readonly stdin?: string
  readonly preserveOutput?: boolean
  readonly env?: NodeJS.ProcessEnv
}

export interface GitRunResult {
  readonly stdout: string
  readonly stderr: string
}

/** Execute one explicit Git argv with bounded retained output. */
export class GitRunner {
  constructor(private readonly maxOutputBytes: number) {}

  async run(argv: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
    const executable = argv[0]
    if (executable !== 'git') throw new TypeError('dsh-worktree: Git argv must begin with git')
    return new Promise<GitRunResult>((resolve, reject) => {
      const child = spawn(executable, argv.slice(1), {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: 'pipe',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let settled = false
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        child.kill('SIGKILL')
        reject(error)
      }
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length
        if (stdoutBytes > this.maxOutputBytes) fail(new Error('dsh-worktree: Git stdout exceeded maxOutputBytes'))
        else stdout.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length
        if (stderrBytes > this.maxOutputBytes) fail(new Error('dsh-worktree: Git stderr exceeded maxOutputBytes'))
        else stderr.push(chunk)
      })
      child.once('error', fail)
      child.once('close', (code, signal) => {
        if (settled) return
        settled = true
        const out = Buffer.concat(stdout).toString('utf8')
        const err = Buffer.concat(stderr).toString('utf8')
        if (code !== 0) {
          reject(new Error(`dsh-worktree: Git exited with ${String(code ?? signal)}: ${err.trim()}`))
          return
        }
        resolve({
          stdout: options.preserveOutput === true ? out : out.trim(),
          stderr: options.preserveOutput === true ? err : err.trim(),
        })
      })
      if (options.stdin === undefined) child.stdin.end()
      else child.stdin.end(options.stdin)
    })
  }
}
