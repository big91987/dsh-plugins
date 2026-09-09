# dsh-browser-preview

A Session-scoped shared browser for DeepSeek Harness Web. The user and Agent operate the same Host-side Playwright page in a focused right panel, without the file tree, editor, protocol logs, cross-origin iframe restrictions, or cramped layout of `dsh-f12-inspector`.

## Install

```sh
pnpm install --frozen-lockfile
pnpm --dir plugins/dsh-browser-preview build
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add ./plugins/dsh-browser-preview
npx @deepseek-ai/dsh@0.1.1-rc.2 web
```

Refresh existing DSH pages after installation. The plugin launches an installed Chrome, Chromium, or Edge channel by default; `executablePath` can select another compatible binary.

The Session header button opens the panel manually. Agents can use `browser_preview_open`, `browser_preview_snapshot`, `browser_preview_inspect`, and `browser_preview_close`. Element annotations append URL, selector, text, bounds, and the user's comment to the current Session draft.

This reimplements the public behavior of Codex Desktop's shared browser. The Codex Desktop UI source is not part of the public `openai/codex` repository. DSH rc.2 also lacks an additive right-panel content slot, so the plugin uses the official Session-header slot and projects its surface into the existing details column only while active.

See [the Chinese guide](README.zh-CN.md) for behavior, migration, limitations, and usage examples.
