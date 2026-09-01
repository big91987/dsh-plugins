import { access } from 'node:fs/promises'
import { describe, it } from 'vitest'

for (const name of ['dsh-worktree', 'dsh-session-coordination']) {
  describe(name, () => {
    it('builds the exact entry points declared by its package manifest', async () => {
      await access(new URL(`../plugins/${name}/lib/index.js`, import.meta.url))
      await access(new URL(`../plugins/${name}/lib/types/index.d.ts`, import.meta.url))
    })
  })
}

describe('dsh-project-task-board', () => {
  it('builds its Host, browser, and declaration entry points', async () => {
    await access(new URL('../plugins/dsh-project-task-board/lib/index.js', import.meta.url))
    await access(new URL('../plugins/dsh-project-task-board/lib/client.js', import.meta.url))
    await access(new URL('../plugins/dsh-project-task-board/lib/types/index.d.ts', import.meta.url))
  })
})
