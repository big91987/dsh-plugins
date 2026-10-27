# External DSH Plugin Feasibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that two packages in one monorepo can be installed independently through the official DSH bundle flow and determine whether external Host and browser contributions can support the Worktree and peer-Session features.

**Architecture:** The repository root owns only pnpm, TypeScript, Vitest, and shared commands. Each plugin is a complete DSH bundle with its own patch and entry point. The probe first verifies package discovery and Host loading, then browser loading, and finally records whether existing public slots and API registration are sufficient or require a configuration-row replacement.

**Tech Stack:** Node.js `^22.19.0 || >=24.0.0`, pnpm `11.7.0`, TypeScript `^6.0.3`, tsdown `^0.22.2`, Vitest `^4.1.8`, Cordis, DeepSeek Harness `0.1.0-rc.5`.

## Global Constraints

- `<upstream-reference>` is read-only reference material.
- `dsh-worktree` and `dsh-session-coordination` remain independently installable and publishable.
- Do not create an umbrella bundle or shared runtime package for the probe.
- Use a disposable profile named `dsh-plugins-probe`; do not change the user's normal `web` profile.
- Do not claim Codex parity from a loading probe.

---

### Task 1: Independent bundle manifests

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `plugins/dsh-worktree/package.json`
- Create: `plugins/dsh-worktree/cordis.patch.yml`
- Create: `plugins/dsh-session-coordination/package.json`
- Create: `plugins/dsh-session-coordination/cordis.patch.yml`
- Test: `tests/manifests.spec.ts`

**Interfaces:**
- Consumes: DSH bundle manifest field `{ "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }`.
- Produces: two package directories accepted by `dsh plugin --profile dsh-plugins-probe add <directory>`.

- [ ] **Step 1: Write the failing manifest test**

```ts
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

for (const name of ['dsh-worktree', 'dsh-session-coordination']) {
  describe(name, () => {
    it('declares its own DSH bundle patch', async () => {
      const manifest = JSON.parse(await readFile(new URL(`../plugins/${name}/package.json`, import.meta.url), 'utf8'))
      expect(manifest.name).toBe(name)
      expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
      expect(manifest.files).toContain('cordis.patch.yml')
    })
  })
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run tests/manifests.spec.ts`

Expected: FAIL because both package manifests are absent.

- [ ] **Step 3: Create the root workspace and both manifests**

Use independent package names, `type: module`, `main: lib/index.js`, `types: lib/index.d.ts`, bundle patch metadata, and package-local `build`, `typecheck`, and `test` scripts. Configure root recursive scripts without production dependencies between the two plugins.

- [ ] **Step 4: Run the manifest test**

Run: `pnpm exec vitest run tests/manifests.spec.ts`

Expected: PASS for both packages.

- [ ] **Step 5: Commit**

```sh
git add package.json pnpm-workspace.yaml tsconfig.json .gitignore plugins tests/manifests.spec.ts
git commit -m "build: scaffold independent dsh plugins"
```

### Task 2: Host loading probes

**Files:**
- Create: `plugins/dsh-worktree/src/index.ts`
- Create: `plugins/dsh-worktree/tests/host.spec.ts`
- Create: `plugins/dsh-session-coordination/src/index.ts`
- Create: `plugins/dsh-session-coordination/tests/host.spec.ts`
- Modify: `plugins/dsh-worktree/cordis.patch.yml`
- Modify: `plugins/dsh-session-coordination/cordis.patch.yml`

**Interfaces:**
- Consumes: Cordis `Context`, `ctx.provide()`, and `ctx.effect()`.
- Produces: `ctx.dshWorktreeProbe` and `ctx.dshSessionCoordinationProbe`, each exposing `{ readonly loaded: true }` for the lifetime of its plugin scope.

- [ ] **Step 1: Write failing host lifecycle tests**

