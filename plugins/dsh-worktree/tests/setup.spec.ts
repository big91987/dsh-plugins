import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { LocalWorktreeManager, WorktreeOperationId } from '../src/index.ts'
import { createTestRepository, git } from './support/git.ts'

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`file was not created before deadline: ${path}`)
    await delay(20)
  }
}

describe('LocalWorktreeManager setup', () => {
  it('runs setup in the destination with workspace variables and retains nonzero output', async () => {
    const repository = createTestRepository()
    const manager = new LocalWorktreeManager({ worktreeRoot: join(repository.container, 'managed-worktrees') })
    try {
      const created = await manager.create({
        operationId: WorktreeOperationId('setup-nonzero'),
        sourceCwd: repository.nestedCwd,
        environment: {
          name: 'test setup',
          command: 'printf "%s\\n%s\\n" "$DSH_SOURCE_WORKSPACE" "$DSH_WORKTREE_WORKSPACE" > setup-paths.txt; echo setup-ok; echo setup-note >&2; exit 7',
        },
      })

      expect(created.setup).toMatchObject({ kind: 'completed', exitCode: 7, signal: null })
      expect(created.setup.kind === 'completed' ? created.setup.stdout : '').toBe('setup-ok\n')
      expect(created.setup.kind === 'completed' ? created.setup.stderr : '').toBe('setup-note\n')
      expect(readFileSync(join(created.path, 'setup-paths.txt'), 'utf8')).toBe(`${repository.root}\n${created.path}\n`)
      expect(await manager.resolve(created.id)).toMatchObject({ id: created.id, path: created.path })
    } finally {
      await manager.dispose()
      repository.dispose()
    }
  })

  it('reports stages and output before setup completes', async () => {
    const repository = createTestRepository()
    const ready = join(repository.container, 'stream-ready')
    const release = join(repository.container, 'stream-release')
    const updates: Array<{ kind: string, stage?: string, stream?: string, text?: string }> = []
    const manager = new LocalWorktreeManager({ worktreeRoot: join(repository.container, 'managed-worktrees') })
    try {
      const creating = manager.create({
        operationId: WorktreeOperationId('stream-setup'),
        sourceCwd: repository.root,
        environment: {
          name: 'streaming setup',
          command: `echo early; touch '${ready}'; while [ ! -f '${release}' ]; do sleep 0.02; done; echo late >&2`,
        },
        onUpdate: update => updates.push(update),
      })

      await waitForFile(ready)
      try {
        expect(updates).toContainEqual({ kind: 'stage', stage: 'creating' })
        expect(updates).toContainEqual({ kind: 'stage', stage: 'setting-up' })
        expect(updates).toContainEqual({ kind: 'output', stream: 'stdout', text: 'early\n' })
      } finally {
        writeFileSync(release, '')
      }
      const created = await creating
      expect(updates).toContainEqual({ kind: 'output', stream: 'stderr', text: 'late\n' })
      expect(created.setup).toMatchObject({ kind: 'completed', stdout: 'early\n', stderr: 'late\n' })
    } finally {
      await manager.dispose()
      repository.dispose()
    }
  })

  it('retains only the configured setup-output tail', async () => {
    const repository = createTestRepository()
    const manager = new LocalWorktreeManager({
      worktreeRoot: join(repository.container, 'managed-worktrees'),
      maxSetupOutputBytes: 5,
    })
    try {
      const created = await manager.create({
        operationId: WorktreeOperationId('bounded-setup'),
        sourceCwd: repository.root,
        environment: { name: 'bounded', command: 'printf 123456789; printf abcdefghi >&2' },
      })
      expect(created.setup).toMatchObject({ kind: 'completed', stdout: '56789', stderr: 'efghi' })
    } finally {
      await manager.dispose()
      repository.dispose()
    }
  })

  it('cancels blocking setup and removes the allocated Worktree', async () => {
    const repository = createTestRepository()
    const ready = join(repository.container, 'setup-ready')
    const controller = new AbortController()
    const manager = new LocalWorktreeManager({
      worktreeRoot: join(repository.container, 'managed-worktrees'),
      graceMs: 100,
    })
    try {
      const creating = manager.create({
        operationId: WorktreeOperationId('cancel-setup'),
        sourceCwd: repository.root,
        environment: { name: 'blocking', command: `touch '${ready}'; sleep 60` },
        signal: controller.signal,
      })
      await waitForFile(ready)
      controller.abort()
      await expect(creating).rejects.toThrow(/aborted/i)
      expect(git(repository.root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)).toHaveLength(1)
    } finally {
      await manager.dispose()
      repository.dispose()
    }
  })
})
