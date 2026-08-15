import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { ManagedWorktree, WorktreeSnapshot } from '../types.ts'
import type { GitRunner } from './runner.ts'
import { listSelectedIgnoredPaths } from './transfer.ts'

/** Persist current Worktree content through a private index and recovery ref. */
export async function createSnapshot(
  runner: GitRunner,
  record: ManagedWorktree,
  signal?: AbortSignal,
): Promise<WorktreeSnapshot> {
  const temp = mkdtempSync(join(tmpdir(), 'dsh-worktree-snapshot-'))
  const env = { GIT_INDEX_FILE: join(temp, 'index') }
  const run = (args: readonly string[], stdin?: string) => runner.run(
    ['git', '-C', record.path, ...args],
    {
      cwd: record.path,
      env,
      ...(stdin === undefined ? {} : { stdin }),
      ...(signal === undefined ? {} : { signal }),
    },
  )
  try {
    const head = (await run(['rev-parse', 'HEAD'])).stdout
    await run(['read-tree', head])
    await run(['add', '-A', '--', '.'])
    const selectedIgnored = await listSelectedIgnoredPaths(runner, record.path, signal)
    if (selectedIgnored.length > 0) await run(['add', '-f', '--', ...selectedIgnored])
    const tree = (await run(['write-tree'])).stdout
    const commit = (await run(
      ['commit-tree', tree, '-p', head],
      `DeepSeek Harness Worktree snapshot ${record.id}\n`,
    )).stdout
    const ref = `refs/dsh/worktrees/${record.id}`
    await run(['update-ref', ref, commit])
    return {
      id: record.id,
      ref,
      sourceHead: record.sourceHead,
      repositoryRoot: record.repositoryRoot,
      repositoryCommonDir: record.repositoryCommonDir,
      relativeCwd: relative(record.path, record.cwd),
      ...(record.ownerId === undefined ? {} : { ownerId: record.ownerId }),
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
