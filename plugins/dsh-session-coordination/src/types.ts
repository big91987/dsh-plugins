import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

/** Current availability of one independent Session. */
export type ThreadStatus = 'running' | 'idle' | 'stored'

/** Lightweight Session row returned by discovery. */
export interface ThreadSummary {
  readonly threadId: SessionId
  readonly title: string
  readonly status: ThreadStatus
  readonly cwd?: string
  readonly cursor: number
  readonly updatedAt: number
}

/** Exact durable Session read. */
export interface ThreadRead extends ThreadSummary {
  readonly header: SessionHeader
  readonly events: SessionEvent[]
}

/** One Session and cursor in a bounded wait. */
export interface ThreadWaitTarget {
  readonly threadId: SessionId
  readonly afterCursor?: number
}

/** Identity of a message accepted by a peer Session inbox. */
export interface ThreadMessageReceipt {
  readonly messageId: string
}
