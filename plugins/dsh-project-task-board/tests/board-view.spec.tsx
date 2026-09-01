// @vitest-environment jsdom
/**
 * L2 semantic attributes of the board view (issue #506): the mounted board
 * container, the board root, every status column, and every task card opt
 * into the semantic-attrs/v1 enum (data-dsh-plugin / data-dsh-part) so skins
 * can target them without hash-class selectors.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountBoard } from '../src/client/board-mount.tsx'
import { TaskBoard } from '../src/client/board/TaskBoard.tsx'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import type { TaskRecord } from '../src/core/tasks.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
let disposeMount: (() => void) | undefined
const storageValues = new Map<string, string>()

beforeEach(() => {
  storageValues.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storageValues.clear(),
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => { storageValues.set(key, value) },
    },
  })
})

afterEach(() => {
  disposeMount?.()
  disposeMount = undefined
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-dsh-taskboard-active')
  localStorage.clear()
})

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1',
    title: 'Task A',
    description: '',
    prompt: 'do it',
    status: 'todo',
    createdAt: 0,
    updatedAt: Date.now(),
    executions: [],
    ...overrides,
  }
}

function fakeController(
  snapshot?: Partial<ControllerSnapshot>,
  overrides?: Partial<BoardController>,
): BoardController {
  const state: ControllerSnapshot = {
    tasks: [task()],
    boardOpen: false,
    archiveView: false,
    selectedTaskId: undefined,
    executionOptions: { workspaces: [], presets: [] },
    pendingTaskIds: [],
    ...snapshot,
  }
  return {
    getSnapshot: () => state,
    subscribe: () => () => {},
    closeBoard: () => {},
    toggleArchiveView: () => {},
    retryHostSync: async () => {},
    openTask: () => {},
    moveTask: () => {},
    ...overrides,
  } as unknown as BoardController
}

describe('TaskBoard L2 semantic attributes (#506)', () => {
  it('tags the board root, the status columns, and the task cards', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(<TaskBoard controller={fakeController()} />) })

    const board = container.querySelector('[data-dsh-taskboard-board]')
    expect(board).not.toBeNull()
    expect(board!.getAttribute('data-dsh-plugin')).toBe('task-board')
    expect(board!.querySelector('button[data-dsh-center-view-back]')).not.toBeNull()

    const columns = container.querySelectorAll('section[data-status]')
    expect(columns.length).toBeGreaterThan(0)
    for (const column of columns) {
      expect(column.getAttribute('data-dsh-part')).toBe('column')
    }

    const card = container.querySelector('[data-dsh-part="card"]')
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain('Task A')
  })

  it('tags the archive column as a column too', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const controller = fakeController({
      archiveView: true,
      tasks: [task({ archivedAt: Date.now(), status: 'done' })],
    })
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const archive = container.querySelector('section[data-status="archived"]')
    expect(archive).not.toBeNull()
    expect(archive!.getAttribute('data-dsh-part')).toBe('column')
  })
})

describe('TaskBoard card drag-and-drop status changes (#1195)', () => {
  it('marks manual tasks as draggable and running/pending/archived tasks as not draggable', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    const controller = fakeController({
      tasks: [
        task({ id: 't-todo', status: 'todo' }),
        task({ id: 't-running', status: 'running' }),
        task({ id: 't-pending', status: 'todo' }),
      ],
      pendingTaskIds: ['t-pending'],
    })
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const cards = container.querySelectorAll('button[data-dsh-part="card"]')
    expect(cards).toHaveLength(3)

    // Todo card is draggable
    const todoCard = Array.from(cards).find(c => c.getAttribute('data-status') === 'todo' && !c.hasAttribute('data-pending'))
    expect(todoCard?.getAttribute('draggable')).toBe('true')

    // Running card is not draggable
    const runningCard = Array.from(cards).find(c => c.getAttribute('data-status') === 'running')
    expect(runningCard?.getAttribute('draggable')).toBe('false')

    // Pending card is not draggable
    const pendingCard = Array.from(cards).find(c => c.getAttribute('data-pending') === 'true')
    expect(pendingCard?.getAttribute('draggable')).toBe('false')
  })

  it('drops a backlog card onto the todo column and triggers controller.moveTask', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    const moveCalls: Array<{ id: string; status: string }> = []
    const controller = fakeController(
      {
        tasks: [task({ id: 't-backlog', status: 'backlog', title: 'Task Backlog' })],
      },
      {
        moveTask: (id, status) => { moveCalls.push({ id, status }) },
      },
    )
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const todoColumn = container.querySelector('section[data-status="todo"]')
    expect(todoColumn).not.toBeNull()

    // Simulate drag and drop
    const dataTransfer = {
      data: { 'text/plain': 't-backlog' } as Record<string, string>,
      setData(type: string, val: string) { this.data[type] = val },
      getData(type: string) { return this.data[type] ?? '' },
      dropEffect: 'none',
    }

    await act(async () => {
      todoColumn!.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer }),
      )
    })

    expect(moveCalls).toEqual([{ id: 't-backlog', status: 'todo' }])
  })

  it('rejects invalid drops (same column or dropping running tasks)', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    const moveCalls: Array<{ id: string; status: string }> = []
    const controller = fakeController(
      {
        tasks: [
          task({ id: 't-todo', status: 'todo' }),
          task({ id: 't-running', status: 'running' }),
        ],
      },
      {
        moveTask: (id, status) => { moveCalls.push({ id, status }) },
      },
    )
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const todoColumn = container.querySelector('section[data-status="todo"]')

    // Dropping on the same column does nothing
    const sameColTransfer = {
      getData: (type: string) => (type === 'text/plain' ? 't-todo' : ''),
    }
    await act(async () => {
      todoColumn!.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: sameColTransfer }),
      )
    })
    expect(moveCalls).toHaveLength(0)

    // Dropping a running task does nothing
    const runningTransfer = {
      getData: (type: string) => (type === 'text/plain' ? 't-running' : ''),
    }
    await act(async () => {
      todoColumn!.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: runningTransfer }),
      )
    })
    expect(moveCalls).toHaveLength(0)
  })
})

describe('TaskBoard project views', () => {
  const workspaceOptions = [
    { workspaceId: 'workspace-a', title: 'Project A' },
    { workspaceId: 'workspace-b', title: 'Project B' },
  ]

  it('switches between all, unassigned, and concrete project tasks', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const controller = fakeController({
      tasks: [
        task({ id: 'a', title: 'Project A task', workspaceId: 'workspace-a' }),
        task({ id: 'b', title: 'Project B task', workspaceId: 'workspace-b' }),
        task({ id: 'none', title: 'Unassigned task' }),
      ],
      executionOptions: { workspaces: workspaceOptions, presets: [] },
    })
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const selector = container.querySelector('select[aria-label="项目"]') as HTMLSelectElement | null
    expect(selector).not.toBeNull()
    expect(container.textContent).toContain('Project A task')
    expect(container.textContent).toContain('Project B task')
    expect(container.textContent).toContain('Unassigned task')

    await act(async () => {
      selector!.value = 'workspace:workspace-a'
      selector!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.textContent).toContain('Project A task')
    expect(container.textContent).not.toContain('Project B task')
    expect(container.textContent).not.toContain('Unassigned task')

    await act(async () => {
      selector!.value = 'unassigned'
      selector!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.textContent).not.toContain('Project A task')
    expect(container.textContent).toContain('Unassigned task')
  })

  it('remembers a valid project, falls back from a missing project, and closes hidden details', async () => {
    localStorage.setItem('dsh.projectTaskBoard.projectView', 'workspace:workspace-a')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    let detailClosed = 0
    const controller = fakeController({
      tasks: [task({ id: 'a', title: 'Project A task', workspaceId: 'workspace-a' })],
      selectedTaskId: 'a',
      executionOptions: { workspaces: workspaceOptions, presets: [] },
    }, {
      closeTask: () => { detailClosed += 1 },
    })
    await act(async () => { root.render(<TaskBoard controller={controller} />) })
    const selector = container.querySelector('select[aria-label="项目"]') as HTMLSelectElement
    expect(selector.value).toBe('workspace:workspace-a')

    await act(async () => {
      selector.value = 'workspace:workspace-b'
      selector.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(localStorage.getItem('dsh.projectTaskBoard.projectView')).toBe('workspace:workspace-b')
    expect(detailClosed).toBe(1)

    localStorage.setItem('dsh.projectTaskBoard.projectView', 'workspace:missing')
    const secondContainer = document.createElement('div')
    document.body.appendChild(secondContainer)
    const secondRoot = createRoot(secondContainer)
    roots.push(secondRoot)
    await act(async () => { secondRoot.render(<TaskBoard controller={fakeController({ executionOptions: { workspaces: workspaceOptions, presets: [] } })} />) })
    expect((secondContainer.querySelector('select[aria-label="项目"]') as HTMLSelectElement).value).toBe('all')
  })

  it('preselects only a concrete project when creating a task', async () => {
    localStorage.setItem('dsh.projectTaskBoard.projectView', 'workspace:workspace-b')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const controller = fakeController({ executionOptions: { workspaces: workspaceOptions, presets: [] } })
    await act(async () => { root.render(<TaskBoard controller={controller} />) })
    const newButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('新建任务'))
    expect(newButton).toBeDefined()
    await act(async () => { newButton!.click() })
    const selects = container.querySelectorAll('select')
    expect(selects.length).toBeGreaterThanOrEqual(2)
    expect(selects[1]!.value).toBe('workspace-b')
  })

  it('leaves new tasks unassigned from all-projects and unassigned views', async () => {
    for (const savedView of ['all', 'unassigned']) {
      localStorage.setItem('dsh.projectTaskBoard.projectView', savedView)
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      roots.push(root)
      const controller = fakeController({ executionOptions: { workspaces: workspaceOptions, presets: [] } })
      await act(async () => { root.render(<TaskBoard controller={controller} />) })
      const newButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('新建任务'))
      await act(async () => { newButton!.click() })
      expect(container.querySelectorAll('select')[1]!.value).toBe('')
      await act(async () => { root.unmount() })
      roots.splice(roots.indexOf(root), 1)
      container.remove()
    }
  })

  it('applies the selected project to archived tasks and their count', async () => {
    localStorage.setItem('dsh.projectTaskBoard.projectView', 'workspace:workspace-a')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const controller = fakeController({
      archiveView: true,
      tasks: [
        task({ id: 'a', title: 'Archived A', workspaceId: 'workspace-a', status: 'done', archivedAt: 10 }),
        task({ id: 'b', title: 'Archived B', workspaceId: 'workspace-b', status: 'done', archivedAt: 10 }),
      ],
      executionOptions: { workspaces: workspaceOptions, presets: [] },
    })
    await act(async () => { root.render(<TaskBoard controller={controller} />) })
    expect(container.textContent).toContain('Archived A')
    expect(container.textContent).not.toContain('Archived B')
    expect(container.querySelector('section[data-status="archived"] [class*="columnCount"]')?.textContent).toBe('1')
  })
})

describe('mountBoard lifecycle & interaction (#506, #1233)', () => {
  it('tags the injected board container with data-dsh-plugin', async () => {
    const column = document.createElement('div')
    column.setAttribute('data-pane', 'conversation')
    document.body.appendChild(column)

    await act(async () => { disposeMount = mountBoard(fakeController()) })

    const view = column.querySelector('[data-dsh-taskboard-view]')
    expect(view).not.toBeNull()
    expect(view!.getAttribute('data-dsh-plugin')).toBe('task-board')
  })

  it('clicking the back button calls controller.closeBoard() (#1233)', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    let closed = 0
    const controller = fakeController({}, {
      closeBoard: () => { closed += 1 },
    })
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const backButton = container.querySelector('button[data-dsh-center-view-back]') as HTMLButtonElement
    expect(backButton).not.toBeNull()
    await act(async () => { backButton.click() })
    expect(closed).toBe(1)
  })

  it('self-heals and remounts when the conversation column is replaced (#1233)', async () => {
    let column = document.createElement('div')
    column.setAttribute('data-pane', 'conversation')
    document.body.appendChild(column)

    const controller = fakeController({ boardOpen: true })
    await act(async () => { disposeMount = mountBoard(controller) })
    expect(column.querySelector('[data-dsh-taskboard-view]')).not.toBeNull()

    // Replace the column element in DOM (e.g. React re-render of AppFrame)
    column.remove()
    column = document.createElement('div')
    column.setAttribute('data-pane', 'conversation')
    document.body.appendChild(column)

    await act(async () => {
      // Trigger MutationObserver callback
      document.body.appendChild(document.createElement('span'))
    })
    expect(column.querySelector('[data-dsh-taskboard-view]')).not.toBeNull()
  })
})
