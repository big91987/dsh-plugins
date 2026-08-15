import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { RepositoryLocation } from './paths.ts'
import type { GitRunner } from './runner.ts'

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function assertRepositoryRelative(path: string): void {
  const normalized = path.replaceAll('\\', '/')
  if (path === '' || isAbsolute(path) || normalized.split('/').some(segment => segment === '..' || segment === '')) {
    throw new Error(`dsh-worktree: selected path is outside the source repository: ${path}`)
  }
}

function copyRepositoryPath(sourceRoot: string, destinationRoot: string, path: string): void {
  assertRepositoryRelative(path)
  const source = join(sourceRoot, path)
  const destination = join(destinationRoot, path)
  const parentRelative = relative(sourceRoot, dirname(source))
  let cursor = sourceRoot
  if (parentRelative !== '') {
    for (const segment of parentRelative.split(sep)) {
      cursor = join(cursor, segment)
      if (lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`dsh-worktree: source path traverses a symlinked directory: ${path}`)
      }
    }
  }
  if (existsSync(destination)) return
  mkdirSync(dirname(destination), { recursive: true })
  const stat = lstatSync(source)
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(source)
    const resolvedTarget = realpathSync(resolve(dirname(source), target))
    if (!isWithin(sourceRoot, resolvedTarget)) {
      throw new Error(`dsh-worktree: symlink resolves outside the source repository: ${path}`)
    }
    symlinkSync(target, destination, stat.isDirectory() ? 'dir' : 'file')
    return
  }
  if (!stat.isFile()) throw new Error(`dsh-worktree: selected source path is not a regular file: ${path}`)
  copyFileSync(source, destination, constants.COPYFILE_EXCL)
}

async function listPaths(
  runner: GitRunner,
  sourceRoot: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const output = (await runner.run(
    ['git', '-C', sourceRoot, 'ls-files', ...args],
    { cwd: sourceRoot, preserveOutput: true, ...(signal === undefined ? {} : { signal }) },
  )).stdout
  return output.split('\0').filter(path => path !== '')
}

export async function listSelectedIgnoredPaths(
  runner: GitRunner,
  sourceRoot: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const paths = new Set(await listPaths(
    runner,
    sourceRoot,
    ['--others', '--ignored', '--exclude-standard', '-z', '--', ':(glob)**/AGENTS.override.md'],
    signal,
  ))
  const includePath = join(sourceRoot, '.worktreeinclude')
  if (!existsSync(includePath)) return [...paths]
  const pathspecs = readFileSync(includePath, 'utf8')
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
  for (const pathspec of pathspecs) assertRepositoryRelative(pathspec)
  if (pathspecs.length === 0) return [...paths]
  const selected = await listPaths(
    runner,
    sourceRoot,
    ['--others', '--ignored', '--exclude-standard', '-z', '--', ...pathspecs],
    signal,
  )
  for (const path of selected) paths.add(path)
  return [...paths]
}

/** Materialize the source's combined staged and unstaged tracked result. */
export async function transferTrackedState(
  runner: GitRunner,
  source: RepositoryLocation,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  const shared = { preserveOutput: true as const, ...(signal === undefined ? {} : { signal }) }
  const patch = (await runner.run(
    ['git', '-C', source.root, 'diff', '--binary', 'HEAD', '--'],
    { cwd: source.root, ...shared },
  )).stdout
  if (patch === '') return
  await runner.run(
    ['git', '-C', destination, 'apply', '--binary', '--whitespace=nowarn', '-'],
    { cwd: destination, stdin: patch, ...shared },
  )
}

/** Copy ordinary untracked files and explicitly selected ignored files. */
export async function transferSupplementalFiles(
  runner: GitRunner,
  source: RepositoryLocation,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  const paths = new Set(await listPaths(runner, source.root, ['--others', '--exclude-standard', '-z'], signal))
  for (const path of await listSelectedIgnoredPaths(runner, source.root, signal)) paths.add(path)
  for (const path of paths) copyRepositoryPath(source.root, destination, path)
}
