# dsh-session-coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` and `superpowers:test-driven-development`. Complete tasks in order and keep every behavior change behind a failing test first.

**Goal:** Ship an independently installable Host plugin that gives models Codex-style peer top-level Session discovery, history inspection, messaging, waiting, and new-chat continuation without treating peers as subagents.

**Architecture:** One package owns a Session coordination service and five model tools. It consumes existing rc.6 Session query, Agent registry, preset, message, and tool services through additive Cordis registration. `list/read` never resume stored Sessions; `send` cold-resumes only when delivery requires it; `wait` observes existing live targets; `fork` uses an internal completed-history continuation implementation so installation does not require `dsh-worktree`.

**Tech Stack:** Node.js, TypeScript, Cordis, Vitest, and published DeepSeek Harness rc.6 Host packages.

## Constraints

- The package must install without `dsh-worktree`.
- Peer Sessions are independent top-level Sessions, not spawned subagents.
- Model-visible relay messages must be durable and attributable to the sender Session.
- Stored Sessions are not resumed by list, read, or wait.
- A cold-resumed subagent Session is rejected because its parent owns that lifecycle.

### Task 1: Package contract and public vocabulary

**Files:**
- Modify: `plugins/dsh-session-coordination/package.json`
- Modify: `plugins/dsh-session-coordination/src/index.ts`
- Create: `plugins/dsh-session-coordination/src/types.ts`
- Test: `plugins/dsh-session-coordination/tests/package-contract.spec.ts`

- [ ] Write a failing test for an exact rc.6 compatibility declaration, independent bundle patch, public entry point, and absence of a dependency on `dsh-worktree`.
- [ ] Define `ThreadStatus`, `ThreadSummary`, `ThreadRead`, `ThreadWaitTarget`, and `ThreadMessageReceipt`.
- [ ] Replace the feasibility probe with a real scoped coordination service.

### Task 2: List and read without resumption

**Files:**
- Create: `plugins/dsh-session-coordination/src/service.ts`
- Test: `plugins/dsh-session-coordination/tests/list-read.spec.ts`

- [ ] Write failing tests covering live running, live idle, stored, untitled, newest-first ordering, empty logs, and optional event cursors.
- [ ] Read Session rows, titles, headers, and event snapshots through the query service without calling Agent resume.
- [ ] Return cloned exact event suffixes and stable `cursor`/`updatedAt` values.

### Task 3: Durable peer message delivery

**Files:**
- Modify: `plugins/dsh-session-coordination/src/service.ts`
- Test: `plugins/dsh-session-coordination/tests/send.spec.ts`

- [ ] Write failing tests for delivery to running, idle, and stored top-level Sessions plus concurrent cold-resume coalescing.
- [ ] Create an ordinary user follow-up whose source records `senderSessionId` and enqueue it on the target Agent.
- [ ] Retain owned resume handles until plugin disposal.
- [ ] Reject stored subagent Sessions, missing targets, aborted delivery, and resume races with deterministic behavior.

### Task 4: Bounded waiting

**Files:**
- Modify: `plugins/dsh-session-coordination/src/service.ts`
- Test: `plugins/dsh-session-coordination/tests/wait.spec.ts`

- [ ] Write failing tests for one-to-eight validation, zero-time snapshots, idle/stored immediate return, any-target idle wakeup, timeout, abort, and listener cleanup.
- [ ] Observe `agent/status` only when every target is currently running.
- [ ] Return fresh read snapshots for all targets using their individual cursors.

### Task 5: Independent new-chat continuation

**Files:**
- Create: `plugins/dsh-session-coordination/src/history.ts`
- Create: `plugins/dsh-session-coordination/src/fork.ts`
- Test: `plugins/dsh-session-coordination/tests/fork.spec.ts`

- [ ] Write failing completed-turn boundary tests.
- [ ] Read the source without resumption, resolve its preset, publish a child Session in the same directory, and copy only balanced completed history.
- [ ] Cover optional event anchors, cancellation, no completed turn, and incomplete anchored turns.
- [ ] Keep this implementation internal; do not create a shared runtime package with `dsh-worktree`.

### Task 6: Five Codex-style model tools

**Files:**
- Create: `plugins/dsh-session-coordination/src/tools.ts`
- Modify: `plugins/dsh-session-coordination/src/index.ts`
- Test: `plugins/dsh-session-coordination/tests/tools.spec.ts`

- [ ] Write failing registration and execution tests for `list_threads`, `read_thread`, `send_message_to_thread`, `wait_threads`, and `fork_thread`.
- [ ] Register tools only while both the tool registry and coordination service exist.
- [ ] Validate wire inputs at the tool boundary and return deterministic JSON text.
- [ ] Require a calling Session for message attribution.
- [ ] Document that these tools address peer Sessions and do not replace subagent delegation tools.

### Task 7: Independent package acceptance

**Files:**
- Create: `scripts/accept-session-coordination.sh`
- Create: `docs/probes/session-coordination-acceptance.md`
- Create: `plugins/dsh-session-coordination/README.md`

- [ ] Run focused tests, strict typecheck, build, and package-content inspection.
- [ ] Install only `dsh-session-coordination` into a clean temporary rc.6 profile.
- [ ] Prove all five tools appear exactly once in a real assembled Agent preset.
- [ ] Create two keyless Sessions and verify list, cursor-based read, A-to-B delivery, wait wakeup/timeout, and forked history.
- [ ] Remove the plugin and verify its configuration layer and tools disappear cleanly.
- [ ] Record exact commands and observed results; do not claim compatibility beyond the tested rc.6 release.

