# dsh-worktree

Adds the Codex-style **Continue in new worktree** Session-row action to DeepSeek Harness `0.1.1-rc.2`, while retaining the official **Fork session** action.

The Worktree action creates a detached managed Git Worktree, copies configured working-tree changes, optionally runs setup, and publishes a new Session with the same incrementing title suffix used by official forks. The Host retains a separate internal Workspace for the Worktree directory, while the browser projects its Sessions under the original project with a Worktree marker. A successful continuation opens automatically. Failed setup can be retried, cancelled, dismissed, or explicitly continued without setup. Ordinary same-directory forks use the official Harness implementation.

```sh
pnpm --filter dsh-worktree build
pnpm dlx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add ./plugins/dsh-worktree
```

This release derives its browser contribution from the checksum-pinned official `0.1.1-rc.2` Workspace client because that release has no public Session-row action extension point. See `THIRD_PARTY_NOTICES.md`. A changed official bundle fails the build instead of silently applying an incompatible transform.
