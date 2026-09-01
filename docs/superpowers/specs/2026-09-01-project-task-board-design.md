# Project Task Board Design

## Purpose

Fork `@linxin666/dsh-client-ui-task-board@0.3.6` as the independently named `dsh-project-task-board` plugin and add project switching to its global task board. The fork remains compatible with DeepSeek Harness `0.1.1-rc.2`, preserves the existing Host-authoritative ledger, and does not modify DeepSeek Harness or the upstream plugin.

## Source and ownership

- Upstream repository: `https://github.com/zhu1090093659/dsh-web.git`
- Upstream baseline: tag `v0.3.6`, commit `fb3f1df1`
- License: Apache-2.0
- Local package: `plugins/dsh-project-task-board`
- Installed plugin name: `dsh-project-task-board`

The fork retains the upstream license and attribution. Its package metadata and anonymous telemetry identity use the fork's name so it is not presented as the upstream package.

## User experience

The task-board header gains one project selector with these entries:

1. **All projects** shows every task.
2. **Unassigned** shows tasks whose `workspaceId` is absent.
3. One entry for every workspace currently reported by DSH shows tasks whose `workspaceId` matches that workspace.

The selector applies to active and archived tasks. Text search and status columns continue to filter within the selected project view. Column and archive counters count only tasks visible in that view.

When a user opens the new-task dialog from a concrete project view, that project is preselected. Opening it from **All projects** or **Unassigned** leaves the task unassigned. The existing task editor remains the way to move a task between projects or clear its project.

The browser remembers the last selected view in local storage. If the saved workspace is no longer available, the selector falls back to **All projects**. This preference is browser-local and never enters the Host ledger.

When project switching hides the currently open task, its detail panel closes so the board does not show a task outside the selected view.

## Data and compatibility

The Host ledger remains `$DSH_HOME/task-board/ledger-v2.json` with schema version 2. Existing `TaskRecord.workspaceId` values already contain all required project ownership data, so no ledger migration or protocol change is introduced.

Unassigned means `workspaceId === undefined`. A task that references a deleted workspace is not silently rewritten; it remains visible under **All projects** and can be reassigned through the existing editor.

Only one task-board implementation may be installed because both use the same Host ledger and routes. Installation therefore follows this order:

1. Back up the Web profile files and `ledger-v2.json` when it exists.
2. Stop the running Web process.
3. Remove `@linxin666/dsh-client-ui-task-board` from the Web profile.
4. Link `dsh-project-task-board` from this repository.
5. Reinstall the profile and start Web.

Removing or replacing the plugin does not delete the ledger.

## Implementation

Project-view state is a small client-only module that owns the selector value, local-storage parsing, saved-workspace validation, and task matching. `TaskBoard` combines project matching with its existing archive and text filters. `NewTaskModal` accepts an optional initial workspace ID rather than reading global UI state.

The workspace list already flows from the official DSH client runtime into `BoardController.executionOptions`; no new API endpoint or Host state is required. Existing server execution, scheduling, power-management, session creation, and ledger code remain unchanged.

Chinese and English locale entries cover the selector label, **All projects**, and **Unassigned**. Header CSS keeps the selector usable at the plugin's existing responsive breakpoints.

## Failure handling

- Invalid or unreadable local-storage values fall back to **All projects**.
- A saved workspace that disappears falls back to **All projects**.
- Local-storage write failures do not block filtering or task creation.
- An empty workspace list still exposes **All projects** and **Unassigned**.
- Host transport and ledger failures retain the upstream plugin's existing behavior.

## Verification

Automated tests cover:

- all-project, unassigned, and concrete-workspace matching;
- persistence parsing and missing-workspace fallback;
- active and archived filtering;
- concrete-project new-task defaults;
- all-project and unassigned new-task defaults;
- closing a selected task when project switching hides it;
- package identity, manifest, type checking, existing upstream tests, and production build.

The installed plugin is then verified in a real browser by switching among all, unassigned, and concrete projects, creating a task in a selected project, reloading to confirm selection memory, and checking browser and Host logs. Test-created task data is removed after verification without touching pre-existing tasks.

## Non-goals

- Separate ledgers per project
- Server-side project partitioning
- Project-level permissions
- Moving tasks by dragging between projects
- Modifying DeepSeek Harness or the upstream repository
- Upgrading the fork to task-board releases that require post-RC2 DSH APIs
