# dsh-worktree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` and `superpowers:test-driven-development`. Complete tasks in order and keep every behavior change behind a failing test first.

**Goal:** Ship an independently installable `dsh-worktree` bundle that preserves the DeepSeek Harness rc.6 Workspace UI and adds Codex-style **Continue in new chat** and **Continue in new worktree**, including safe dirty-state transfer, pending progress, recovery, and child Session publication.

**Architecture:** One package owns four internal modules: a provider-neutral Worktree service, a local Git provider, Session continuation coordination, and an rc.6-compatible browser Workspace replacement. The Host contribution is additive. The browser patch disables only the built-in `ui-workspace` row and inserts `dsh-worktree`; no DOM monkey patching or upstream repository modification is allowed. Runtime imports and UI behavior are pinned to `@deepseek-ai/dsh@0.1.0-rc.6` until a compatibility test approves another release.

**Tech Stack:** Node.js, TypeScript, Cordis, Git CLI, Vitest, React and the published DeepSeek Harness rc.6 Host/client packages.

## Constraints

- `<upstream-reference>` is read-only migration evidence.
- `dsh-worktree` must install without `dsh-session-coordination`.
- The source checkout and source Git index must remain byte-for-byte unchanged by Worktree creation and snapshotting.
- Managed checkout deletion accepts a managed identity, never an arbitrary path.
- A child Session is published only after its destination checkout is usable.
- The replacement UI must retain every rc.6 Workspace action and state before adding continuation behavior.

### Task 1: Compatibility pin and package faces

**Files:**
- Modify: `plugins/dsh-worktree/package.json`
- Modify: `plugins/dsh-worktree/cordis.patch.yml`
- Create: `plugins/dsh-worktree/src/types.ts`
- Modify: `plugins/dsh-worktree/src/index.ts`
- Test: `plugins/dsh-worktree/tests/package-contract.spec.ts`

- [ ] Write a failing test that requires the exact rc.6 compatibility declaration, Host/client exports, built artifacts, and a patch that disables `ui-workspace` before inserting `dsh-worktree`.
- [ ] Add only the published rc.6 dependencies actually imported at runtime; keep Cordis a peer.
- [ ] Define branded `WorktreeId`, `WorktreeOperationId`, and `WorktreeOwnerId` plus the create/resolve/owner/snapshot/restore/delete request and result types.
- [ ] Export the package's real Host entry point and remove the feasibility probe service.
- [ ] Run the focused test, typecheck, and build.

### Task 2: Safe managed Git Worktree engine

**Files:**
- Create: `plugins/dsh-worktree/src/git/runner.ts`
- Create: `plugins/dsh-worktree/src/git/paths.ts`
- Create: `plugins/dsh-worktree/src/git/metadata.ts`
- Create: `plugins/dsh-worktree/src/git/transfer.ts`
- Create: `plugins/dsh-worktree/src/git/snapshot.ts`
- Create: `plugins/dsh-worktree/src/git/manager.ts`
- Create: `plugins/dsh-worktree/tests/support/git.ts`
- Test: `plugins/dsh-worktree/tests/git-create.spec.ts`
- Test: `plugins/dsh-worktree/tests/git-lifecycle.spec.ts`

- [ ] Start with a failing real-Git test for a detached managed checkout that preserves a nested source `cwd`.
- [ ] Resolve repository root, common directory, source HEAD, and repository-relative cwd using explicit Git argv.
- [ ] Allocate only canonical `<managed-root>/<four-hex>/<repository-name>` destinations and reject symlink escapes or collisions.
- [ ] Add failing tests for combined staged/unstaged tracked changes, ordinary untracked files, selected ignored files, executable files, and safe symlinks.
- [ ] Transfer the source's `git diff --binary HEAD` plus admitted supplemental paths without mutating the source index or checkout.
- [ ] Persist provider identity and source facts in Worktree-local Git config so restart discovery is deterministic.
- [ ] Add failing lifecycle tests for resolve, owner assignment, snapshot, forced/non-forced delete, restore, missing refs, wrong identities, and cleanup after partial creation failure.
- [ ] Snapshot through a private temporary index and a repository-owned `refs/dsh/worktrees/<id>` ref.
- [ ] Run focused real-Git tests and verify the source status/index/HEAD are unchanged.

### Task 3: Setup execution and pending lifecycle

**Files:**
- Create: `plugins/dsh-worktree/src/git/setup.ts`
- Create: `plugins/dsh-worktree/src/continuation/pending.ts`
- Test: `plugins/dsh-worktree/tests/setup.spec.ts`
- Test: `plugins/dsh-worktree/tests/pending.spec.ts`

