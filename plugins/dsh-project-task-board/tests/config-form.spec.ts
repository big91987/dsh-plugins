import { describe, expect, it } from 'vitest'
import { CardForm, booleanField } from '../src/client/settings-form.ts'

describe('DSH 0.2 ConfigForm staged settings', () => {
  it('saves all changes in one revision-fenced mutation and keeps refused drafts', async () => {
    let accepted = false
    const calls: unknown[] = []
    const snapshot = { status: 'ready' as const, value: { enabled: true, preventIdleSleep: false }, base: {}, user: {}, revision: 7, writable: true, mode: 'host' as const }
    const scope = { getSnapshot: () => snapshot, subscribe: () => () => {}, set: async () => false, unset: async () => false,
      mutate: async (ops: unknown, revision?: number) => { calls.push({ ops, revision }); return accepted } }
    const form = new CardForm(scope, [booleanField('enabled'), booleanField('preventIdleSleep')])
    form.actions().edit('enabled', 'false')
    form.actions().edit('preventIdleSleep', 'true')
    await form.save()
    expect(calls).toEqual([{ ops: [{ op: 'set', path: ['enabled'], value: false }, { op: 'set', path: ['preventIdleSleep'], value: true }], revision: 7 }])
    expect(form.shell()).toMatchObject({ dirty: true, failed: true, saving: false })
    accepted = true
    await form.save()
    expect(form.shell()).toMatchObject({ dirty: false, failed: false, saving: false })
    form.dispose()
  })
  it('keeps drafts and finishes saving after transport rejection', async () => {
    const scope = { getSnapshot: () => ({ status: 'ready' as const, value: { enabled: true }, base: {}, user: {}, revision: 1, writable: true, mode: 'host' as const }), subscribe: () => () => {}, set: async () => false, unset: async () => false,
      mutate: async () => { throw new Error('offline') } }
    const form = new CardForm(scope, [booleanField('enabled')])
    form.actions().edit('enabled', 'false')
    await form.save()
    expect(form.shell()).toMatchObject({ dirty: true, saving: false, failed: true, failedReason: 'offline' })
    form.dispose()
  })
})
