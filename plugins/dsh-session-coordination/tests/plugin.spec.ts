import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import * as SessionCoordinationPlugin from '../src/index.ts'

describe('dsh-session-coordination plugin lifecycle', () => {
  it('contributes all five tools once and removes them with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('agents', { get: vi.fn(), create: vi.fn(), resume: vi.fn() } as never)
    ctx.provide('agentPresets', { mount: vi.fn() } as never)
    ctx.provide('sessionQuery', {} as never)
    ctx.provide('workspaceRegistry', { list: () => [] } as never)

    const fiber = await ctx.plugin(SessionCoordinationPlugin)
    const names = () => ctx.tools.schemas().map(schema => schema.name)
      .filter(name => name.endsWith('thread') || name.endsWith('threads'))

    expect(names()).toEqual(['list_threads', 'read_thread', 'send_message_to_thread', 'wait_threads', 'fork_thread'])
    await fiber.dispose()
    expect(names()).toEqual([])
  })
})
