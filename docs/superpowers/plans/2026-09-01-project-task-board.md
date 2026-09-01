# Project Task Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independently named RC2-compatible task-board fork whose global board can be filtered by all projects, unassigned tasks, or one DSH workspace.

**Architecture:** Import the upstream `v0.3.6` package as a standalone workspace package, preserve its Host ledger and routes, and isolate the new behavior in a client-only project-view module. The existing workspace option feed supplies selector entries; no Host protocol or ledger schema changes.

**Tech Stack:** TypeScript, React 18, Vitest, tsdown, DeepSeek Harness `0.1.1-rc.2`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-01-project-task-board-design.md`

## Global Constraints

- Baseline upstream tag is `v0.3.6` at commit `fb3f1df1` under Apache-2.0.
- The fork package and telemetry identity are `dsh-project-task-board`.
- Continue using `$DSH_HOME/task-board/ledger-v2.json` at schema version 2.
- Do not modify DeepSeek Harness, the upstream checkout, Host routes, scheduling, execution, or power management.
- The supported Host version is exactly `0.1.1-rc.2`.
- Never install the upstream and forked task-board packages together.

---

### Task 1: Import the RC2-compatible upstream baseline

**Files:**
- Create: `plugins/dsh-project-task-board/**`
- Modify: `plugins/dsh-project-task-board/package.json`
- Modify: `plugins/dsh-project-task-board/src/client/index.ts`
- Modify: `plugins/dsh-project-task-board/src/index.ts`
- Modify: `tests/manifests.spec.ts`

**Interfaces:**
- Consumes: upstream package `packages/dsh-task-board` at `v0.3.6`.
- Produces: standalone workspace package named `dsh-project-task-board` with the same Host ledger behavior.

- [ ] **Step 1: Copy the upstream package and preserve attribution**

Copy the complete upstream package, including `LICENSE`, source, tests, README files, build configuration, and `cordis.patch.yml`, into `plugins/dsh-project-task-board`.

- [ ] **Step 2: Write the failing manifest test**

Extend `tests/manifests.spec.ts` so `dsh-project-task-board` must declare its own bundle patch and exact RC2 compatibility:

```ts
expect(manifest.name).toBe('dsh-project-task-board')
expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
expect(manifest.dsh?.compatibility?.host).toBe('0.1.1-rc.2')
```

- [ ] **Step 3: Run the manifest test and verify RED**

Run: `pnpm vitest run tests/manifests.spec.ts`

Expected: FAIL because the copied manifest still identifies the upstream package and lacks the exact compatibility field.

- [ ] **Step 4: Rename the package identity without changing runtime data ownership**

Set package metadata to:

```json
{
  "name": "dsh-project-task-board",
  "version": "0.0.0",
  "dsh": {
    "compatibility": { "host": "0.1.1-rc.2" }
  }
}
```

Keep the existing `task-board` settings namespace, HTTP routes, and ledger path. Change user-facing install guidance, system-prompt identity, log prefixes, and telemetry package name to `dsh-project-task-board`. Retain upstream copyright and Apache-2.0 attribution.

- [ ] **Step 5: Install dependencies and verify the baseline**

Run:

```sh
pnpm install
pnpm vitest run tests/manifests.spec.ts
pnpm --filter dsh-project-task-board test
pnpm --filter dsh-project-task-board typecheck
pnpm --filter dsh-project-task-board build
```

Expected: all commands PASS before feature behavior is added.

- [ ] **Step 6: Commit the imported fork**

```sh
git add plugins/dsh-project-task-board tests/manifests.spec.ts pnpm-lock.yaml
git commit -m "feat: import project task board fork"
```

### Task 2: Add project-view selection and persistence

**Files:**
- Create: `plugins/dsh-project-task-board/src/client/project-view.ts`
- Create: `plugins/dsh-project-task-board/tests/project-view.spec.ts`

**Interfaces:**
- Consumes: `TaskRecord.workspaceId` and `{ workspaceId, title }[]` execution options.
- Produces: `ProjectView = 'all' | 'unassigned' | { workspaceId: string }`, `matchesProjectView(task, view)`, `resolveProjectView(saved, workspaces)`, `loadProjectView(storage, workspaces)`, and `saveProjectView(storage, view)`.

- [ ] **Step 1: Write failing project-view tests**

Cover these assertions with real `TaskRecord` values:

```ts
expect(matchesProjectView(assigned, { kind: 'all' })).toBe(true)
expect(matchesProjectView(unassigned, { kind: 'unassigned' })).toBe(true)
expect(matchesProjectView(assigned, { kind: 'workspace', workspaceId: 'a' })).toBe(true)
expect(resolveProjectView('workspace:missing', [{ workspaceId: 'a', title: 'A' }])).toEqual({ kind: 'all' })
```

Add storage doubles that throw on read and write; both paths must return or preserve the usable in-memory view without throwing.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter dsh-project-task-board test -- project-view.spec.ts`

Expected: FAIL because `project-view.ts` does not exist.

- [ ] **Step 3: Implement the minimal project-view module**

Use tagged values and one storage key:

```ts
export type ProjectView =
  | { kind: 'all' }
  | { kind: 'unassigned' }
  | { kind: 'workspace'; workspaceId: string }

export const PROJECT_VIEW_STORAGE_KEY = 'dsh.projectTaskBoard.projectView'
```

Serialize as `all`, `unassigned`, or `workspace:<id>`. Validate persisted workspace IDs against the current runtime roster and fall back to `{ kind: 'all' }`.

- [ ] **Step 4: Run focused and package tests and verify GREEN**

Run:

```sh
pnpm --filter dsh-project-task-board test -- project-view.spec.ts
pnpm --filter dsh-project-task-board test
```

Expected: PASS with no warnings.

- [ ] **Step 5: Commit project-view behavior**

```sh
git add plugins/dsh-project-task-board/src/client/project-view.ts plugins/dsh-project-task-board/tests/project-view.spec.ts
git commit -m "feat(task-board): model project views"
```

### Task 3: Add the project selector and new-task defaults

**Files:**
- Modify: `plugins/dsh-project-task-board/src/client/board/TaskBoard.tsx`
- Modify: `plugins/dsh-project-task-board/src/client/board/NewTaskModal.tsx`
- Modify: `plugins/dsh-project-task-board/src/client/locales.ts`
- Modify: `plugins/dsh-project-task-board/src/client/board.module.css`
- Modify: `plugins/dsh-project-task-board/tests/board-view.spec.tsx`
- Modify: `plugins/dsh-project-task-board/tests/controller.spec.ts`

**Interfaces:**
- Consumes: the `ProjectView` helpers from Task 2 and `snapshot.executionOptions.workspaces`.
- Produces: a header selector, filtered active/archive views, and `NewTaskModal({ initialWorkspaceId?: string })`.

- [ ] **Step 1: Write failing board tests**

Render a controller with assigned and unassigned tasks and assert:

```ts
expect(screen.getByRole('combobox', { name: '项目' })).toBeDefined()
fireEvent.change(selector, { target: { value: 'workspace:workspace-a' } })
expect(screen.queryByText('Workspace B task')).toBeNull()
expect(screen.getByText('Workspace A task')).toBeDefined()
```

Add separate assertions for `all`, `unassigned`, archived filtering, persisted selection restoration, and fallback after a workspace disappears. Assert that switching away from an open task closes its detail panel.

- [ ] **Step 2: Write the failing new-task default tests**

Open the dialog from `workspace:workspace-a` and assert the workspace select initially equals `workspace-a`. Repeat from `all` and `unassigned` and assert it equals the empty string.

- [ ] **Step 3: Run focused UI tests and verify RED**

Run: `pnpm --filter dsh-project-task-board test -- board-view.spec.tsx`

Expected: FAIL because the project selector and `initialWorkspaceId` prop do not exist.

- [ ] **Step 4: Implement selector, filtering, persistence, and defaults**

In `TaskBoard`, initialize from `loadProjectView`, reconcile when workspace options change, and filter with:

```ts
const visible = snapshot.tasks.filter(task =>
  (archiveView ? task.archivedAt !== undefined : task.archivedAt === undefined)
  && matchesProjectView(task, projectView)
  && matchesFilter(task, filter),
)
```

Render options `all`, `unassigned`, and `workspace:<workspaceId>`. Pass only a concrete workspace ID to `NewTaskModal.initialWorkspaceId`. Initialize its state with `useState(initialWorkspaceId ?? '')`.

- [ ] **Step 5: Add responsive CSS and bilingual copy**

Add locale keys `board.project`, `board.project.all`, and `board.project.unassigned`. Style the selector with the existing input/select visual language and allow it to wrap with the header at existing narrow breakpoints.

- [ ] **Step 6: Run focused and complete package verification**

Run:

```sh
pnpm --filter dsh-project-task-board test -- board-view.spec.tsx
pnpm --filter dsh-project-task-board test
pnpm --filter dsh-project-task-board typecheck
pnpm --filter dsh-project-task-board build
```

Expected: PASS with no browser-console warnings in tests.

- [ ] **Step 7: Commit the UI feature**

```sh
git add plugins/dsh-project-task-board
git commit -m "feat(task-board): switch global board by project"
```

### Task 4: Document, install, and verify the fork

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `plugins/dsh-project-task-board/README.md`
- Modify: `plugins/dsh-project-task-board/README.zh.md`
- Modify: `tests/build-artifacts.spec.ts`

**Interfaces:**
- Consumes: built `dsh-project-task-board` package.
- Produces: documented installation and a Web profile that links only the forked task board.

- [ ] **Step 1: Write failing repository artifact assertions**

Require `plugins/dsh-project-task-board/lib/index.js`, `lib/client.js`, and generated types after `pnpm build`, then run `pnpm test` before rebuilding to verify the new assertion detects absent artifacts on a clean package output.

- [ ] **Step 2: Update English and Chinese documentation**

Add the fourth plugin to both root tables. Document the project selector, unassigned/all views, saved browser preference, shared ledger, upstream attribution, and the rule that the upstream task-board package must be removed before installing the fork.

- [ ] **Step 3: Run repository verification**

Run:

```sh
pnpm peers check
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: all checks PASS.

- [ ] **Step 4: Back up live state and replace the installed package**

Copy the Web profile metadata and existing `~/.dsh/task-board/ledger-v2.json` into a timestamped `~/.dsh/backups/project-task-board-*` directory. Stop DSH Web, then run:

```sh
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web remove @linxin666/dsh-client-ui-task-board
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add ./plugins/dsh-project-task-board
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web install
```

Verify the profile lists `dsh-project-task-board` and no upstream task-board package.

- [ ] **Step 5: Run real-browser verification**

Start Web on `127.0.0.1:3080`, open it with Playwright, and assert the project selector exposes **全部项目**, **未分配项目**, and the runtime workspace titles. Switch views, reload to verify memory, and confirm browser console and Host output have no errors. Do not mutate pre-existing tasks during this smoke test.

- [ ] **Step 6: Commit and push all remaining changes**

```sh
git add README.md README.zh-CN.md plugins/dsh-project-task-board tests/build-artifacts.spec.ts pnpm-lock.yaml docs/superpowers
git commit -m "docs: document project task board"
git push origin main
```

Confirm `git status --short --branch` is clean and `origin/main` matches `HEAD`.
