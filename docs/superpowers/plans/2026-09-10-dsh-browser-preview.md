# DSH Browser Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Codex-style Session-scoped shared browser preview for DSH with Agent navigation, a page-first right panel, maximize, and element or area annotations.

**Architecture:** A Host Playwright service owns one Chromium page per DSH Session and publishes CDP screencast frames through an SSE route. The Web client renders the stream, forwards browser input, and contributes a compact `details` slot; Agent tools address the same Session-scoped page.

**Tech Stack:** TypeScript, React 18, Cordis/DSH 0.1.1-rc.2 plugin APIs, Playwright Core, Chrome DevTools Protocol, Server-Sent Events, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-dsh-browser-preview-design.md`

## Global Constraints

- Do not modify the DeepSeek Harness repository.
- Do not expose file browsing, source editing, protocol logs, network panels, or console panels in the browser surface.
- Browser pages and commands are isolated by the calling DSH Session id.
- Only `http:` and `https:` navigation is accepted.
- Agent tools and the Web panel must use the same Host browser page.
- Keep the existing `dsh-browser` plugin installed until this replacement passes acceptance.

---

### Task 1: Package shell and protocol

**Files:**
- Create: `plugins/dsh-browser-preview/package.json`
- Create: `plugins/dsh-browser-preview/cordis.patch.yml`
- Create: `plugins/dsh-browser-preview/tsconfig.json`
- Create: `plugins/dsh-browser-preview/tsconfig.build.json`
- Create: `plugins/dsh-browser-preview/tsdown.config.ts`
- Create: `plugins/dsh-browser-preview/scripts/tsdown.client.ts`
- Create: `plugins/dsh-browser-preview/scripts/web-platform.ts`
- Create: `plugins/dsh-browser-preview/src/protocol.ts`
- Test: `plugins/dsh-browser-preview/tests/protocol.spec.ts`

**Interfaces:**
- Produces: `BrowserCommand`, `BrowserInput`, `BrowserSnapshot`, `ElementTarget`, `BrowserPreviewEvent`, `parseBrowserAction(value)` and `resolveBrowserUrl(value)`.

- [ ] **Step 1: Write failing protocol tests**

```ts
expect(resolveBrowserUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/')
expect(() => resolveBrowserUrl('file:///etc/passwd')).toThrow(/http/)
expect(parseBrowserAction({ kind: 'navigate', sessionId: 's1', url: 'https://example.com' }))
  .toEqual({ kind: 'navigate', sessionId: 's1', url: 'https://example.com/' })
expect(parseBrowserAction({ kind: 'mouse', sessionId: '', x: 1, y: 2 })).toBeUndefined()
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --dir plugins/dsh-browser-preview test -- protocol.spec.ts`

Expected: FAIL because `src/protocol.ts` does not exist.

- [ ] **Step 3: Implement the strict protocol parser and package build shell**

```ts
export function resolveBrowserUrl(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('browser preview accepts only http/https URLs')
  return url.href
}

export function parseBrowserAction(value: unknown): BrowserCommand | undefined {
  // Narrow at the HTTP boundary; reject unknown keys and invalid coordinates.
}
```

- [ ] **Step 4: Run protocol tests and package typecheck**

Run: `pnpm --dir plugins/dsh-browser-preview test -- protocol.spec.ts`

Run: `pnpm --dir plugins/dsh-browser-preview typecheck`

Expected: PASS.

### Task 2: Session-scoped Playwright/CDP service and Host routes

**Files:**
- Create: `plugins/dsh-browser-preview/src/browser-service.ts`
- Create: `plugins/dsh-browser-preview/src/host-routes.ts`
- Create: `plugins/dsh-browser-preview/src/http.ts`
- Test: `plugins/dsh-browser-preview/tests/browser-service.spec.ts`
- Test: `plugins/dsh-browser-preview/tests/host-routes.spec.ts`

**Interfaces:**
- Consumes: protocol types from Task 1.
- Produces: `BrowserPreviewService`, `BrowserLauncher`, `makeBrowserPreviewRoutes(service)`.

- [ ] **Step 1: Write failing service tests with a fake browser launcher**

```ts
const service = new BrowserPreviewService(fakeLauncher)
await service.open('session-a', 'http://127.0.0.1:4173')
await service.open('session-b', 'http://127.0.0.1:4174')
expect(fakeLauncher.pages).toHaveLength(2)
expect(service.snapshot('session-a').url).toBe('http://127.0.0.1:4173/')
await service.dispatchInput('session-a', { kind: 'mouseDown', x: 40, y: 20, button: 'left' })
expect(fakeLauncher.pages[0].inputs).toContainEqual(expect.objectContaining({ x: 40, y: 20 }))
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --dir plugins/dsh-browser-preview test -- browser-service.spec.ts host-routes.spec.ts`

Expected: FAIL because the service and routes do not exist.

- [ ] **Step 3: Implement one browser context/page/CDP session per DSH Session**

```ts
interface BrowserRecord {
  context: BrowserContext
  page: Page
  cdp: CDPSession
  snapshot: BrowserSnapshot
  subscribers: Set<(event: BrowserPreviewEvent) => void>
}

export class BrowserPreviewService {
  async open(sessionId: string, url: string): Promise<BrowserSnapshot> { /* launch or reuse, navigate, start screencast */ }
  async dispatchInput(sessionId: string, input: BrowserInput): Promise<void> { /* CDP Input.dispatch* */ }
  async inspectPoint(sessionId: string, point: ViewportPoint): Promise<ElementTarget> { /* elementFromPoint */ }
  async dispose(): Promise<void> { /* close all contexts and browser */ }
}
```

Throttle `Page.screencastFrame` to at most 12 frames per second, acknowledge every CDP frame, and emit only the newest retained JPEG frame.

- [ ] **Step 4: Implement guarded state/action/events/frame routes**

```ts
GET  /api/browser-preview/state?sessionId=s1
GET  /api/browser-preview/events?sessionId=s1
GET  /api/browser-preview/frame?sessionId=s1&revision=4
POST /api/browser-preview/action
```

Reuse the task-board route fence pattern: same-origin browser marker, loopback socket, exact Host authority, JSON size limit, no-store responses.

- [ ] **Step 5: Run service and route tests**

Run: `pnpm --dir plugins/dsh-browser-preview test -- browser-service.spec.ts host-routes.spec.ts`

Expected: PASS, including Session isolation and route rejection cases.

### Task 3: Agent tools and client transport

**Files:**
- Create: `plugins/dsh-browser-preview/src/tools.ts`
- Create: `plugins/dsh-browser-preview/src/index.ts`
- Create: `plugins/dsh-browser-preview/src/client/transport.ts`
- Create: `plugins/dsh-browser-preview/src/client/index.ts`
- Test: `plugins/dsh-browser-preview/tests/tools.spec.ts`
- Test: `plugins/dsh-browser-preview/tests/client-transport.client.spec.ts`

**Interfaces:**
- Consumes: `BrowserPreviewService` and route protocol.
- Produces: tools `browser_preview_open`, `browser_preview_snapshot`, `browser_preview_inspect`, `browser_preview_close`; client `BrowserPreviewTransport`.

- [ ] **Step 1: Write failing Agent-tool tests**

```ts
await callTool('browser_preview_open', { url: 'http://localhost:3000' }, agent('session-a'))
expect(service.open).toHaveBeenCalledWith('session-a', 'http://localhost:3000/')
expect(service.events('session-a')).toContainEqual(expect.objectContaining({ kind: 'open-panel' }))
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --dir plugins/dsh-browser-preview test -- tools.spec.ts client-transport.client.spec.ts`

Expected: FAIL because tools and transport do not exist.

- [ ] **Step 3: Register tools against the calling Agent id**

```ts
execute: async (args, exec) => {
  if (exec.agent === undefined) throw new Error('browser_preview_open requires a calling Session')
  return service.open(exec.agent.id, resolveBrowserUrl(args.url))
}
```

The snapshot tool writes PNG bytes through DSH `fs` under `.artifacts/browser-preview/` and returns the display path. The tool result never includes cookies, storage, or full DOM.

- [ ] **Step 4: Implement transport state, SSE reconnection, and commands**

```ts
export interface BrowserPreviewTransport {
  state(sessionId: string): Promise<BrowserSnapshot | undefined>
  subscribe(sessionId: string, onEvent: (event: BrowserPreviewEvent) => void): () => void
  command(command: BrowserCommand): Promise<BrowserSnapshot | void>
}
```

On reconnect, fetch state before accepting new frames. Do not replay failed input commands.

- [ ] **Step 5: Run tools and transport tests**

Run: `pnpm --dir plugins/dsh-browser-preview test -- tools.spec.ts client-transport.client.spec.ts`

Expected: PASS.

### Task 4: Codex-style panel, maximize, and annotations

**Files:**
- Create: `plugins/dsh-browser-preview/src/client/BrowserPreviewPanel.tsx`
- Create: `plugins/dsh-browser-preview/src/client/BrowserPreviewPanel.module.css`
- Create: `plugins/dsh-browser-preview/src/client/annotation.ts`
- Test: `plugins/dsh-browser-preview/tests/panel.client.spec.tsx`
- Test: `plugins/dsh-browser-preview/tests/annotation.spec.ts`

**Interfaces:**
- Consumes: `BrowserPreviewTransport`, current `sessionId`, DSH `layout`, and conversation input actions.
- Produces: `BrowserPreviewPanel`, `serializeAnnotations(annotations, snapshot)`.

- [ ] **Step 1: Write failing DOM tests for the minimal toolbar and maximize state**

```tsx
render(<BrowserPreviewPanel {...fixture} />)
expect(screen.getByRole('button', { name: '后退' })).toBeVisible()
expect(screen.getByRole('button', { name: '最大化' })).toBeVisible()
expect(screen.queryByText('文件')).toBeNull()
expect(screen.queryByText('协议日志')).toBeNull()
fireEvent.click(screen.getByRole('button', { name: '最大化' }))
expect(screen.getByTestId('browser-preview')).toHaveAttribute('data-maximized', 'true')
```

- [ ] **Step 2: Run focused UI tests and verify RED**

Run: `pnpm --dir plugins/dsh-browser-preview test -- panel.client.spec.tsx annotation.spec.ts`

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Implement the page-first panel**

The normal DOM is limited to toolbar, viewport image/canvas, annotation overlays, transient error/retry state, and pending-comment composer. Maximized mode uses `position: fixed; inset: 0; z-index: 1000` and restores without navigating or recreating the browser page.

- [ ] **Step 4: Implement coordinate scaling and input forwarding**

```ts
const x = (event.clientX - rect.left) * snapshot.viewport.width / rect.width
const y = (event.clientY - rect.top) * snapshot.viewport.height / rect.height
```

Forward click, pointer movement, wheel, and text-entry keys only when Annotation mode is off. Annotation mode intercepts click/drag and never activates the underlying page.

- [ ] **Step 5: Implement pending comments and conversation handoff**

```ts
serializeAnnotations([
  { kind: 'element', comment: '按钮太挤', selector: '#save', rect: { x: 10, y: 20, width: 80, height: 32 } },
], snapshot)
```

The payload names the URL and viewport, numbers each finding, and attaches the current bounded screenshot path. Saving queues; Enter sends immediately; Cmd/Ctrl+Enter queues without sending, matching the documented Codex interaction.

- [ ] **Step 6: Run UI tests and build**

Run: `pnpm --dir plugins/dsh-browser-preview test -- panel.client.spec.tsx annotation.spec.ts`

Run: `pnpm --dir plugins/dsh-browser-preview build`

Expected: PASS and `lib/client.js` contains no `iframe`, file tree, editor, or protocol log UI.

### Task 5: Cross-origin smoke, documentation, migration, and installation

**Files:**
- Create: `plugins/dsh-browser-preview/tests/fixtures/site/index.html`
- Create: `plugins/dsh-browser-preview/tests/browser-smoke.spec.ts`
- Create: `plugins/dsh-browser-preview/README.md`
- Create: `plugins/dsh-browser-preview/README.zh-CN.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Consumes: completed plugin.
- Produces: installable local package and migration instructions from `dsh-f12-inspector`.

- [ ] **Step 1: Write a smoke test serving the fixture on another origin**

```ts
await service.open('smoke', fixtureUrl)
await firstFrame(service, 'smoke')
const target = await service.inspectPoint('smoke', { x: 80, y: 60 })
expect(target.selector).toContain('#pricing-card')
```

- [ ] **Step 2: Run smoke and verify RED before final wiring**

Run: `pnpm --dir plugins/dsh-browser-preview test -- browser-smoke.spec.ts`

Expected: FAIL until the built plugin can launch Chromium and receive a frame.

- [ ] **Step 3: Complete docs and migration**

Document Agent prompts, manual toolbar operation, maximize, annotation shortcuts, Chromium discovery, privacy boundaries, and uninstall. State that browser data is separate from the user's regular Chrome profile.

- [ ] **Step 4: Run package verification**

Run: `pnpm --dir plugins/dsh-browser-preview test`

Run: `pnpm --dir plugins/dsh-browser-preview typecheck`

Run: `pnpm --dir plugins/dsh-browser-preview build`

Run: `git diff --check`

Expected: all PASS.

- [ ] **Step 5: Replace the installed external inspector**

Run: `dsh plugin --profile web remove dsh-f12-inspector`

Run: `dsh plugin --profile web add /Users/zhaojiuzhou/work/dsh-plugins/plugins/dsh-browser-preview`

Restart the existing DSH Web process with its current pinned CLI. Hard-refresh the active tab and verify that the old F12 entry is absent and the new Browser entry opens the compact panel.

- [ ] **Step 6: Perform manual acceptance**

Ask the active DSH Agent to start a development server and call `browser_preview_open`. Verify automatic panel opening, navigation, shared Agent/user state, maximize/restore, cross-origin rendering, element annotation, area annotation, and handoff to the conversation.