- [ ] Write failing tests for skipped setup, successful setup, non-zero setup retention, live stdout/stderr updates, byte ceilings, cancellation, and process cleanup.
- [ ] Execute the selected platform shell command inside the managed checkout through the Host subprocess service, with source/destination environment variables.
- [ ] Model queued, creating, setting-up, worktree-ready, published, failed, and cancelled states with monotonic attempt numbers.
- [ ] Add failing tests for retry, publication-only retry, explicit continue-without-setup, cancellation, dismissal, and stale update rejection.
- [ ] Keep retained setup output bounded and copy snapshots before exposing them.

### Task 4: Completed-history and Session publication

**Files:**
- Create: `plugins/dsh-worktree/src/continuation/history.ts`
- Create: `plugins/dsh-worktree/src/continuation/source.ts`
- Create: `plugins/dsh-worktree/src/continuation/service.ts`
- Test: `plugins/dsh-worktree/tests/history.spec.ts`
- Test: `plugins/dsh-worktree/tests/continue-chat.spec.ts`
- Test: `plugins/dsh-worktree/tests/continue-worktree.spec.ts`

- [ ] Write failing history tests for the latest balanced completed turn, an anchored completed turn, trailing between-turn events, no completed turn, and an incomplete anchored turn.
- [ ] Read a live-or-stored Session without resuming its Agent and choose a completed event prefix.
- [ ] Write a failing test for new-chat continuation that inherits the source directory, origin/preset facts, selected history, and Workspace membership.
- [ ] Publish the child through the rc.6 Agent/Session services and return its durable Session id.
- [ ] Write a failing Worktree-continuation test proving publication occurs only after checkout/setup readiness and owner metadata is attached afterward.
- [ ] Cover rollback before publication, retained Worktrees after setup failure, and recoverable Workspace-attachment failure after publication.

### Task 5: Host remote API

**Files:**
- Create: `plugins/dsh-worktree/src/remote.ts`
- Modify: `plugins/dsh-worktree/src/index.ts`
- Test: `plugins/dsh-worktree/tests/remote.spec.ts`

- [ ] Write failing tests for continue-in-chat, begin-worktree, list/read pending, retry, cancel, continue-without-setup, and dismiss remote operations.
- [ ] Register a typed rc.6 Typert Remote through the public registry/gateway mechanism.
- [ ] Map invalid state, missing Session, unavailable history, and publication failures to stable client-visible errors.
- [ ] Dispose observers and pending work with the Cordis scope.

### Task 6: rc.6 Workspace UI compatibility replacement

**Files:**
- Replace: `plugins/dsh-worktree/src/client/index.ts`
- Create: `plugins/dsh-worktree/src/client/Workspace.tsx`
- Create: `plugins/dsh-worktree/src/client/PendingWorktrees.tsx`
- Create: `plugins/dsh-worktree/src/client/locales.ts`
- Create: `plugins/dsh-worktree/src/client/*.module.css`
- Test: `plugins/dsh-worktree/tests/workspace-compat.client.spec.tsx`
- Test: `plugins/dsh-worktree/tests/continuation-actions.client.spec.tsx`
- Test: `plugins/dsh-worktree/tests/pending.client.spec.tsx`

- [ ] Inventory every exported behavior, menu action, route, picker, directory flow, loading/empty/error state, and locale key in published rc.6 `ui-workspace`.
- [ ] Write parity tests against that inventory before copying/adapting the rc.6 implementation.
- [ ] Reproduce the complete rc.6 Workspace surface through public client services.
- [ ] Add **Continue in new chat** and **Continue in new worktree** to the Session context menu with the same placement and lifecycle as Codex.
- [ ] Render pending operations with setup output, cancel, retry, continue-without-setup, dismiss, and open-published-Session actions.
- [ ] Remove the feasibility `<html>` marker; registration and cleanup remain Cordis effects.
- [ ] Fail loudly when the expected rc.6 client services are unavailable.

### Task 7: Independent package acceptance

**Files:**
- Modify: `scripts/probe-profile.sh`
- Create: `scripts/accept-worktree.sh`
- Create: `docs/probes/worktree-acceptance.md`
- Create: `README.md`
- Create: `plugins/dsh-worktree/README.md`

- [ ] Run focused unit/integration tests, strict typecheck, build, and package-content inspection.
- [ ] Install only `dsh-worktree` into a clean temporary rc.6 profile and verify effective config disables built-in `ui-workspace` once and inserts the replacement once.
- [ ] Boot the real Web profile and exercise new-chat continuation and dirty-state Worktree continuation without a model key.
- [ ] Verify all original Workspace actions still work and the browser console has no errors.
- [ ] Remove the plugin and verify the temporary profile returns to the built-in Workspace UI.
- [ ] Record exact commands and observed results; do not claim support beyond rc.6.
