# DSH plugins

Two independently installable DeepSeek Harness plugins, currently pinned to `@deepseek-ai/dsh@0.1.0-rc.6`:

- `dsh-worktree`: Codex-style **Continue in new chat** and **Continue in new worktree** actions, including managed Git Worktrees and recovery UI.
- `dsh-session-coordination`: Codex-style discovery, reading, messaging, waiting, and forking across independent top-level Sessions.

They share a repository for maintenance, but neither package depends on the other. Install either plugin by itself or install both into the `web` profile.

```sh
pnpm install
pnpm build

pnpm dlx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add ./plugins/dsh-worktree
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add ./plugins/dsh-session-coordination
```

The repository containing DeepSeek Harness source is a reference only; development, commits, and packaging for these plugins happen in this repository.
