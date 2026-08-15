import { existsSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LocalWorktreeManager, WorktreeOperationId } from '../src/index.ts'
import { createTestRepository, git } from './support/git.ts'

describe('LocalWorktreeManager.create', () => {
  it('creates a detached nested checkout from dirty tracked state without changing the source', async () => {
    const repository = createTestRepository()
    const tracked = join(repository.nestedCwd, 'index.ts')
    writeFileSync(tracked, 'export const value = 2\n')
    git(repository.root, ['add', 'packages/example/index.ts'])
    writeFileSync(tracked, 'export const value = 3\n')
    const sourceBefore = {
      head: git(repository.root, ['rev-parse', 'HEAD']),
      staged: git(repository.root, ['diff', '--cached', '--binary']),
      unstaged: git(repository.root, ['diff', '--binary']),
      status: git(repository.root, ['status', '--porcelain=v1', '-z']),
    }

    const manager = new LocalWorktreeManager({
      worktreeRoot: join(repository.container, 'managed-worktrees'),
    })
    try {
      const created = await manager.create({
        operationId: WorktreeOperationId('dirty-tracked'),
        sourceCwd: repository.nestedCwd,
      })

      expect(created.repositoryRoot).toBe(repository.root)
      expect(created.repositoryCommonDir).toBe(join(repository.root, '.git'))
      expect(created.sourceHead).toBe(repository.head)
      expect(created.cwd).toBe(join(created.path, 'packages', 'example'))
      expect(created.setup).toEqual({ kind: 'skipped' })
      expect(git(created.path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('HEAD')
      expect(readFileSync(join(created.cwd, 'index.ts'), 'utf8')).toBe('export const value = 3\n')
      expect({
        head: git(repository.root, ['rev-parse', 'HEAD']),
        staged: git(repository.root, ['diff', '--cached', '--binary']),
        unstaged: git(repository.root, ['diff', '--binary']),
        status: git(repository.root, ['status', '--porcelain=v1', '-z']),
      }).toEqual(sourceBefore)
    } finally {
      await manager.dispose()
      repository.dispose()
    }
  })

  it('copies untracked files, safe symlinks, AGENTS overrides, and worktreeinclude selections', async () => {
    const repository = createTestRepository()
    writeFileSync(join(repository.root, '.gitignore'), 'ignored.txt\ncache/\n**/AGENTS.override.md\n')
    writeFileSync(join(repository.root, '.worktreeinclude'), 'ignored.txt\ncache/**\n')
    git(repository.root, ['add', '.gitignore', '.worktreeinclude'])
    git(repository.root, ['commit', '-m', 'configure transfer'])
    writeFileSync(join(repository.root, 'notes.txt'), 'ordinary untracked\n')
    symlinkSync('notes.txt', join(repository.root, 'notes-link'))
    writeFileSync(join(repository.root, 'ignored.txt'), 'selected ignored\n')
    mkdirSync(join(repository.root, 'cache'))
    writeFileSync(join(repository.root, 'cache', 'state.json'), '{"selected":true}\n')
    writeFileSync(join(repository.nestedCwd, 'AGENTS.override.md'), 'nested instructions\n')

    const manager = new LocalWorktreeManager({ worktreeRoot: join(repository.container, 'managed-worktrees') })
    try {
      const created = await manager.create({
        operationId: WorktreeOperationId('supplemental-files'),
        sourceCwd: repository.nestedCwd,
      })

      expect(readFileSync(join(created.path, 'notes.txt'), 'utf8')).toBe('ordinary untracked\n')
      expect(readlinkSync(join(created.path, 'notes-link'))).toBe('notes.txt')
      expect(readFileSync(join(created.path, 'ignored.txt'), 'utf8')).toBe('selected ignored\n')
      expect(readFileSync(join(created.path, 'cache', 'state.json'), 'utf8')).toBe('{"selected":true}\n')
      expect(readFileSync(join(created.cwd, 'AGENTS.override.md'), 'utf8')).toBe('nested instructions\n')
    } finally {
      await manager.dispose()
      repository.dispose()
    }
  })

  it('rejects an untracked symlink escaping the source and removes the allocated checkout', async () => {
    const repository = createTestRepository()
    writeFileSync(join(repository.container, 'outside.txt'), 'must not copy\n')
    symlinkSync('../outside.txt', join(repository.root, 'escape-link'))
    const worktreeRoot = join(repository.container, 'managed-worktrees')
    const manager = new LocalWorktreeManager({ worktreeRoot })
    try {
      await expect(manager.create({
        operationId: WorktreeOperationId('escaping-symlink'),
        sourceCwd: repository.root,
      })).rejects.toThrow(/symlink.*outside/i)
      expect(git(repository.root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)).toHaveLength(1)
      expect(existsSync(join(worktreeRoot, 'outside.txt'))).toBe(false)
    } finally {
      await manager.dispose()
      repository.dispose()
    }
  })
})
