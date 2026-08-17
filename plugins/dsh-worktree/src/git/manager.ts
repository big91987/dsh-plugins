import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { WorktreeId, WorktreeOperationId } from '../brand.ts'
import type {
  CreateWorktreeRequest,
  DeleteWorktreeRequest,
  ManagedWorktree,
  WorktreeId as WorktreeIdType,
  WorktreeOwnerId,
  WorktreeSnapshot,
} from '../types.ts'
import { readMetadata, writeInitialMetadata, writeOwner } from './metadata.ts'
import { ManagedRoot, resolveRepository } from './paths.ts'
import { GitRunner } from './runner.ts'
import { NodeSetupRuntime, runSetup } from './setup.ts'
import type { SetupRuntime } from './setup.ts'
import { createSnapshot } from './snapshot.ts'
import { transferSupplementalFiles, transferTrackedState } from './transfer.ts'

export interface LocalWorktreeConfig {
  readonly worktreeRoot: string
  readonly maxOutputBytes?: number
  readonly maxSetupOutputBytes?: number
  readonly graceMs?: number
}

function shardFor(commonDir: string, identity: string): string {
  return createHash('sha256').update(commonDir).update('\0').update(identity).digest('hex').slice(0, 4)
}

/** Local Git implementation of managed Worktree creation. */
export class LocalWorktreeManager {
  private readonly runner: GitRunner
  private readonly managedRoot: ManagedRoot
  private readonly maxSetupOutputBytes: number
  private readonly graceMs: number

  constructor(config: LocalWorktreeConfig, private readonly setupRuntime: SetupRuntime = new NodeSetupRuntime()) {
    if (!isAbsolute(config.worktreeRoot)) throw new TypeError('dsh-worktree: worktreeRoot must be absolute')
    const maxOutputBytes = config.maxOutputBytes ?? 8 * 1024 * 1024
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
      throw new TypeError('dsh-worktree: maxOutputBytes must be a positive safe integer')
    }
    this.runner = new GitRunner(maxOutputBytes)
    this.managedRoot = new ManagedRoot(config.worktreeRoot)
    this.maxSetupOutputBytes = config.maxSetupOutputBytes ?? 1_048_576
    this.graceMs = config.graceMs ?? 3_000
    if (!Number.isSafeInteger(this.maxSetupOutputBytes) || this.maxSetupOutputBytes < 1) {
      throw new TypeError('dsh-worktree: maxSetupOutputBytes must be a positive safe integer')
    }
    if (!Number.isSafeInteger(this.graceMs) || this.graceMs < 1) {
      throw new TypeError('dsh-worktree: graceMs must be a positive safe integer')
    }
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
      await writeInitialMetadata(this.runner, source, destination, id, request.operationId, request.signal)
      let setup: ManagedWorktree['setup'] = { kind: 'skipped' }
      if (request.environment !== undefined) {
        request.onUpdate?.({ kind: 'stage', stage: 'setting-up' })
        setup = await runSetup(this.setupRuntime, {
          environment: request.environment,
          sourceWorkspace: source.root,
          worktreeWorkspace: destination,
          maxOutputBytes: this.maxSetupOutputBytes,
          graceMs: this.graceMs,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          ...(request.onUpdate === undefined ? {} : { onUpdate: request.onUpdate }),
        })
      }
      return {
        id,
        path: destination,
        cwd: source.relativeCwd === '' ? destination : join(destination, source.relativeCwd),
        repositoryRoot: source.root,
        repositoryCommonDir: source.commonDir,
        sourceHead: source.head,
        setup,
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

  async resolve(id: WorktreeIdType, signal?: AbortSignal): Promise<ManagedWorktree | undefined> {
    for (const candidate of this.managedRoot.candidates()) {
      const record = await readMetadata(this.runner, candidate, signal)
      if (record?.id === id) return record
    }
    return undefined
  }

  /** List managed Worktrees recovered from their durable Git metadata. */
  async list(signal?: AbortSignal): Promise<readonly ManagedWorktree[]> {
    const records: ManagedWorktree[] = []
    for (const candidate of this.managedRoot.candidates()) {
      const record = await readMetadata(this.runner, candidate, signal)
      if (record !== undefined) records.push(record)
    }
    return records
  }

  async setOwner(id: WorktreeIdType, ownerId: WorktreeOwnerId, signal?: AbortSignal): Promise<void> {
    const record = await this.resolve(id, signal)
    if (record === undefined) throw new Error(`dsh-worktree: unknown managed Worktree ${id}`)
    await writeOwner(this.runner, record.path, ownerId, signal)
  }

  async snapshot(id: WorktreeIdType, signal?: AbortSignal): Promise<WorktreeSnapshot> {
    const record = await this.resolve(id, signal)
    if (record === undefined) throw new Error(`dsh-worktree: unknown managed Worktree ${id}`)
    return createSnapshot(this.runner, record, signal)
  }

  async restore(snapshot: WorktreeSnapshot, signal?: AbortSignal): Promise<ManagedWorktree> {
    let commit: string
    try {
      commit = (await this.runner.run(
        ['git', '-C', snapshot.repositoryRoot, 'rev-parse', '--verify', `${snapshot.ref}^{commit}`],
        { cwd: snapshot.repositoryRoot, ...(signal === undefined ? {} : { signal }) },
      )).stdout
    } catch (error) {
      throw new Error(`dsh-worktree: snapshot ref is missing: ${snapshot.ref}`, { cause: error })
    }
    const repositoryBasename = snapshot.repositoryRoot.split(/[\\/]/u).at(-1) ?? 'repository'
    const destination = this.managedRoot.destination(
      shardFor(snapshot.repositoryCommonDir, String(snapshot.id)),
      repositoryBasename,
    )
    try {
      await this.runner.run(
        ['git', '-C', snapshot.repositoryRoot, 'worktree', 'add', '--detach', destination, commit],
        { cwd: snapshot.repositoryRoot, ...(signal === undefined ? {} : { signal }) },
      )
      const source = {
        root: snapshot.repositoryRoot,
        commonDir: snapshot.repositoryCommonDir,
        relativeCwd: snapshot.relativeCwd,
        head: snapshot.sourceHead,
        basename: repositoryBasename,
      }
      await writeInitialMetadata(
        this.runner,
        source,
        destination,
        snapshot.id,
        WorktreeOperationId(String(snapshot.id)),
        signal,
      )
      if (snapshot.ownerId !== undefined) await writeOwner(this.runner, destination, snapshot.ownerId, signal)
      const restored = await readMetadata(this.runner, destination, signal)
      if (restored === undefined) throw new Error(`dsh-worktree: restored metadata is missing for ${snapshot.id}`)
      return restored
    } catch (error) {
      try {
        await this.runner.run(
          ['git', '-C', snapshot.repositoryRoot, 'worktree', 'remove', '--force', destination],
          { cwd: snapshot.repositoryRoot },
        )
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `dsh-worktree: failed to restore and clean ${destination}`)
      }
      throw error
    }
  }

  async delete(request: DeleteWorktreeRequest): Promise<void> {
    const record = await this.resolve(request.id, request.signal)
    if (record === undefined) throw new Error(`dsh-worktree: unknown managed Worktree ${request.id}`)
    await this.runner.run(
      [
        'git', '-C', record.repositoryRoot, 'worktree', 'remove',
        ...(request.force ? ['--force'] : []),
        record.path,
      ],
      { cwd: record.repositoryRoot, ...(request.signal === undefined ? {} : { signal: request.signal }) },
    )
  }

  async dispose(): Promise<void> {}
}
