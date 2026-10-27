import { z } from 'zod'

const Id = z.string().min(1)
const Environment = z.object({ name: Id, command: Id })
const ContinuationRequest = z.object({ sourceSessionId: Id, atSeq: z.number().int().safe().optional() })
const WorktreeContinuationRequest = ContinuationRequest.extend({ environment: Environment.optional() })
const RetryRequest = z.object({ id: Id, environment: Environment.optional() })
const Setup = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skipped') }),
  z.object({
    kind: z.literal('completed'),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    stdout: z.string(),
    stderr: z.string(),
  }),
])
const Worktree = z.object({
  id: Id,
  path: Id,
  cwd: Id,
  repositoryRoot: Id,
  repositoryCommonDir: Id,
  sourceHead: Id,
  ownerId: Id.optional(),
  setup: Setup,
})
const Output = z.object({ text: z.string(), truncated: z.boolean() })
const Pending = z.object({
  id: Id,
  sourceSessionId: Id,
  atSeq: z.number().int().safe().optional(),
  environment: Environment.optional(),
  attempt: z.number().int().safe().positive(),
  stage: z.enum(['queued', 'creating', 'setting-up', 'worktree-ready', 'published', 'failed', 'cancelled']),
  sessionId: Id.optional(),
  worktree: Worktree.optional(),
  setupOutput: z.object({ stdout: Output, stderr: Output }),
  continuedWithoutSetup: z.boolean(),
  error: z.string().optional(),
  failureKind: z.enum(['worktree', 'setup', 'publication']).optional(),
})
const WorkspaceMapping = z.object({
  sourceWorkspacePath: Id,
  worktreeWorkspacePath: Id,
})

const strictCodec = (typeSymbol: string, schema: z.ZodType) => ({
  mode: 'strict' as const,
  typeSymbol,
  create: () => schema,
})
const jsonParameter = (name: string, typeSymbol: string, schema: z.ZodType) => ({
  name,
  wire: name,
  source: 'json' as const,
  codec: strictCodec(typeSymbol, schema),
})
const descriptor = (
  method: string,
  parameters: readonly ReturnType<typeof jsonParameter>[],
  result: ReturnType<typeof strictCodec>,
  cancellation = false,
) => ({
  id: `dsh-worktree#dshWorktree/${method}`,
  service: 'dshWorktreeRemote',
  namespace: 'dshWorktree',
  method,
  invocation: { kind: 'direct' as const },
  parameters,
  ...(cancellation ? { cancellation: { parameter: 'signal' as const } } : {}),
  result,
  sourceLocation: { file: 'plugins/dsh-worktree/src/remote.ts', line: 1, column: 1 },
})

/** Host/Client descriptors for the Worktree browser API. */
export const TYPERT_REMOTE = {
  package: 'dsh-worktree',
  descriptors: [
    descriptor(
      'continueInWorktree',
      [jsonParameter('request', 'dsh-worktree#ContinueInWorktreeRequest', WorktreeContinuationRequest)],
      strictCodec('dsh-worktree#ContinueInWorktreeResult', z.object({ pendingSessionId: Id })),
    ),
    descriptor(
      'pending',
      [jsonParameter('id', 'dsh-worktree#PendingSessionId', Id)],
      strictCodec('dsh-worktree#NullablePendingSessionSnapshot', Pending.nullable()),
    ),
    descriptor('listPending', [], strictCodec('dsh-worktree#PendingSessionSnapshotList', z.array(Pending))),
    descriptor(
      'listWorkspaceMappings',
      [],
      strictCodec('dsh-worktree#WorktreeWorkspaceMappingList', z.array(WorkspaceMapping)),
    ),
    descriptor(
      'retryPending',
      [jsonParameter('request', 'dsh-worktree#RetryPendingRequest', RetryRequest)],
      strictCodec('dsh-worktree#Void', z.void()),
    ),
    descriptor(
      'cancelPending',
      [jsonParameter('id', 'dsh-worktree#PendingSessionId', Id)],
      strictCodec('dsh-worktree#Void', z.void()),
    ),
    descriptor(
      'continuePendingWithoutSetup',
      [jsonParameter('id', 'dsh-worktree#PendingSessionId', Id)],
      strictCodec('dsh-worktree#Void', z.void()),
    ),
    descriptor(
      'dismissPending',
      [jsonParameter('id', 'dsh-worktree#PendingSessionId', Id)],
      strictCodec('dsh-worktree#Void', z.void()),
    ),
  ],
} as const
