import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

const originalDocument = globalThis.document

afterEach(() => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: originalDocument,
  })
})

describe('dsh-worktree browser loading probe', () => {
  it('publishes a DOM marker for its plugin lifetime', () => {
    const dataset: Record<string, string | undefined> = {}
    let dispose: (() => void) | undefined
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement: { dataset } },
    })
    const ctx = {
      effect(setup: () => () => void) {
        dispose = setup()
      },
      provide() {},
    } as unknown as Context

    apply(ctx)

    expect(dataset.dshWorktreeProbe).toBe('loaded')

    dispose?.()

    expect(dataset.dshWorktreeProbe).toBeUndefined()
  })
})
