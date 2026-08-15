# DSH profile installation probe

Date: 2026-08-15

## Environment

- DeepSeek Harness CLI: `0.1.0-rc.5`, launched from the read-only reference checkout with `pnpm dsh` because no global `dsh` executable is installed.
- Node.js: `v26.0.0`.
- pnpm: `11.7.0`.
- Profile: `dsh-plugins-probe` under a fresh `/var/tmp/dsh-plugins-probe.*` `DSH_HOME` removed by the script exit trap.

## Command

```sh
bash scripts/probe-profile.sh
```

The script built both workspace packages, installed their absolute package directories, dumped the effective profile configuration, removed both dependencies, and removed the temporary DSH home.

## Observed dependencies

```text
dsh-worktree link:/Users/zhaojiuzhou/work/dsh-plugins/plugins/dsh-worktree
dsh-session-coordination link:/Users/zhaojiuzhou/work/dsh-plugins/plugins/dsh-session-coordination
```

The two packages were separate profile dependencies. Neither package installed the other.

## Observed bundle layers

The effective configuration applied the base bundle first, then the two independently installed layers in installation order:

```yaml
# == dsh-worktree
- id: dsh-worktree
  name: dsh-worktree
# == dsh-session-coordination
- id: dsh-session-coordination
  name: dsh-session-coordination
```

This proves that a single source monorepo can provide two independently installable DSH bundles when users install local package directories. Remote per-plugin installation still requires separate npm packages or tarballs because the current Git package interface does not select a monorepo subdirectory.

## Cleanup result

Both `dsh plugin remove` operations completed successfully. The guarded exit trap then removed only the `mktemp` directory matching `/var/tmp/dsh-plugins-probe.*`; no persistent user profile was created or modified.

## Limit of this evidence

The probe proves package discovery and configuration composition. Package unit tests separately prove Cordis Host lifecycle. It does not yet prove Web client loading, Session-row contribution, Host API extension, or Codex behavior parity.
