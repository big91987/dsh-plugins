# DSH plugins

[简体中文](README.zh-CN.md) | English

Five independently installable plugins for DeepSeek Harness, currently pinned to `@deepseek-ai/dsh@0.1.1-rc.2`:

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

npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add ./plugins/dsh-worktree
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add ./plugins/dsh-session-coordination
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add ./plugins/dsh-compact-img
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add ./plugins/dsh-project-task-board
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add ./plugins/dsh-browser-preview
npx @deepseek-ai/dsh@0.1.1-rc.2 web
```

`dsh-project-task-board` is an independent fork of `@linxin666/dsh-client-ui-task-board@0.3.6`. They share the same Host ledger and routes and must not be installed together. Remove the upstream package before adding this fork.

Local profile dependencies link to this checkout, so do not move or delete it while the plugins are installed. See the [Chinese guide](README.zh-CN.md) for usage, updates, uninstall instructions, persistent-data behavior, troubleshooting, and the accepted differences from the current official extension surface.

## Compatibility

The repository intentionally targets the tested `0.1.1-rc.2` Host and client contracts. `dsh-session-coordination` and `dsh-compact-img` are additive Host bundles. `dsh-worktree` additionally derives its browser contribution from the checksum-pinned official `0.1.1-rc.2` Workspace client because that release has no public Session-row action extension point. A later DSH release requires explicit compatibility verification and likely a Worktree client update.

The DeepSeek Harness source checkout is reference-only. Plugin development, commits, packaging, and releases happen in this repository.
