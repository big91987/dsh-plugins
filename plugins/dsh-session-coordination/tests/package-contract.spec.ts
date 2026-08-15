import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('dsh-session-coordination package contract', () => {
  it('targets rc.6 and remains independent from dsh-worktree', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { compatibility?: { host?: string } }
      dependencies?: Record<string, string>
    }

    expect(manifest.dsh?.compatibility?.host).toBe('0.1.0-rc.6')
    expect(manifest.dependencies).not.toHaveProperty('dsh-worktree')
  })
})
