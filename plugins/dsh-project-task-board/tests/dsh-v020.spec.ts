import { describe, expect, it } from 'vitest'
import { HostExecutionRunner } from '../src/host-runner.ts'

describe('official DSH 0.2 Host contracts', () => {
  it('sends an identified prompt only after the direct controller accepts pins', async () => {
    const sent: unknown[] = []
    const api = {
      workspace: { list: () => [{ id: 'workspace-a', path: '/project' }] },
      agentPresets: { list: async () => [{ id: 'preset-a', isDefault: true }] },
      sessions: {
        create: async (input: unknown) => { sent.push(input); return { sessionId: 'session-a' } },
        rename: async () => ({ title: 'Task', seq: 1 }),
        prompt: async (input: unknown) => { sent.push(input); return { accepted: true } },
      },
    }
    const runner = new HostExecutionRunner(api as never)
    await expect(runner.launch({ title: 'Task', prompt: 'do work', workspaceId: 'workspace-a', mode: 'preset-a' } as never)).resolves.toBe('session-a')
    expect(sent[0]).toEqual({ workspaceId: 'workspace-a', agentPreset: 'preset-a' })
    expect(sent[1]).toMatchObject({ sessionId: 'session-a', requestId: expect.any(String), mode: 'queue', content: [{ type: 'text', text: 'do work' }] })
  })
})
