import { join } from 'node:path'
import { WorktreeId, WorktreeOwnerId } from '../brand.ts'
import type {
  ManagedWorktree,
  WorktreeOperationId,
  WorktreeOwnerId as WorktreeOwnerIdType,
} from '../types.ts'
import type { RepositoryLocation } from './paths.ts'
import type { GitRunner } from './runner.ts'

const KEYS = {
  id: 'dsh-worktree.id',
  operation: 'dsh-worktree.operation',
  sourceRoot: 'dsh-worktree.source-root',
  relativeCwd: 'dsh-worktree.relative-cwd',
  sourceHead: 'dsh-worktree.source-head',
  owner: 'dsh-worktree.owner',
} as const

async function set(runner: GitRunner, cwd: string, key: string, value: string, signal?: AbortSignal): Promise<void> {
  await runner.run(
    ['git', '-C', cwd, 'config', '--worktree', key, value],
    { cwd, ...(signal === undefined ? {} : { signal }) },
  )
}

async function get(runner: GitRunner, cwd: string, key: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    return (await runner.run(
      ['git', '-C', cwd, 'config', '--worktree', '--get', key],
      { cwd, ...(signal === undefined ? {} : { signal }) },
    )).stdout
  } catch (error) {
    if (signal?.aborted === true) throw new Error(`dsh-worktree: metadata read aborted for ${cwd}`, { cause: error })
    return undefined
  }
}

export async function writeInitialMetadata(
  runner: GitRunner,
  source: RepositoryLocation,
  destination: string,
  id: ReturnType<typeof WorktreeId>,
  operationId: WorktreeOperationId,
  signal?: AbortSignal,
): Promise<void> {
  await runner.run(
    ['git', '-C', source.root, 'config', 'extensions.worktreeConfig', 'true'],
    { cwd: source.root, ...(signal === undefined ? {} : { signal }) },
  )
  for (const [key, value] of [
    [KEYS.id, String(id)],
    [KEYS.operation, String(operationId)],
    [KEYS.sourceRoot, source.root],
    [KEYS.relativeCwd, source.relativeCwd],
    [KEYS.sourceHead, source.head],
  ] as const) {
    await set(runner, destination, key, value, signal)
  }
}

export async function readMetadata(
  runner: GitRunner,
  path: string,
  signal?: AbortSignal,
): Promise<ManagedWorktree | undefined> {
  const id = await get(runner, path, KEYS.id, signal)
  if (id === undefined) return undefined
  const sourceRoot = await get(runner, path, KEYS.sourceRoot, signal)
  const relativeCwd = await get(runner, path, KEYS.relativeCwd, signal)
  const sourceHead = await get(runner, path, KEYS.sourceHead, signal)
  if (sourceRoot === undefined || relativeCwd === undefined || sourceHead === undefined) {
    throw new Error(`dsh-worktree: managed metadata is incomplete for ${path}`)
  }
  const commonDir = (await runner.run(
    ['git', '-C', path, 'rev-parse', '--git-common-dir'],
    { cwd: path, ...(signal === undefined ? {} : { signal }) },
  )).stdout
  const owner = await get(runner, path, KEYS.owner, signal)
  return {
    id: WorktreeId(id),
    path,
    cwd: relativeCwd === '' ? path : join(path, relativeCwd),
    repositoryRoot: sourceRoot,
    repositoryCommonDir: commonDir,
    sourceHead,
    ...(owner === undefined ? {} : { ownerId: WorktreeOwnerId(owner) }),
    setup: { kind: 'skipped' },
  }
}

export async function writeOwner(
  runner: GitRunner,
  path: string,
  ownerId: WorktreeOwnerIdType,
  signal?: AbortSignal,
): Promise<void> {
  await set(runner, path, KEYS.owner, String(ownerId), signal)
}
