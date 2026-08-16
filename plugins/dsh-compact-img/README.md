# dsh-compact-img

`/compact-img` — replace image-bearing spans of a session's history with a
text-only checkpoint, so a text-only model can then be selected for the same
session.

## Problem

When a session history contains images (a `read_image` tool result, a pasted
image, ...), the host refuses to switch the session to a text-only model
("does not accept image input, but this session already contains images").
`/compact` compacts only the oldest span and cannot target the images.

## What it does

1. Scans the current session surface for nodes whose content carries an image
   block (including images nested inside `tool/result` content).
2. Groups them into contiguous spans and expands each span to
   tool-pairing-balanced boundaries.
3. Compacts each span through the host compaction backend
   (`compactSurfaceRegion`, the same transaction `/compact` uses) with a
   multi-modal summarizer — the session's current routed model — so the images
   are *seen* and condensed into a text checkpoint.
4. The replacement checkpoint contains text only; the surface no longer has
   image blocks, so the model-switch gate now passes for a text-only model.

## Usage

```
/compact-img
```

Run it while the session is idle and while the session model is multi-modal
(e.g. `kimi-k3`), so the summarizer can see the images. No arguments.

## Install

```sh
pnpm install
pnpm build

pnpm dlx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add ./plugins/dsh-compact-img
```

## Requirements

- Host: DeepSeek Harness `@deepseek-ai/dsh@0.1.0-rc.6` (or compatible), with
  the `dsh-compaction-basic`, `dsh-token-meter`, and `dsh-commands` plugins
  mounted (they are part of the `base` bundle).
- The session's current model must accept image input for the summarization
  step to see the images.

## Notes

- Only current-surface nodes are considered; already-shadowed (previously
  compacted) content is untouched.
- The summarizer target is the latest routed request model (the model the
  session is currently using). If that model cannot see images, the compaction
  fails with an `UNSUPPORTED_CONTENT` error rather than silently dropping the
  images.
