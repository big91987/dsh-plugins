import { access } from 'node:fs/promises'
import { describe, it } from 'vitest'

for (const name of ['dsh-worktree', 'dsh-session-coordination']) {
  describe(name, () => {
    it('builds the exact entry points declared by its package manifest', async () => {
      await access(new URL(`../plugins/${name}/lib/index.js`, import.meta.url))
      await access(new URL(`../plugins/${name}/lib/index.d.ts`, import.meta.url))
    })
  })
}
