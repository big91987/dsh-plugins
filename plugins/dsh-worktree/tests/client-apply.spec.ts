import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import worktreeRemote from '../src/remote-client.ts'
import { apply, inject } from '../src/client/index.ts'

describe('dsh-worktree browser plugin', () => {
  it('mounts and disposes its strict Worktree Remote contribution', async () => {
    const dispose = vi.fn(() => Promise.resolve())
    const mount = vi.fn(() => Promise.resolve(dispose))
    const ctx = { remote: { $mount: mount } } as unknown as Context

    const cleanup = await apply(ctx)

    expect(inject).toEqual(['remote'])
    expect(mount).toHaveBeenCalledWith(worktreeRemote)
    await cleanup()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
