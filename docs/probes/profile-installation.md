# DSH profile installation probe

Date: 2026-08-15

## Environment

- DeepSeek Harness CLI: published package `@deepseek-ai/dsh@0.1.0-rc.6`, launched with `pnpm dlx` because no global `dsh` executable is installed.
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
dsh-worktree link:<plugin-repository>/plugins/dsh-worktree
dsh-session-coordination link:<plugin-repository>/plugins/dsh-session-coordination
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

The profile script proves package discovery and configuration composition. Package unit tests separately prove Cordis Host lifecycle. It does not prove Session-row contribution, Host API extension, or Codex behavior parity.

## Web client probe

A separate temporary `web` profile under `/var/tmp/dsh-worktree-web-probe.*` installed the local `dsh-worktree` package and started the published rc.6 Web application on loopback. The generated page boot graph contained:

```text
/plugins/dsh-worktree/client.js?rev=<content hash>
```

The corresponding route returned a closure bundle registered as `dsh-worktree` through `window.__ModuleLoader__.load`. A real browser load then observed:

```html
<html data-dsh-worktree-probe="loaded">
```

The marker is installed by the client plugin through a scoped Cordis effect and removed by its disposer. Browser console inspection reported no warnings or errors. This proves external Web client discovery, serving, closure execution, and client-plugin application on rc.6. It does not yet prove that rc.6 exposes a Session-row action registry or an extensible Host Session API.
