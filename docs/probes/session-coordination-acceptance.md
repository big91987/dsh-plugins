# Session coordination acceptance

The acceptance command builds and tests `dsh-session-coordination`, installs only that package into a fresh `@deepseek-ai/dsh@0.1.0-rc.6` web profile, verifies that no Worktree plugin entered the configuration, and boots the real web Host.

```sh
./scripts/accept-session-coordination.sh
```

The plugin lifecycle test assembles the actual rc.6 tool registry and proves that `list_threads`, `read_thread`, `send_message_to_thread`, `wait_threads`, and `fork_thread` each appear once and disappear when the plugin fiber unloads. Service tests cover non-resuming reads, attributed live and cold-resumed delivery, resume coalescing, bounded waiting, subagent exclusion, and completed-history continuation.
