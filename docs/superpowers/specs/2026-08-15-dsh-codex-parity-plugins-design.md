# DSH Codex-Parity Plugins Design

## Goal

Build two independently installable DeepSeek Harness plugins in one GitHub repository:

- `dsh-worktree` provides Codex-style **Continue in new chat** and **Continue in new worktree** behavior, including managed Git worktrees, session continuation, progress, failure recovery, and browser UI.
- `dsh-session-coordination` provides peer top-level Session discovery, history reading, messaging, waiting, and forking. It does not control subagents.

The observable behavior must be checked against the current Codex release before the plugins are described as 1:1 compatible.

## Repository and publication boundaries

The repository is a pnpm monorepo at `/Users/zhaojiuzhou/work/dsh-plugins`. Each plugin owns its package manifest, `cordis.patch.yml`, source, tests, build, version, and release. The repository root shares development tooling only.

There is no mandatory umbrella bundle and no shared runtime package. Shared production code may be introduced later only when both plugins depend on the same stable responsibility rather than coincidentally similar helpers.

Local development installs a package directory. Published use installs either package independently:

```sh
dsh plugin --profile <name> add ./plugins/dsh-worktree
dsh plugin --profile <name> add ./plugins/dsh-session-coordination
```

Git-host installation cannot select a monorepo subdirectory through the current `dsh plugin` interface. Remote independent installation therefore uses separately published npm packages or package tarballs.

## Source repository relationship

`/Users/zhaojiuzhou/work/deepseek-harness` is a read-only upstream reference. No plugin work is committed there. The local branch `codex/session-workspaces` and its worktree remain migration evidence until both external plugins preserve the required behavior and the user separately authorizes cleanup.

## Package structure

```text
dsh-plugins/
├── plugins/
│   ├── dsh-worktree/
│   │   ├── package.json
│   │   ├── cordis.patch.yml
│   │   ├── src/
│   │   └── tests/
│   └── dsh-session-coordination/
│       ├── package.json
│       ├── cordis.patch.yml
│       ├── src/
│       └── tests/
├── docs/
├── package.json
└── pnpm-workspace.yaml
```

## `dsh-worktree` responsibilities

- Select a balanced completed-turn history prefix without copying an active turn.
- Continue in the source checkout for **Continue in new chat**.
- Create a managed detached Git worktree for **Continue in new worktree**.
- Preserve the source repository-relative `cwd`.
- Transfer tracked changes and selected untracked/ignored files without modifying the source index or checkout.
- Run optional setup with bounded live output.
- Publish the child Session only after its target checkout is usable.
- Expose queued, creating, setting-up, worktree-ready, published, failed, and cancelled states.
- Support cancellation, retry, explicit setup bypass after setup failure, dismissal, and opening the published Session.
- Add the two Session-row actions and pending operation UI to the Web surface.

## `dsh-session-coordination` responsibilities

- `list_threads`: list independent live, idle, and stored top-level Sessions.
- `read_thread`: return the exact persisted header and event suffix after an optional cursor without cold-resuming the target.
- `send_message_to_thread`: deliver a persisted ordinary follow-up message attributed to the sender Session; cold-resume an eligible stored target only when delivery requires it.
- `wait_threads`: accept one to eight targets, wait for any live target to become idle or for timeout, and return current snapshots for all targets.
- `fork_thread`: create a new-chat continuation from a completed history prefix.
- Reject Session-backed subagents as cold-resume targets because their parent service owns their lifecycle.

The plugin owns both the coordination service and its five model tools. It may consume the continuation interface exported by `dsh-worktree` when installed, but its basic list/read/send/wait behavior must not require the Worktree plugin.

## External extension-point gate

The upstream rc.5 tree contains internal changes that made the earlier in-tree implementation possible: Session-row action registration, pending browser slots, Host routes, client runtime state, and generated API catalogs. Before migration, a minimal external bundle must prove which of these can be contributed without changing upstream source.

The gate produces one of three decisions:

1. Use public host and browser extension points directly.
2. Replace specific upstream configuration rows with plugin-owned compatible packages through `cordis.patch.yml`.
3. Record a platform gap when neither route can preserve the requested behavior safely.

The implementation must not silently turn an in-tree patch into a purported external plugin.

## Verification

Each package must independently pass unit tests, strict type checking, build, package-content inspection, and clean-directory installation. A disposable DSH profile must prove bundle discovery, effective configuration, Host loading, browser client loading where applicable, and removal. End-to-end acceptance must exercise real Session continuation and peer Session coordination without a model API key wherever the upstream test harness permits it.

## Deferred decisions

- npm scope and final GitHub repository owner are selected before the first public release; local package names remain `dsh-worktree` and `dsh-session-coordination` meanwhile.
- Automatic orphan recovery and retention policy are not implied unless current Codex behavior makes them necessary for parity.
- Cross-process Session ownership is outside the first release unless current Codex exposes it as part of the observed contract.
