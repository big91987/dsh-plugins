import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** The requested Session prefix cannot form a completed continuation seed. */
export class ContinuationUnavailableError extends Error {
  constructor(
    readonly sessionId: string,
    readonly atSeq: number | undefined,
    readonly reason: 'no-completed-turn' | 'anchored-turn-incomplete',
  ) {
    super(reason === 'anchored-turn-incomplete'
      ? `session "${sessionId}" has not completed the turn containing event ${String(atSeq)}`
      : `session "${sessionId}" has no completed turn to continue from`)
    this.name = 'ContinuationUnavailableError'
  }
}

/** Select a balanced completed-turn prefix plus trailing between-turn events. */
export function completedHistory(
  sessionId: string,
  events: readonly SessionEvent[],
  atSeq?: number,
): SessionEvent[] {
  const lastSeq = events.at(-1)?.seq ?? -1
  const anchoredBoundary = atSeq === undefined
    ? undefined
    : events.find(event => event.type === 'turn/end' && event.seq >= atSeq)
  const boundary = anchoredBoundary
    ?? (atSeq === undefined || atSeq > lastSeq
      ? events.findLast(event => event.type === 'turn/end')
      : undefined)
  if (boundary === undefined) {
    throw new ContinuationUnavailableError(
      sessionId,
      atSeq,
      atSeq !== undefined && atSeq <= lastSeq ? 'anchored-turn-incomplete' : 'no-completed-turn',
    )
  }
  let cut = events.findIndex(event => event.seq === boundary.seq) + 1
  while (cut < events.length && events[cut]?.type !== 'turn/start') cut++
  return structuredClone(events.slice(0, cut))
}
