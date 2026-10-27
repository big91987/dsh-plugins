import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

for (const name of ['dsh-worktree', 'dsh-session-coordination', 'dsh-project-task-board']) {
  describe(name, () => {
    it('declares its own DSH bundle patch', async () => {
      const manifestUrl = new URL(`../plugins/${name}/package.json`, import.meta.url)
      const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as {
        name?: unknown
        files?: unknown[]
        dsh?: { bundle?: { patch?: unknown }; compatibility?: { host?: unknown } }
      }

      expect(manifest.name).toBe(name)
      expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
      expect(manifest.files).toContain('cordis.patch.yml')
      if (name === 'dsh-project-task-board') {
        expect(manifest.dsh?.compatibility?.host).toBe('0.2.0-rc.2')
      }
    })
  })
}
