import type {
  WorktreeId as WorktreeIdType,
  WorktreeOperationId as WorktreeOperationIdType,
  WorktreeOwnerId as WorktreeOwnerIdType,
} from './types.ts'

export const WorktreeId = (value: string): WorktreeIdType => value as WorktreeIdType
export const WorktreeOperationId = (value: string): WorktreeOperationIdType => value as WorktreeOperationIdType
export const WorktreeOwnerId = (value: string): WorktreeOwnerIdType => value as WorktreeOwnerIdType
