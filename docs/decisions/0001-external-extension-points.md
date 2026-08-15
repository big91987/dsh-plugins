# Decision 0001: External extension strategy on DSH rc.6

Status: accepted for implementation

Date: 2026-08-15

## Decision

`dsh-session-coordination` remains a purely additive external bundle. `dsh-worktree` uses additive Host services and a replacement Web Workspace consumer: its bundle disables the built-in `ui-workspace` row and inserts the `dsh-worktree` row under a distinct id. The replacement client must preserve the complete rc.6 Workspace browser and picker behavior while adding Codex-style **Continue in new chat** and **Continue in new worktree** actions.

The first compatible release is pinned to `@deepseek-ai/dsh@0.1.0-rc.6`. It must fail loudly when the required Host services or browser slot declarations are absent. Compatibility with a later DSH release requires an explicit verification and package release; the plugin must not claim an open-ended prerelease range.

## Evidence

### External bundles and browser clients load

`scripts/probe-profile.sh` installed `dsh-worktree` and `dsh-session-coordination` as separate dependencies and observed two separate configuration layers. A temporary rc.6 Web profile discovered, served, and executed `dsh-worktree/lib/client.js`; the scoped browser probe produced `<html data-dsh-worktree-probe="loaded">` with no browser warnings or errors. Full commands and results are recorded in `docs/probes/profile-installation.md`.

### The Session-row menu has no additive extension point

The published `@deepseek-ai/dsh-client-ui-workspace@0.1.0-rc.6` package exports Workspace browser, picker, directory-flow slot, and injected-action types. It does not export a Session-row action registry or declare a Session-row child slot. Its compiled Session row constructs the Fork and Archive menu entries directly.

The preserved in-tree experiment added a new action registry precisely because the upstream package lacks one:

```text
/Users/zhaojiuzhou/work/deepseek-harness/.worktrees/session-workspaces/packages/client/ui-workspace/src/client/session-row-actions.ts
```

Therefore an additive browser plugin cannot register the requested right-click entries through an rc.6 public UI interface.

### A patch cannot rename an existing row

The following overlay was rejected:

```yaml
- id: ui-workspace
  name: dsh-worktree
```

The rc.6 dump reported:

```text
patch: name mismatch for "ui-workspace" (expected "@deepseek-ai/dsh-client-ui-workspace", got "dsh-worktree"), skipping
```

The patch format supports id-targeted `config`/`disabled` overrides and `insert` lists; it has no remove operation.

### Disable plus insert is supported

With the local package already contributing its own row, this overlay composed successfully:

```yaml
- id: ui-workspace
  disabled: true
```

The effective configuration retained the built-in row as disabled and retained the independently inserted plugin row:

```yaml
- id: ui-workspace
  name: '@deepseek-ai/dsh-client-ui-workspace'
  disabled: true
- id: dsh-worktree
  name: dsh-worktree
```

The production bundle will use this supported composition rather than attempting to rename or remove the built-in row.

### Host capabilities can remain additive

DSH rc.6 exposes plugin-owned Cordis services and the Typert registry/gateway mechanism for additional generated Remote capabilities. Worktree creation, pending lifecycle, and continuation therefore do not require modifying the legacy ApiProxy package. The Worktree client can mount its own generated Remote contribution through the existing client Remote service.

`dsh-session-coordination` does not require a browser Remote for its primary contract. Its service and five model tools run on the Host and consume Session persistence, Agent registry, continuation, and tool registries through Cordis injection.

## Rejected alternatives

### One umbrella bundle

Rejected because Worktree continuation and peer Session coordination are independently useful and independently installable. They share repository tooling, not a required runtime package.

### DOM event interception around the built-in Session row

Rejected because selectors, menu ownership, focus handling, accessibility, HMR cleanup, and drag state would depend on private rendered markup. Visual similarity would not be behavioral parity or a stable plugin integration.

### Direct modification of DeepSeek Harness

Rejected because the official contribution process requires ecosystem plugins in independent repositories and currently does not accept external PRs. The upstream checkout remains read-only reference material.

### Silent degradation to a command-only Worktree feature

Rejected because the requested product behavior explicitly includes the two Session-row context-menu entries and Codex-like continuation lifecycle.

## Consequences

- `dsh-worktree` owns a compatibility copy of the rc.6 Workspace browser client code and must track upstream changes deliberately.
- Before every `dsh-worktree` release, tests compare preserved built-in Workspace behavior as well as the two added actions.
- The plugin patch disables the official Workspace UI only after the replacement package has successfully loaded; package build and install failures must stop profile activation rather than leave a partially functional sidebar.
- The Host Worktree implementation and its tests remain independent from the replacement UI so a later upstream Session-row action registry can remove the copied UI without rewriting Git or continuation logic.
- If DSH publishes an additive Session-row action extension point, migrate to it and stop disabling `ui-workspace` in the next compatibility release.
