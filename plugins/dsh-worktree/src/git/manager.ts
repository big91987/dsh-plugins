import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import type { CreateWorktreeRequest, ManagedWorktree } from '../types.ts'
import { WorktreeId } from '../index.ts'
import { ManagedRoot, resolveRepository } from './paths.ts'
import { GitRunner } from './runner.ts'
import { transferSupplementalFiles, transferTrackedState } from './transfer.ts'

export interface LocalWorktreeConfig {
  readonly worktreeRoot: string
  readonly maxOutputBytes?: number
}

function shardFor(commonDir: string, identity: string): string {
  return createHash('sha256').update(commonDir).update('\0').update(identity).digest('hex').slice(0, 4)
}

/** Local Git implementation of managed Worktree creation. */
export class LocalWorktreeManager {
  private readonly runner: GitRunner
  private readonly managedRoot: ManagedRoot

  constructor(config: LocalWorktreeConfig) {
    if (!isAbsolute(config.worktreeRoot)) throw new TypeError('dsh-worktree: worktreeRoot must be absolute')
    const maxOutputBytes = config.maxOutputBytes ?? 8 * 1024 * 1024
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
      throw new TypeError('dsh-worktree: maxOutputBytes must be a positive safe integer')
    }
    this.runner = new GitRunner(maxOutputBytes)
    this.managedRoot = new ManagedRoot(config.worktreeRoot)
  }

  async create(request: CreateWorktreeRequest): Promise<ManagedWorktree> {
    request.onUpdate?.({ kind: 'stage', stage: 'creating' })
    const source = await resolveRepository(this.runner, request.sourceCwd, request.signal)
    const id = WorktreeId(String(request.operationId))
    const destination = this.managedRoot.destination(
      shardFor(source.commonDir, String(request.operationId)),
      source.basename,
    )
    try {
      await this.runner.run(
        ['git', '-C', source.root, 'worktree', 'add', '--detach', destination, source.head],
        { cwd: source.root, ...(request.signal === undefined ? {} : { signal: request.signal }) },
      )
      await transferTrackedState(this.runner, source, destination, request.signal)
      await transferSupplementalFiles(this.runner, source, destination, request.signal)
      if (request.environment !== undefined) {
        throw new Error('dsh-worktree: setup execution is not implemented yet')
      }
      return {
        id,
        path: destination,
        cwd: source.relativeCwd === '' ? destination : join(destination, source.relativeCwd),
        repositoryRoot: source.root,
        repositoryCommonDir: source.commonDir,
        sourceHead: source.head,
        setup: { kind: 'skipped' },
      }
    } catch (error) {
      try {
        await this.runner.run(
          ['git', '-C', source.root, 'worktree', 'remove', '--force', destination],
          { cwd: source.root },
        )
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `dsh-worktree: failed to create and clean ${destination}`)
      }
      throw error
    }
  }

  async dispose(): Promise<void> {}
}
