import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { GitRunner } from './runner.ts'

export interface RepositoryLocation {
  readonly root: string
  readonly commonDir: string
  readonly relativeCwd: string
  readonly head: string
  readonly basename: string
}

export async function resolveRepository(
  runner: GitRunner,
  sourceCwd: string,
  signal?: AbortSignal,
): Promise<RepositoryLocation> {
  let rootOutput: string
  try {
    rootOutput = (await runner.run(
      ['git', '-C', sourceCwd, 'rev-parse', '--show-toplevel'],
      { cwd: sourceCwd, ...(signal === undefined ? {} : { signal }) },
    )).stdout
  } catch (error) {
    throw new Error(`dsh-worktree: source cwd is not a Git repository: ${sourceCwd}`, { cause: error })
  }
  const root = realpathSync(rootOutput)
  const canonicalCwd = realpathSync(sourceCwd)
  const relativeCwd = relative(root, canonicalCwd)
  if (relativeCwd === '..' || relativeCwd.startsWith(`..${sep}`) || isAbsolute(relativeCwd)) {
    throw new Error(`dsh-worktree: source cwd is outside repository root: ${sourceCwd}`)
  }
  const run = (args: readonly string[]) => runner.run(
    ['git', '-C', root, ...args],
    { cwd: root, ...(signal === undefined ? {} : { signal }) },
  )
  const commonOutput = (await run(['rev-parse', '--git-common-dir'])).stdout
  const commonDir = realpathSync(isAbsolute(commonOutput) ? commonOutput : resolve(root, commonOutput))
  const head = (await run(['rev-parse', 'HEAD'])).stdout
  return { root, commonDir, relativeCwd, head, basename: basename(root) }
}

function nearestExistingAncestor(path: string): { existing: string, suffix: string[] } {
  const suffix: string[] = []
  let cursor = path
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error(`dsh-worktree: no existing ancestor for managed root ${path}`)
    suffix.unshift(basename(cursor))
    cursor = parent
  }
  return { existing: realpathSync(cursor), suffix }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Allocate canonical descendants of one configured managed root. */
export class ManagedRoot {
  private readonly configured: string

  constructor(configured: string) {
    if (!isAbsolute(configured)) throw new TypeError('dsh-worktree: worktreeRoot must be absolute')
    this.configured = resolve(configured)
  }

  destination(shard: string, repositoryBasename: string): string {
    if (!/^[0-9a-f]{4}$/.test(shard)) throw new TypeError('dsh-worktree: managed shard must be four lowercase hex characters')
    if (repositoryBasename === '' || repositoryBasename === '.' || repositoryBasename === '..'
      || repositoryBasename.includes('/') || repositoryBasename.includes('\\')) {
      throw new TypeError('dsh-worktree: repository basename must be one path segment')
    }
    const { existing, suffix } = nearestExistingAncestor(this.configured)
    let root = existing
    for (const segment of suffix) {
      root = join(root, segment)
      mkdirSync(root)
    }
    root = realpathSync(root)
    const shardPath = join(root, shard)
    if (existsSync(shardPath)) {
      const stat = lstatSync(shardPath)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`dsh-worktree: managed root shard is not a real directory: ${shardPath}`)
      }
    } else {
      mkdirSync(shardPath)
    }
    const canonicalShard = realpathSync(shardPath)
    if (!isWithin(root, canonicalShard)) throw new Error(`dsh-worktree: destination escapes managed root: ${canonicalShard}`)
    const destination = join(canonicalShard, repositoryBasename)
    if (!isWithin(root, destination)) throw new Error(`dsh-worktree: destination escapes managed root: ${destination}`)
    if (existsSync(destination)) throw new Error(`dsh-worktree: managed destination already exists: ${destination}`)
    return destination
  }
}
