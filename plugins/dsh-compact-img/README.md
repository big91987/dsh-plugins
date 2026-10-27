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
   block (including image blocks in `tool/result` message content).
2. Groups them into contiguous spans and expands each span to
   tool-pairing-balanced boundaries.
3. Replays each span through the session's current routed multi-modal model so
   the images are *seen* and condensed into a text checkpoint, then records the
   replacement with the Host's durable compaction event vocabulary.
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

pnpm dlx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add ./plugins/dsh-compact-img
```

## Requirements

- Host: DeepSeek Harness `@deepseek-ai/dsh@0.2.0-rc.2`, with the
  `dsh-commands` plugin mounted (it is part of the `base` bundle).
- The session's current model must accept image input for the summarization
  step to see the images.

## Notes

- Only current-surface nodes are considered; already-shadowed (previously
  compacted) content is untouched.
- The summarizer target is the latest routed request model (the model the
  session is currently using). If that model cannot see images, the compaction
  fails with an `UNSUPPORTED_CONTENT` error rather than silently dropping the
  images.
- Provider failures such as `AUTH`, `QUOTA`, cancellation, and token-cap
  truncation are surfaced before the empty-text fallback.

## Why not only use `/compact`?

The built-in `0.2.0-rc.2` compactor can replay image references through a capable
summarization model. Its range selection is retention-driven, however: it
reduces older history and may leave recent image-bearing nodes untouched.
`/compact-img` is still useful when the explicit goal is to remove every image
from the current surface before selecting a text-only model. If ordinary
context reduction is the only goal, use the built-in `/compact` instead.
