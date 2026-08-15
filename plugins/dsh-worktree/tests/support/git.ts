import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TestRepository {
  readonly container: string
  readonly root: string
  readonly nestedCwd: string
  readonly head: string
  dispose(): void
}

export function createTestRepository(): TestRepository {
  const container = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-worktree-')))
  const root = join(container, 'source-repository')
  const nestedCwd = join(root, 'packages', 'example')
  mkdirSync(nestedCwd, { recursive: true })
  writeFileSync(join(root, 'README.md'), 'source\n')
  writeFileSync(join(nestedCwd, 'index.ts'), 'export const value = 1\n')
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Worktree Test'])
  execFileSync('git', ['-C', root, 'config', 'user.email', 'worktree@example.invalid'])
  execFileSync('git', ['-C', root, 'add', '.'])
  execFileSync('git', ['-C', root, 'commit', '-qm', 'initial'])
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  return {
    container,
    root,
    nestedCwd,
    head,
    dispose: () => { rmSync(container, { recursive: true, force: true }) },
  }
}

export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}
