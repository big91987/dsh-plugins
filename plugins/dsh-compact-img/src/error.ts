/**
 * Expected failure classification for `/compact-img`, mirroring the manual
 * compaction error codes so the command can report concise human outcomes.
 *
 * @module dsh-compact-img/error
 */

import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'

/** Stable failure classes surfaced to the user. */
export type CompactImgErrorCode = ManualCompactionError['code'] | 'images-none'

/** Wrap the manual-compaction failure codes in command-facing text. */
export function compactImgErrorText(error: ManualCompactionError): { kind: 'error'; text: string } {
  switch (error.code) {
    case 'busy':
      return {
        kind: 'error',
        text: 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.',
      }
    case 'cancelled':
      return { kind: 'error', text: 'Compaction cancelled.' }
    case 'changed':
      return {
        kind: 'error',
        text: 'The history selected for compaction changed before it could be replaced. The conversation is unchanged.',
      }
    case 'summary':
      return {
        kind: 'error',
        text: 'Compaction could not produce a useful summary. The conversation is unchanged.',
      }
    case 'commit':
      return {
        kind: 'error',
        text: 'Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.',
      }
    case 'persistence':
      return {
        kind: 'error',
        text: 'Compaction finished, but the session could not be saved.',
      }
    default:
      return { kind: 'error', text: `Compaction failed: ${error.message}` }
  }
}
