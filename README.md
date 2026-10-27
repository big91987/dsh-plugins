# DSH plugins

[简体中文](README.zh-CN.md) | English

Five independently installable plugins for DeepSeek Harness, currently pinned to `@deepseek-ai/dsh@0.2.0-rc.2`:

- [`dsh-worktree`](plugins/dsh-worktree/README.md): Codex-style **Continue in new worktree** alongside the official **Fork session** action, with automatic opening, same-project Worktree projection, managed Git Worktrees, and recovery UI.
- [`dsh-session-coordination`](plugins/dsh-session-coordination/README.md): discovery, history reading, messaging, waiting, and forking across independent top-level Sessions.
- [`dsh-compact-img`](plugins/dsh-compact-img/README.md): `/compact-img`, which replaces image-bearing history spans with text checkpoints before switching to a text-only model.
- [`dsh-project-task-board`](plugins/dsh-project-task-board/README.md): a global task board switchable between all projects, unassigned tasks, and individual projects.
- [`dsh-browser-preview`](plugins/dsh-browser-preview/README.md): a Codex-style Session browser shared by the user and Agent, with a focused right panel, maximize mode, and element annotations.

The packages share this repository for maintenance but have no runtime dependency on one another. Install any subset into the `web` profile.

## Source installation

This is currently a source-distributed monorepo, not a single bundle installable from the repository root. Clone it, keep the checkout in a stable location, build it, and add the required package directories to the DSH profile:

```sh
git clone https://github.com/big91987/dsh-plugins.git
cd dsh-plugins
pnpm install --frozen-lockfile
pnpm build

npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add ./plugins/dsh-worktree
npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add ./plugins/dsh-session-coordination
npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add ./plugins/dsh-compact-img
npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add ./plugins/dsh-browser-preview
npx @deepseek-ai/dsh@0.2.0-rc.2 web
```

`dsh-project-task-board` is an independent fork of `@linxin666/dsh-client-ui-task-board@0.3.6`. They share the same Host ledger and routes and must not be installed together. Remove the upstream package before adding this fork.

Local profile dependencies link to this checkout, so do not move or delete it while the plugins are installed. See the [Chinese guide](README.zh-CN.md) for usage, updates, uninstall instructions, persistent-data behavior, troubleshooting, and the accepted differences from the current official extension surface.

## Compatibility

The repository targets the tested `0.2.0-rc.2` Host and client contracts with Cordis `4.0.4`. These builds do not support the old `0.1` runtime. Worktree preserves the checksum-pinned official Workspace client and contributes its action through the current native menu slot. Task Board uses the native Session Controller, Workspace Registry, ConfigForm and settings slots; Preview uses the current rightbar API.

For an existing installation, stop DSH after active tasks finish, back up Sessions and the profile manifest/lockfile, update this checkout, install the frozen dependencies and rebuild all packages. Use the official `plugin --profile <name> add <package-directory>` command to refresh the linked packages, then start that profile with DSH `0.2.0-rc.2`. Task Board retains its existing v2 ledger. Never run the old and new Task Board Hosts against the same ledger concurrently. See [legacy history migration](plugins/dsh-session-coordination/docs/history-migration.md) if old histories contain Session relay or descriptor v2 events. This explicit migration preserves raw logs and validates the new artifact with the official codec before publication.

The DeepSeek Harness source checkout is reference-only. Plugin development, commits, packaging, and releases happen in this repository.

## Validation and optional installation

Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. The root test command disables experimental Node Web Storage so jsdom owns its test storage. This flag does not change plugin runtime behavior or persisted Sessions. Run `scripts/probe-profile.sh` with its isolated DSH_HOME to check profile installation and removal.

The default installation includes Worktree, Session Coordination, Compact Image, and Browser Preview. Project Task Board remains an optional independently installable package; an upgrade does not re-enable an uninstalled board.
