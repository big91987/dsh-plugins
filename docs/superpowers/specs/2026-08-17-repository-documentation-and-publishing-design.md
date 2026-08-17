# DSH Plugins Repository Documentation and Publishing Design

## Goal

Publish the current `dsh-plugins` history to the empty public repository `big91987/dsh-plugins` with accurate bilingual entry documentation for the three independently installable plugins.

## Documentation

`README.md` remains the English landing page and links to a new `README.zh-CN.md`. Both landing pages list `dsh-worktree`, `dsh-session-coordination`, and `dsh-compact-img`, explain local source installation into the `web` profile, show how each feature is invoked, and link to plugin-specific or bug-history documentation.

The Chinese README is the detailed operating guide for the current intended audience: the maintainer and trusted coworkers. It explains installation, updating, verification, use, uninstall behavior, Worktree storage and cleanup, Session coordination prompts and tool meanings, image compaction prerequisites, and known compatibility limits.

## Compatibility Disclosure

The documentation must distinguish supported DSH plugin mechanisms from compatibility-specific implementation choices:

- All three packages are bundle plugins installed through the official profile mechanism.
- `dsh-session-coordination` uses additive Host services and model tools, but its peer-Session protocol is plugin-owned because DSH does not currently expose Codex-equivalent cross-Session tools.
- `dsh-compact-img` uses the command, compaction, Session, attachment, and LLM services, but `/compact-img` is plugin-owned behavior rather than a built-in DSH command.
- `dsh-worktree` uses additive Host services for Git and continuation, but replaces the checksum-pinned `0.1.0-rc.6` Workspace browser client because that release has no public Session-row action extension point.
- Worktree Sessions are stored in separate internal Workspaces and projected under the source project in the browser. This matches the main Codex interaction but is not a first-class Project-to-Worktree relationship in the DSH domain model.
- The repository is pinned to `@deepseek-ai/dsh@0.1.0-rc.6`. A later DSH release requires explicit compatibility work.

## Publishing

Preserve the local commit history. Commit the existing Worktree fixes and the documentation intentionally, add the empty GitHub repository as `origin`, and push the resulting history to `main`. Because the target has no default branch, the initial publication goes directly to `main`; no bootstrap pull request is created.

## Verification

Before publication, run the repository typecheck, tests, build, package contract checks already included by the suite, and dry-run package inspection where useful. Confirm the working tree contains only intended files, confirm no credentials or local runtime state are tracked, and inspect the final commit range before pushing.
