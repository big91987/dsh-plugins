import { describe, expect, it } from 'vitest'
import { completedHistory, ContinuationUnavailableError } from '../src/continuation/history.ts'

interface Event {
  readonly type: string
  readonly seq: number
  readonly time: number
}

function history(openTail = false): Event[] {
  const events: Event[] = []
  let seq = 0
  for (let turn = 1; turn <= 2; turn++) {
    events.push({ type: 'turn/start', seq: seq++, time: seq })
    events.push({ type: 'user/message', seq: seq++, time: seq })
    events.push({ type: 'turn/end', seq: seq++, time: seq })
    if (turn === 1) events.push({ type: 'session/title', seq: seq++, time: seq })
  }
  if (openTail) events.push({ type: 'turn/start', seq: seq++, time: seq })
  return events
}

describe('completedHistory', () => {
  it('uses the last completed turn and excludes an open tail', () => {
    expect(completedHistory('source', history(true)).map(event => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(completedHistory('source', history(true), 999).map(event => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('includes the anchored completed turn and trailing between-turn events', () => {
    expect(completedHistory('source', history(), 1).map(event => event.type)).toEqual([
      'turn/start', 'user/message', 'turn/end', 'session/title',
    ])
  })

  it('distinguishes incomplete anchors from a source with no completed turn', () => {
    const events = history(true)
    expect(() => completedHistory('source', events, 7)).toThrow(ContinuationUnavailableError)
    expect(() => completedHistory('source', events, 7)).toThrow(/has not completed/)
    expect(() => completedHistory('source', events.slice(7))).toThrow(/no completed turn/)
  })
})
