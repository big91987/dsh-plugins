import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('dsh-worktree package contract', () => {
  it('pins the rc.6 host and replaces only the built-in Workspace row', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: {
        bundle?: { patch?: string }
        client?: { platform?: string }
        compatibility?: { host?: string }
      }
    }
    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

    expect(manifest.dsh).toMatchObject({
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web' },
      compatibility: { host: '0.1.0-rc.6' },
    })
    expect(patch).toMatch(/^- id: ui-workspace\n  disabled: true$/m)
    expect(patch).toMatch(/^- insert:\n    - id: dsh-worktree\n      name: dsh-worktree$/m)
    expect(patch.indexOf('- id: ui-workspace')).toBeLessThan(patch.indexOf('- insert:'))
  })
})
