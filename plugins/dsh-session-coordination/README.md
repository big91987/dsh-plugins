# dsh-session-coordination

Adds five Codex-style tools for coordination across independent top-level Sessions in DeepSeek Harness `0.1.0-rc.6`:

- `list_threads`
- `read_thread`
- `send_message_to_thread`
- `wait_threads`
- `fork_thread`

`list_threads`, `read_thread`, and `wait_threads` do not resume stored Sessions. Sending a message cold-resumes an ordinary stored Session when necessary and records the sender Session in the message source. Subagent-owned task Sessions are intentionally excluded: these tools coordinate peer chats and do not replace subagent delegation.

`fork_thread` is implemented inside this package and copies only balanced completed-turn history. The package does not depend on `dsh-worktree`.

```sh
pnpm --filter dsh-session-coordination build
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add ./plugins/dsh-session-coordination
```

Compatibility is intentionally limited to the tested `0.1.0-rc.6` Host contract.
