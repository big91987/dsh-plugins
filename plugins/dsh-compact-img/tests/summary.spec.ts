import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { FinishReason } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import * as command from '../src/command.ts'

function assemblerWithFinish(finish: FinishReason): BlockAssembler {
  const assembler = new BlockAssembler()
  assembler.push({ type: 'finish', reason: finish })
  return assembler
}

describe('compact-img summary response', () => {
  it('surfaces the provider failure instead of reporting an empty summary', () => {
    expect(command.summarizationText).toBeTypeOf('function')
    const summarize = command.summarizationText!
    const assembler = assemblerWithFinish({
      kind: 'error',
      failure: { message: 'Kimi credential rejected', code: 'AUTH' },
    })

    let thrown: unknown
    try {
      summarize(assembler)
    } catch (error: unknown) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('Kimi credential rejected')
    expect((thrown as Error & { code?: string }).code).toBe('AUTH')
  })

  it('rejects a response truncated before its visible checkpoint', () => {
    expect(command.summarizationText).toBeTypeOf('function')
    const summarize = command.summarizationText!

    expect(() => summarize(assemblerWithFinish({ kind: 'max-tokens' })))
      .toThrow('image summarization truncated at the token cap')
  })

  it('rejects reasoning-only output instead of storing private reasoning', () => {
    expect(command.summarizationText).toBeTypeOf('function')
    const summarize = command.summarizationText!
    const assembler = new BlockAssembler()
    assembler.push({ type: 'reasoning-delta', index: 0, text: 'private reasoning' })
    assembler.push({ type: 'finish', reason: { kind: 'stop' } })

    expect(() => summarize(assembler)).toThrow('image summarization produced no text content')
  })

  it('returns only visible text from a successful response', () => {
    expect(command.summarizationText).toBeTypeOf('function')
    const summarize = command.summarizationText!
    const assembler = new BlockAssembler()
    assembler.push({ type: 'reasoning-delta', index: 0, text: 'private reasoning' })
    assembler.push({ type: 'text-delta', index: 1, text: 'A terminal shows an AUTH error.' })
    assembler.push({ type: 'finish', reason: { kind: 'stop' } })

    expect(summarize(assembler)).toBe('A terminal shows an AUTH error.')
  })
})
