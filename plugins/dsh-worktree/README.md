# dsh-worktree

Adds the Codex-style Session row actions **Continue in new chat** and **Continue in new worktree** to DeepSeek Harness `0.1.0-rc.6`.

The Worktree action creates a detached managed Git Worktree, copies configured working-tree changes, optionally runs setup, publishes a new Workspace and Session, and exposes live or terminal progress. Failed setup can be retried, cancelled, dismissed, or explicitly continued without setup.

```sh
pnpm --filter dsh-worktree build
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add ./plugins/dsh-worktree
```

This release derives its browser contribution from the checksum-pinned official rc.6 Workspace client because rc.6 has no public Session-row action extension point. See `THIRD_PARTY_NOTICES.md`. A changed official bundle fails the build instead of silently applying an incompatible transform.
