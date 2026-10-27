# Repair legacy peer-message sources after a DSH upgrade

The old plugin wrote `session-relay` for an attributed peer follow-up. DSH 0.2.0-rc.2 admits the canonical source `agent-message` with the same `form: relay` and `senderSessionId`. Its official migration refuses the old custom kind. The plugin now emits the canonical kind. The plugin is now built against DSH 0.2.0-rc.2. An additional compatibility adapter upgrades released subagent descriptor v2 to v3: v3 only adds an optional reasoning-effort field, which remains absent. Model routing, persona and tool restrictions are preserved. Unknown fields or invalid values are refused.

## Supported repair

Requirements: Node.js with native Zstandard support, the `zstd` command, and an installed official `@deepseek-ai/dsh` 0.2.0-rc.2. No model calls or credentials are needed.

1. Stop DSH cleanly. Copy the **entire** sessions directory to a private backup, including child Sessions and all generations. Verify each file hash.
2. Prepare from that backup with a new staging directory on the same filesystem as the live sessions. The script rejects an existing stage and never writes into the backup:

```sh
node plugins/dsh-session-coordination/scripts/repair-session-sources.mjs \
  --source <backup>/sessions --stage <backup>/repair-stage \
  --dsh-package <installed-dsh>/package.json
```

3. Check `receipt.json`: failures must be empty. Only known message-bearing event slots and strictly validated descriptor-v2 events are converted. Missing sender attribution, extra source fields, symlinks and other unsupported data fail closed. Bodies, sender IDs, message IDs and timestamps remain unchanged. Tool output is never searched or rewritten. All copies are normalized before official migration, so parent migration can use the complete child corpus.
4. With DSH still stopped, publish the official current generations:

```sh
node plugins/dsh-session-coordination/scripts/repair-session-sources.mjs \
  --stage <backup>/repair-stage --apply-to <dsh-home>/sessions \
  --dsh-package <installed-dsh>/package.json
```

The adapter calls the official `SessionPersistence.open(..., 'write')` on staging copies. DSH validates and publishes current generations using its complete migration chain. Publication into the live corpus uses the same native `session.lock`, rechecks original hashes and exclusively links each new generation. No source log is replaced, no checkpoint is edited, no unknown source is reclassified as user input, and no installed SDK code is patched. Each published session has a `session-relay-repair.json` receipt. A conflicting current file refuses publication; a partial publication can be retried when already-published bytes match. Keep the staging directory immutable until application is finished.

5. Restart the same DSH version and profile. Open the reported old Session and a normal Session through the UI, verify history and input. Preserve the original backup and receipt. The old v0 artifact remains available for rollback; do not delete it.

This is a plugin-owned semantic adapter, not a relaxation of DSH's generic source classification. Changing the target DSH version requires revalidation. Existing unsupported unrelated sources remain errors.
