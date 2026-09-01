/** Client-only project selection for the global task board. */
import type { TaskRecord } from '../core/tasks.ts'

/** One workspace option supplied by the DSH client runtime. */
export interface ProjectWorkspace {
  /** Stable DSH workspace identifier. */
  workspaceId: string
  /** User-facing workspace title. */
  title: string
}

/** Project filter selected in the task-board header. */
export type ProjectView =
  | { kind: 'all' }
  | { kind: 'unassigned' }
  | { kind: 'workspace'; workspaceId: string }

/** Minimal browser-storage surface used by the project preference. */
export interface ProjectViewStorage {
  /** Read one saved value. */
  getItem(key: string): string | null
  /** Save one value. */
  setItem(key: string, value: string): void
}

/** Browser-local key for the last selected project view. */
export const PROJECT_VIEW_STORAGE_KEY = 'dsh.projectTaskBoard.projectView'

/** Whether a task belongs in the selected project view. */
export function matchesProjectView(task: TaskRecord, view: ProjectView): boolean {
  switch (view.kind) {
    case 'all': return true
    case 'unassigned': return task.workspaceId === undefined
    case 'workspace': return task.workspaceId === view.workspaceId
  }
}

/** Parse and validate a saved view against the current DSH workspace roster. */
export function resolveProjectView(saved: string | null, workspaces: readonly ProjectWorkspace[]): ProjectView {
  if (saved === 'unassigned') return { kind: 'unassigned' }
  if (saved === 'all') return { kind: 'all' }
  if (saved?.startsWith('workspace:') === true) {
    const workspaceId = saved.slice('workspace:'.length)
    if (workspaces.some(workspace => workspace.workspaceId === workspaceId)) {
      return { kind: 'workspace', workspaceId }
    }
  }
  return { kind: 'all' }
}

/** Load the saved view, falling back to all projects when storage is unavailable. */
export function loadProjectView(storage: ProjectViewStorage, workspaces: readonly ProjectWorkspace[]): ProjectView {
  try {
    return resolveProjectView(storage.getItem(PROJECT_VIEW_STORAGE_KEY), workspaces)
  } catch {
    return { kind: 'all' }
  }
}

/** Persist the selected view without allowing storage failures to affect the board. */
export function saveProjectView(storage: ProjectViewStorage, view: ProjectView): void {
  const value = view.kind === 'workspace' ? `workspace:${view.workspaceId}` : view.kind
  try {
    storage.setItem(PROJECT_VIEW_STORAGE_KEY, value)
  } catch {
    // Browser privacy modes and quota failures only disable preference memory.
  }
}
