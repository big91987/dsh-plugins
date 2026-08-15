import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './service.ts'

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

const pretty = (value: unknown): string => JSON.stringify(value, null, 2)

function callingSessionId(agent: Agent | undefined): SessionId {
  if (agent === undefined) throw new Error('send_message_to_thread requires a calling Session')
  return agent.id
}

/** Register model tools for independent peer Sessions, not subagent delegation. */
export function registerTools(ctx: Context): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'list_threads',
    description: 'List independent Sessions, including running, idle, and stored conversations, without resuming them.',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (_args, exec) => pretty(await ctx.sessionCoordination.listThreads(exec.signal)),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'read_thread',
    description: 'Read one independent Session history. Use after_cursor to return only events not already seen.',
    parameters: {
      thread_id: { type: 'string', required: true, description: 'Session id to inspect.' },
      after_cursor: { type: 'integer', description: 'Highest event sequence already seen.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async args => pretty(await ctx.sessionCoordination.readThread(
      SessionId(args.thread_id),
      args.after_cursor,
    )),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'send_message_to_thread',
    description: 'Send a message to another independent Session as its next turn, cold-resuming a stored Session when needed.',
    parameters: {
      thread_id: { type: 'string', required: true, description: 'Recipient Session id.' },
      message: { type: 'string', required: true, description: 'Message to deliver.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => pretty(await ctx.sessionCoordination.sendMessage(
      callingSessionId(exec.agent),
      SessionId(args.thread_id),
      args.message,
      exec.signal,
    )),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'wait_threads',
    description: 'Wait for any named running Session to become idle, then return fresh snapshots for all targets.',
    parameters: {
      targets: {
        type: 'array',
        required: true,
        description: 'One to eight Session ids with optional last-seen cursors.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            thread_id: { type: 'string', required: true },
            after_cursor: { type: 'integer' },
          },
        },
      },
      timeout_ms: { type: 'integer', description: 'Maximum wait in milliseconds; defaults to 30000.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => pretty(await ctx.sessionCoordination.waitThreads(
      args.targets.map(target => ({
        threadId: SessionId(target.thread_id),
        ...(target.after_cursor === undefined ? {} : { afterCursor: target.after_cursor }),
      })),
      args.timeout_ms ?? 30_000,
      exec.signal,
    )),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'fork_thread',
    description: 'Continue an independent Session in a new chat from a completed-turn history prefix.',
    parameters: {
      thread_id: { type: 'string', required: true, description: 'Source Session id.' },
      at_seq: { type: 'integer', description: 'Optional source event anchor.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => pretty(await ctx.sessionCoordination.forkThread(
      SessionId(args.thread_id),
      args.at_seq,
      exec.signal,
    )),
  })))
}