For each package, create a Cordis context, apply the plugin, assert that its named probe service is present with `loaded === true`, dispose the context, and assert the service is no longer available.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --filter dsh-worktree test && pnpm --filter dsh-session-coordination test`

Expected: FAIL because neither host entry point exists.

- [ ] **Step 3: Implement the minimal scoped services**

Each `apply(ctx)` must register its own service through a Cordis lifecycle effect. Neither package may import the other.

- [ ] **Step 4: Add one plugin row per package patch**

`dsh-worktree/cordis.patch.yml` inserts `name: dsh-worktree`; `dsh-session-coordination/cordis.patch.yml` inserts `name: dsh-session-coordination`. The ids must be distinct and direct.

- [ ] **Step 5: Run tests, type checking, and builds**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: all commands exit 0 and each package emits `lib/index.js` plus declarations.

- [ ] **Step 6: Commit**

```sh
git add plugins
git commit -m "test: prove external host plugin loading"
```

### Task 3: Official profile installation probe

**Files:**
- Create: `scripts/probe-profile.sh`
- Create: `docs/probes/profile-installation.md`

**Interfaces:**
- Consumes: built package directories and the installed `dsh` CLI.
- Produces: captured commands proving two independent dependencies and two ordered bundle layers in profile `dsh-plugins-probe`.

- [ ] **Step 1: Write a shell probe that stops on the first failure**

The script resolves the repository root, builds both packages, adds each absolute package directory to `dsh-plugins-probe`, runs `dsh --profile dsh-plugins-probe --dump-config`, checks for both layer comments and both plugin rows, and removes both dependencies in a cleanup trap.

- [ ] **Step 2: Run the probe**

Run: `bash scripts/probe-profile.sh`

Expected: both bundle layers appear in the dumped configuration and cleanup removes both packages even after a failed assertion.

- [ ] **Step 3: Record exact evidence**

Document the DSH version, Node version, pnpm version, commands, observed layer order, package-link form, and cleanup result in `docs/probes/profile-installation.md`. Do not paste machine credentials or full home-directory configuration.

- [ ] **Step 4: Commit**

```sh
git add scripts/probe-profile.sh docs/probes/profile-installation.md
git commit -m "test: verify official bundle installation flow"
```

### Task 4: Browser client loading probe

**Files:**
- Modify: `plugins/dsh-worktree/package.json`
- Create: `plugins/dsh-worktree/src/client/index.ts`
- Create: `plugins/dsh-worktree/tests/client-manifest.spec.ts`
- Modify: `plugins/dsh-worktree/cordis.patch.yml`
- Modify: `scripts/probe-profile.sh`
- Modify: `docs/probes/profile-installation.md`

**Interfaces:**
- Consumes: DSH client package metadata `{ dsh: { client: { inject: string[], platform: "web" } } }` and the browser slot service.
- Produces: a browser-loaded probe contribution whose registration can be observed without changing upstream source.

- [ ] **Step 1: Write the failing client manifest test**

Assert that `dsh-worktree` exports `./client`, declares `dsh.client.platform === 'web'`, declares required injected client packages, and includes `lib/client.js` in published files.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter dsh-worktree test`

Expected: FAIL because the browser face is not declared.

- [ ] **Step 3: Add the minimal browser face**

The client entry point registers a reversible marker through an existing public root slot or locale registry. It must not patch React components or access private module state.

- [ ] **Step 4: Build and inspect package contents**

Run: `pnpm --filter dsh-worktree build && pnpm --filter dsh-worktree pack --pack-destination ../../.artifacts`

Expected: the tarball contains `lib/client.js`, its declarations, the Host entry point, package manifest, and bundle patch.

- [ ] **Step 5: Start the disposable profile and observe the browser contribution**

Run the profile on an unused loopback port, open it, and verify the browser plugin roster includes `dsh-worktree` and that the reversible marker registers once. Stop the profile through its normal signal path.

- [ ] **Step 6: Record the result and commit**

```sh
git add plugins/dsh-worktree scripts/probe-profile.sh docs/probes/profile-installation.md
git commit -m "test: probe external browser contribution"
```

### Task 5: Extension-point decision

**Files:**
- Create: `docs/decisions/0001-external-extension-points.md`
- Modify: `docs/superpowers/specs/2026-08-15-dsh-codex-parity-plugins-design.md`

**Interfaces:**
- Consumes: effective config, Host loading result, browser roster result, upstream rc.5 slot declarations, and ApiProxy registration behavior.
- Produces: one selected implementation route: direct contribution, configuration-row replacement, or documented platform gap.

- [ ] **Step 1: Inspect the exact required upstream extension points**

Compare the external probe with the preserved in-tree implementation at `<upstream-reference>/.worktrees/session-workspaces`, specifically the Session-row action registry, pending Worktree slot, client runtime mirror, ApiProxy Session routes, and generated API catalog.

- [ ] **Step 2: Test direct registration without upstream changes**

Create a disposable experiment branch in this repository only. Attempt to register one Session-row action and one Host request through public services. Record compile-time and runtime evidence for each.

- [ ] **Step 3: Test configuration-row replacement only if direct registration fails**

Use a temporary patch layer to replace the narrowest upstream row with a plugin-owned compatible package. Verify the existing Web profile still boots and unrelated Session actions remain present.

- [ ] **Step 4: Write the decision**

Record the selected route, public interfaces used, upstream rows replaced if any, compatibility range, failures that must be loud at load time, and evidence commands. State explicitly whether full Codex parity is externally achievable on rc.5.

- [ ] **Step 5: Self-review and commit**

Search for unresolved placeholders and contradictions, then run `pnpm test && pnpm typecheck && pnpm build` before committing.

```sh
git add docs
git commit -m "docs: decide external dsh extension strategy"
```
