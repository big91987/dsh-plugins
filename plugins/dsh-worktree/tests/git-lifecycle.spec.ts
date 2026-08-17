import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LocalWorktreeManager,
  WorktreeId,
  WorktreeOperationId,
  WorktreeOwnerId,
} from '../src/index.ts'
import { createTestRepository, git } from './support/git.ts'

describe('LocalWorktreeManager recovery lifecycle', () => {
  it('snapshots without changing the index, deletes by managed id, and restores content and owner', async () => {
    const repository = createTestRepository()
    writeFileSync(join(repository.root, 'README.md'), 'dirty tracked\n')
    writeFileSync(join(repository.root, 'untracked.txt'), 'dirty untracked\n')
    writeFileSync(join(repository.root, '.gitignore'), '*.cache\n')
    writeFileSync(join(repository.root, '.worktreeinclude'), 'state.cache\n')
    writeFileSync(join(repository.root, 'state.cache'), 'selected ignored state\n')
    const manager = new LocalWorktreeManager({ worktreeRoot: join(repository.container, 'managed-worktrees') })
    try {
      const created = await manager.create({
        operationId: WorktreeOperationId('recovery-lifecycle'),
        sourceCwd: repository.nestedCwd,
      })
      const ownerId = WorktreeOwnerId('owner-session')
      await manager.setOwner(created.id, ownerId)
      await expect(manager.list()).resolves.toEqual([
        expect.objectContaining({
          id: created.id,
          cwd: created.cwd,
          repositoryRoot: repository.root,
          ownerId,
        }),
      ])
      const statusBefore = git(created.path, ['status', '--porcelain=v1', '-z'])

      const snapshot = await manager.snapshot(created.id)
      expect(snapshot).toMatchObject({
        id: created.id,
        ref: `refs/dsh/worktrees/${created.id}`,
        sourceHead: repository.head,
        repositoryRoot: repository.root,
        repositoryCommonDir: join(repository.root, '.git'),
        relativeCwd: join('packages', 'example'),
        ownerId,
      })
      expect(() => git(repository.root, ['cat-file', '-e', `${snapshot.ref}^{commit}`])).not.toThrow()
      expect(git(created.path, ['status', '--porcelain=v1', '-z'])).toBe(statusBefore)

      await manager.delete({ id: created.id, force: true })
      expect(existsSync(created.path)).toBe(false)
      expect(await manager.resolve(created.id)).toBeUndefined()

      const restored = await manager.restore(snapshot)
      expect(restored).toMatchObject({ id: created.id, ownerId, cwd: join(restored.path, 'packages', 'example') })
      expect(readFileSync(join(restored.path, 'README.md'), 'utf8')).toBe('dirty tracked\n')
      expect(readFileSync(join(restored.path, 'untracked.txt'), 'utf8')).toBe('dirty untracked\n')
      expect(readFileSync(join(restored.path, 'state.cache'), 'utf8')).toBe('selected ignored state\n')
      expect(git(restored.path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('HEAD')
    } finally {
      await manager.dispose()
      repository.dispose()
    }
  })

  it('rejects unknown deletion and a missing snapshot ref before allocation', async () => {
    const repository = createTestRepository()
    const worktreeRoot = join(repository.container, 'managed-worktrees')
    const manager = new LocalWorktreeManager({ worktreeRoot })
    try {
      await expect(manager.delete({ id: WorktreeId('unmanaged'), force: true }))
        .rejects.toThrow(/unknown managed Worktree/)
      await expect(manager.restore({
        id: WorktreeId('missing-snapshot'),
        ref: 'refs/dsh/worktrees/missing-snapshot',
        sourceHead: repository.head,
        repositoryRoot: repository.root,
        repositoryCommonDir: join(repository.root, '.git'),
        relativeCwd: '',
      })).rejects.toThrow(/snapshot ref.*missing/i)
      expect(existsSync(join(worktreeRoot, basename(repository.root)))).toBe(false)
      expect(git(repository.root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)).toHaveLength(1)
    } finally {
      await manager.dispose()
      repository.dispose()
    }
  })
})
