# Repository Documentation and Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the three current DSH plugins with accurate English and detailed Chinese operating documentation.

**Architecture:** Keep each plugin independently installable and use the repository landing pages only as documentation and source-build guidance. Preserve the current implementation, disclose the rc.6-specific seams, validate the complete monorepo, and publish the existing history directly to the empty repository's `main` branch.

**Tech Stack:** Markdown, pnpm workspaces, TypeScript, Vitest, tsdown, Git, GitHub CLI.

## Global Constraints

- Modify only `<plugin-repository>`; the DeepSeek Harness checkout remains reference-only.
- Preserve the existing commit history and all current intended Worktree fixes.
- Target `@deepseek-ai/dsh@0.1.0-rc.6`; do not claim compatibility with later releases.
- Publish to the public repository `big91987/dsh-plugins` as `main`.
- Do not add credentials, local profiles, generated tarballs, or runtime Session/Worktree data.

---

### Task 1: Bilingual repository documentation

**Files:**
- Modify: `README.md`
- Create: `README.zh-CN.md`

**Interfaces:**
- Consumes: existing plugin READMEs, package manifests, Session bug record, and compatibility decision.
- Produces: English repository entry point and detailed Chinese installation/operation guide.

- [ ] **Step 1: Update the English landing page**

List all three independently installable packages, add the Chinese-language link, include all three source-install commands, and link each package name to its README.

- [ ] **Step 2: Write the Chinese guide**

Document prerequisites, clone/build/install/update/uninstall commands, usage for Worktree actions, Session coordination prompts/tools, `/compact-img`, persistent-data behavior, troubleshooting, and the exact official-extension deviations accepted for internal rc.6 use.

- [ ] **Step 3: Check documentation consistency**

Run:

```sh
rg -n 'Two independently|两个插件|TBD|TODO' README.md README.zh-CN.md
git diff --check -- README.md README.zh-CN.md
```

Expected: no stale two-plugin claim, placeholder, or whitespace error.

### Task 2: Validate the complete plugin repository

**Files:**
- Modify: none unless a validation failure is caused by the intended current changes.
- Test: `tests/*.spec.ts`
- Test: `plugins/*/tests/*.spec.ts`

**Interfaces:**
- Consumes: all three plugin packages and the current Worktree fixes.
- Produces: build, typecheck, and test evidence for publication.

- [ ] **Step 1: Install the locked dependencies**

Run `pnpm install --frozen-lockfile` and expect a successful lockfile-consistent installation.

- [ ] **Step 2: Run static and behavioral checks**

Run:

```sh
pnpm typecheck
pnpm test
pnpm build
```

Expected: all commands exit zero.

- [ ] **Step 3: Inspect publish contents**

Run `pnpm --filter dsh-worktree pack --dry-run`, `pnpm --filter dsh-session-coordination pack --dry-run`, and `pnpm --filter dsh-compact-img pack --dry-run`. Expect each package to include its bundle patch and built entry points without credentials or local state.

### Task 3: Commit and publish

**Files:**
- Stage: the existing intended Worktree fixes, `README.md`, `README.zh-CN.md`, and this plan.

**Interfaces:**
- Consumes: validated repository state and authenticated `gh`/Git access.
- Produces: public `big91987/dsh-plugins` repository with `main` as its initial branch.

- [ ] **Step 1: Audit intended changes**

Run `git status -sb`, `git diff --check`, `git diff --stat`, and inspect untracked files. Confirm every changed file belongs to the Worktree fix or repository documentation.

- [ ] **Step 2: Commit the implementation and documentation**

Stage explicit intended paths and commit with a terse description of the Worktree correction and public documentation.

- [ ] **Step 3: Configure the empty target repository**

Add `https://github.com/big91987/dsh-plugins.git` as `origin`, rename the current branch to `main`, and confirm the target remains empty before pushing.

- [ ] **Step 4: Push and verify**

Run `git push -u origin main`, then verify the remote default branch, latest commit, and repository URL with `gh repo view` and `gh api`.
