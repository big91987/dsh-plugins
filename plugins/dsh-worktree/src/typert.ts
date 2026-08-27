import { TYPERT_REMOTE } from './remote-descriptors.ts'

/** Host reflection contribution loaded by the 0.1.1-rc.2 Typert loader. */
export const TYPERT = {
  package: 'dsh-worktree',
  face: 'host',
  schemas: [],
  invocations: TYPERT_REMOTE.descriptors,
  model: { services: [], events: [], objects: [] },
} as const
