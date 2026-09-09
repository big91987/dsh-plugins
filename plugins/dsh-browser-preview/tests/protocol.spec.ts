import { describe, expect, it } from 'vitest'
import { parseBrowserAction, resolveBrowserUrl } from '../src/protocol.ts'

describe('resolveBrowserUrl', () => {
  it('normalizes an HTTP development URL', () => {
    expect(resolveBrowserUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/')
  })

  it('rejects non-browser schemes', () => {
    expect(() => resolveBrowserUrl('file:///etc/passwd')).toThrow(/http\/https/)
  })
})

describe('parseBrowserAction', () => {
  it('accepts and normalizes a Session navigation command', () => {
    expect(parseBrowserAction({
      kind: 'navigate',
      sessionId: 'session-a',
      url: 'https://example.com',
    })).toEqual({
      kind: 'navigate',
      sessionId: 'session-a',
      url: 'https://example.com/',
    })
  })

  it('rejects input without a Session id', () => {
    expect(parseBrowserAction({
      kind: 'mouse',
      sessionId: '',
      event: 'down',
      x: 1,
      y: 2,
      button: 'left',
    })).toBeUndefined()
  })

  it('rejects non-finite pointer coordinates', () => {
    expect(parseBrowserAction({
      kind: 'mouse',
      sessionId: 'session-a',
      event: 'move',
      x: Number.NaN,
      y: 2,
    })).toBeUndefined()
  })
})
