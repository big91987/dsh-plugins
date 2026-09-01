import { describe, expect, it } from 'vitest'
import {
  loadProjectView,
  matchesProjectView,
  resolveProjectView,
  saveProjectView,
  type ProjectViewStorage,
} from '../src/client/project-view.ts'
import type { TaskRecord } from '../src/core/tasks.ts'

const workspaces = [
  { workspaceId: 'workspace-a', title: 'Project A' },
  { workspaceId: 'workspace-b', title: 'Project B' },
]

function task(workspaceId?: string): TaskRecord {
  return {
    id: workspaceId ?? 'unassigned',
    title: 'Task',
    description: '',
    prompt: 'Run',
    status: 'todo',
    createdAt: 1,
    updatedAt: 1,
    executions: [],
    ...(workspaceId === undefined ? {} : { workspaceId }),
  }
}

describe('project task-board views', () => {
  it('shows every task in the all-projects view', () => {
    expect(matchesProjectView(task('workspace-a'), { kind: 'all' })).toBe(true)
    expect(matchesProjectView(task(), { kind: 'all' })).toBe(true)
  })

  it('shows only tasks without a workspace in the unassigned view', () => {
    expect(matchesProjectView(task(), { kind: 'unassigned' })).toBe(true)
    expect(matchesProjectView(task('workspace-a'), { kind: 'unassigned' })).toBe(false)
  })

  it('shows only tasks assigned to the selected workspace', () => {
    const view = { kind: 'workspace' as const, workspaceId: 'workspace-a' }
    expect(matchesProjectView(task('workspace-a'), view)).toBe(true)
    expect(matchesProjectView(task('workspace-b'), view)).toBe(false)
    expect(matchesProjectView(task(), view)).toBe(false)
  })

  it('rejects malformed and missing saved workspaces', () => {
    expect(resolveProjectView('workspace:workspace-a', workspaces)).toEqual({
      kind: 'workspace',
      workspaceId: 'workspace-a',
    })
    expect(resolveProjectView('workspace:missing', workspaces)).toEqual({ kind: 'all' })
    expect(resolveProjectView('unknown', workspaces)).toEqual({ kind: 'all' })
    expect(resolveProjectView(null, workspaces)).toEqual({ kind: 'all' })
  })

  it('survives unavailable browser storage', () => {
    const throwingStorage: ProjectViewStorage = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
    }
    expect(loadProjectView(throwingStorage, workspaces)).toEqual({ kind: 'all' })
    expect(() => saveProjectView(throwingStorage, { kind: 'workspace', workspaceId: 'workspace-a' })).not.toThrow()
  })
})
