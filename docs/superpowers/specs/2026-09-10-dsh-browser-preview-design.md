# DSH Browser Preview Design

## Goal

Replace the installed `dsh-f12-inspector` iframe debugger with a Codex-style shared browser preview: the active agent can open and navigate the same browser surface the user sees, the page owns nearly all panel space, the panel can maximize, and users can attach element or area comments to the active conversation.

## Product boundary

The plugin is a browser preview and annotation surface. It does not contain a workspace file tree, source editor, protocol log, network panel, console panel, or general DevTools clone. Source changes remain the agent's job through normal filesystem tools.

The first release supports one browser page per DSH Session. The page persists while the Session is open and is disposed when the Host plugin unloads. Browser state is isolated between Sessions.

## Architecture

The existing cross-origin iframe is removed. A Host-side Playwright Chromium page owns navigation and rendering. A Chrome DevTools Protocol session emits screencast frames and receives mouse, wheel, and keyboard input. The Web client renders those frames in the details column and forwards user input to the Host through authenticated same-origin plugin routes.

Agent tools call the same Host browser service used by the Web panel. This guarantees that `browser_preview_open`, user interaction, screenshots, and inspection operate on one page rather than parallel browser instances.

The client uses the DSH `details` slot for the normal right column and a fixed frame-level overlay for maximized mode. The normal surface contains only browser chrome and the viewport.

## User experience

The toolbar contains Back, Forward, Reload, an address field, Annotation mode, Maximize or Restore, and Close. File browsing, editing, diagnostic output, and element metadata are absent from the normal view.

Opening a URL from chat calls `browser_preview_open`. The client receives the Session-scoped navigation event, opens the details column, and displays the page. Manual navigation uses the same service.

Annotation mode supports two gestures:

- Click an element: the Host hit-tests the page at the clicked viewport coordinate and returns its bounding rectangle, selector, tag, short text, and compact outer HTML.
- Drag an area: the client records the viewport rectangle without requiring DOM access.

Each gesture opens a compact comment editor over the preview. Saved comments remain pending until the user sends them to the active conversation. The submitted payload contains the URL, viewport size, screenshot, comment text, and either element metadata or an area rectangle. Annotations are overlays and never modify the page.

## Host interfaces

`BrowserPreviewService` owns Session-scoped browser instances and exposes:

```ts
interface BrowserPreviewService {
  open(sessionId: string, url: string): Promise<BrowserSnapshot>
  navigate(sessionId: string, url: string): Promise<BrowserSnapshot>
  back(sessionId: string): Promise<BrowserSnapshot>
  forward(sessionId: string): Promise<BrowserSnapshot>
  reload(sessionId: string): Promise<BrowserSnapshot>
  snapshot(sessionId: string): Promise<BrowserSnapshot>
  dispatchInput(sessionId: string, input: BrowserInput): Promise<void>
  inspectPoint(sessionId: string, point: ViewportPoint): Promise<ElementTarget>
  screenshot(sessionId: string): Promise<Buffer>
  subscribe(sessionId: string, listener: (event: BrowserPreviewEvent) => void): () => void
  dispose(): Promise<void>
}
```

HTTP routes provide state, commands, screenshots, and a Session-scoped server-sent event stream. Inputs are validated at the route boundary. URLs must use `http:` or `https:`. The service refuses loopback metadata endpoints and non-HTTP schemes; ordinary local development addresses remain allowed.

## Agent tools

The plugin registers:

- `browser_preview_open({ url })`: create or reuse the calling Session's page, navigate, and request that the client open the right panel.
- `browser_preview_snapshot()`: return the current URL, title, viewport, and a workspace screenshot path for model inspection.
- `browser_preview_inspect({ x, y })`: return compact DOM information at a viewport coordinate.
- `browser_preview_close()`: close the calling Session's browser page and panel.

The existing standalone `dsh-browser` plugin remains installed during migration but is not used by this plugin. After acceptance, duplicate browser tooling can be removed in a separate change.

## Failure behavior

Browser launch or navigation failures render a compact retry state in the viewport without collapsing the DSH Web application. A disconnected event stream reconnects and requests a fresh snapshot. Input failures do not replay automatically because repeating clicks or keystrokes could create unintended actions.

If Chromium is unavailable, the panel reports the required browser installation or executable configuration. No fallback iframe is used because it would restore the cross-origin failure this design removes.

## Security

All browser commands are scoped to the calling Session. Route requests carry the Session id and use DSH's existing same-origin authentication. The service never returns browser cookies, storage, authorization headers, or complete DOM documents to the client or model.

The page is untrusted. Annotation extraction is limited to the selected element fields. Agent tools do not automatically submit forms, upload files, or confirm consequential actions.

## Verification

Automated tests cover URL validation, Session isolation, command routing, event delivery, input-coordinate scaling, element hit-testing, annotation serialization, maximize and restore behavior, and client auto-open after an Agent tool call. A built browser smoke test opens a local fixture on a different origin, verifies rendering, selects an element, queues a comment, and confirms the conversation draft receives the annotation payload.

## Non-goals

- Full Chrome DevTools panels.
- Reusing the user's normal Chrome profile or cookies.
- Arbitrary browser extensions.
- Multiple tabs in one Session.
- Persistent browsing history across Host restarts.
- Editing project files from the preview panel.
