# dsh-session-coordination

Adds five Codex-style tools for coordination across independent top-level Sessions in DeepSeek Harness `0.2.0-rc.2`:

- `list_threads`
- `read_thread`
- `send_message_to_thread`
- `wait_threads`
- `fork_thread`

`list_threads`, `read_thread`, and `wait_threads` do not resume stored Sessions. Sending a message cold-resumes an ordinary stored Session when necessary and records the sender Session in the message source. A cold-resumed Session keeps its last routed provider/model (recovered from its `request/header` event), so its persona renders correctly. Subagent-owned task Sessions are intentionally excluded: these tools coordinate peer chats and do not replace subagent delegation.

`fork_thread` is implemented inside this package and copies only balanced completed-turn history. The package does not depend on `dsh-worktree`.

```sh
pnpm --filter dsh-session-coordination build
pnpm dlx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add ./plugins/dsh-session-coordination
```

Compatibility is intentionally limited to the tested `0.2.0-rc.2` Host contract.

## Bug history

- [2026-08-16: cold-resumed Session failed with `prompt variable "{{model}}" has no value`](docs/bug-2026-08-16-cold-resume-model-variable.md) — fixed by passing the Session's last routed provider/model to `agents.resume`.

Legacy history recovery is documented in [history-migration.md](docs/history-migration.md). New peer relays use the official `agent-message` source so they can be migrated by the current Session codec.
