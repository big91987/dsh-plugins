/**
 * Task-board client plugin: wires the framework-free core (controller,
 * execution service, store) to the real client runtime and mounts the two
 * DOM surfaces — the sidebar entry row and the board view in the center
 * column.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.configForms).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { BoardController } from '../core/controller.ts'
import { LocalStorageTaskStore } from '../core/store.ts'
import { claimTaskboardApply, releaseTaskboardApply } from './apply-guard.ts'
import { mountBoard } from './board-mount.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { TaskBoardSettingsCard, TaskBoardSettingsCardController, type TaskBoardSettings } from './TaskBoardSettingsCard.tsx'
import { en, zh, type TaskBoardKey } from './locales.ts'
import { HttpTaskBoardHostTransport } from './host-api.ts'
import { reportDailyHeartbeat } from './telemetry.ts'

/** Locale namespace this plugin owns. */
const NS = 'task-board'

/** Settings namespace the settings card edits (the Host plugin registers it). */
const TASK_BOARD_NS = 'ui-project-task-board'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Task-board surface copy. */
    'task-board': TaskBoardKey
  }

}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'configForms', 'locale', 'remote', 'remote.agentPresets']

/**
 * Mount the task board.
 * @param ctx - client root context (services: sessions, workspaces).
 */
export function apply(ctx: Context): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: 'dsh-project-task-board' }])

  // A duplicated client injection (module factory executed twice in one page
  // lifetime) would otherwise mount a second sidebar entry and board view.
  // First application wins; later calls become no-ops (see apply-guard.ts).
  if (!claimTaskboardApply()) return

  // Release the claim when this fiber unloads (the loader supports plugin
  // unloads / hot-reloads), so a rebuilt bundle can claim again in the same
  // page instead of being silently dropped.
  ctx.effect(() => releaseTaskboardApply, 'task-board: apply claim')

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'task-board: dictionaries')

  // Staged configuration page for the unique Host Loader entry.
  const settingsScope = ctx.configForms.get<TaskBoardSettings>(TASK_BOARD_NS)
  const settingsCard = new TaskBoardSettingsCardController(settingsScope)
  ctx.slots.inject('settings.section', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'settings.section',
        id: TASK_BOARD_NS,
        order: 110,
        label: ctx.locale.bind(NS)('settings.title'),
        locale: NS,
        inject: () => settingsCard.inject(),
      }, TaskBoardSettingsCard)
      return () => {
        unregister()
      }
    } catch {
      return () => {}
    }
  })

  // The sidebar entry and board view mount once the settings scope settles;
  // while the scope is still loading, the composition default is unknown, so
  // nothing mounts yet. Only an unavailable scope (no settings surface served)
  // falls back to the composition default (enabled).
  let uiDisposer: (() => void) | undefined
  const mountUi = (): void => {
    if (uiDisposer !== undefined) return
    // Host and browser SDK declarations share the Cordis Context name. Read
    // the browser faces explicitly so Host-side declaration merging cannot
    // narrow these two client services during a combined package build.
    const sessions = ctx.get('sessions') as unknown as ISessions
    const workspaces = ctx.get('workspaces') as unknown as IWorkspaces

    // Core wiring: real runtime faces into the framework-free services.
    const store = new LocalStorageTaskStore()
    const controller = new BoardController({
      store,
      transport: new HttpTaskBoardHostTransport(),
      sessions: {
        list: { getSnapshot: () => undefined, subscribe: listener => sessions.list.subscribe(listener) },
        open: id => ctx.uiWorkspace.openSession(id as SessionId),
      },
    })
    controller.start()

    const disposers: Array<() => void> = []

    // Execution-target option feeds: the workspace list drives the workspace
    // picker, and the agent-preset roster drives the mode picker. Both are
    // runtime facts (not ledger state), so the wiring pushes them into the
    // controller on change; the preset roster is re-read after reconnects
    // because a reconnect may serve a different deployment.
    const pushWorkspaceOptions = (): void => {
      const snapshot = workspaces.list.getSnapshot()
      controller.setExecutionOptions({
        workspaces: snapshot.items.map(item => ({
          workspaceId: item.workspaceId,
          title: item.title !== '' ? item.title : item.path,
        })),
      })
    }
    pushWorkspaceOptions()
    disposers.push(workspaces.list.subscribe(pushWorkspaceOptions))
    const pushPresetOptions = async (): Promise<void> => {
      try {
        const response = await ctx.remote.agentPresets.list()
        if (!response.ok) return
        controller.setExecutionOptions({
          presets: response.value.presets.map(preset => ({
            id: preset.id,
            name: preset.name,
            description: preset.description,
            broken: preset.broken,
            isDefault: preset.isDefault,
          })),
        })
      } catch (error) {
        // A failed roster read leaves the previous options in place; the
        // picker stays usable and the next reconnect retries the read.
        console.error('[dsh-project-task-board] agent preset roster read failed', error)
      }
    }
    void pushPresetOptions()
    disposers.push(ctx.on('connection/reset', () => { void pushPresetOptions() }))
    try {
      disposers.push(mountSidebarEntry(controller))
      disposers.push(mountBoard(controller))
    } catch (error) {
      // DOM failures degrade the board, never the GUI.
      console.error('[dsh-project-task-board] mount failed:', error)
    }

    uiDisposer = () => {
      for (const dispose of disposers.splice(0)) dispose()
      controller.dispose()
      uiDisposer = undefined
    }
  }
  const syncEnabled = (): void => {
    const snapshot = settingsScope.getSnapshot()
    const enabled = snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
    if (enabled) mountUi()
    else uiDisposer?.()
  }
  ctx.effect(() => settingsScope.subscribe(syncEnabled))
  ctx.effect(() => () => { uiDisposer?.(); settingsCard.dispose() })
  syncEnabled()
}
