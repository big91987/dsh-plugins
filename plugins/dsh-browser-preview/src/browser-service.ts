import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core'
import type {
  BrowserInput,
  BrowserPreviewEvent,
  BrowserSnapshot,
  BrowserViewport,
  ElementTarget,
  ViewportPoint,
} from './protocol.ts'

/** Browser operations required by the Session service. */
export interface BrowserRuntime {
  navigate(url: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  url(): Promise<string>
  title(): Promise<string>
  screenshot(): Promise<Buffer>
  dispatchInput(input: BrowserInput): Promise<void>
  inspectPoint(x: number, y: number): Promise<ElementTarget>
  onFrame(listener: (frame: Buffer) => void): () => void
  onStateChange(listener: () => void): () => void
  close(): Promise<void>
}

/** Factory seam that keeps Playwright process launch outside Session logic. */
export interface BrowserLauncher {
  create(sessionId: string, viewport: BrowserViewport): Promise<BrowserRuntime>
  dispose(): Promise<void>
}

interface BrowserRecord {
  readonly runtime: BrowserRuntime
  unsubscribeFrame: () => void
  unsubscribeState: () => void
  snapshot: BrowserSnapshot
  frame?: { readonly revision: number; readonly bytes: Buffer }
  historyIndex: number
  historyLength: number
}

const DEFAULT_VIEWPORT: BrowserViewport = { width: 1280, height: 800 }

/** One shared browser page per DSH Session. */
export class BrowserPreviewService {
  private readonly records = new Map<string, BrowserRecord>()
  private readonly listeners = new Map<string, Set<(event: BrowserPreviewEvent) => void>>()

  constructor(
    private readonly launcher: BrowserLauncher,
    private readonly viewport: BrowserViewport = DEFAULT_VIEWPORT,
  ) {}

  /** Open or reuse one Session page and navigate it. */
  async open(sessionId: string, url: string): Promise<BrowserSnapshot> {
    const record = await this.requireOrCreate(sessionId)
    record.snapshot = { ...record.snapshot, status: 'loading', error: undefined }
    try {
      await record.runtime.navigate(url)
      record.historyIndex += 1
      record.historyLength = record.historyIndex + 1
      record.snapshot = await this.readSnapshot(sessionId, record, 'ready')
      this.emit(sessionId, { kind: 'snapshot', snapshot: record.snapshot })
      this.emit(sessionId, { kind: 'open-panel', snapshot: record.snapshot })
      return record.snapshot
    } catch (error) {
      record.snapshot = await this.readSnapshot(sessionId, record, 'failed', error)
      this.emit(sessionId, { kind: 'snapshot', snapshot: record.snapshot })
      this.emit(sessionId, { kind: 'open-panel', snapshot: record.snapshot })
      throw error
    }
  }

  /** Navigate an already known or newly created Session page. */
  async navigate(sessionId: string, url: string): Promise<BrowserSnapshot> {
    return this.open(sessionId, url)
  }

  /** Move backward in the Session page history. */
  async back(sessionId: string): Promise<BrowserSnapshot> {
    const record = this.requireRecord(sessionId)
    await record.runtime.back()
    record.historyIndex = Math.max(0, record.historyIndex - 1)
    return this.refreshSnapshot(sessionId, record)
  }

  /** Move forward in the Session page history. */
  async forward(sessionId: string): Promise<BrowserSnapshot> {
    const record = this.requireRecord(sessionId)
    await record.runtime.forward()
    record.historyIndex = Math.min(record.historyLength - 1, record.historyIndex + 1)
    return this.refreshSnapshot(sessionId, record)
  }

  /** Reload the Session page. */
  async reload(sessionId: string): Promise<BrowserSnapshot> {
    const record = this.requireRecord(sessionId)
    await record.runtime.reload()
    return this.refreshSnapshot(sessionId, record)
  }

  /** Read current state without creating a browser. */
  async snapshot(sessionId: string): Promise<BrowserSnapshot | undefined> {
    const record = this.records.get(sessionId)
    if (record === undefined) return undefined
    record.snapshot = await this.readSnapshot(sessionId, record, record.snapshot.status)
    return record.snapshot
  }

  /** Read the newest retained screencast frame. */
  frame(sessionId: string): { readonly revision: number; readonly bytes: Buffer } | undefined {
    return this.records.get(sessionId)?.frame
  }

  /** Forward one user input without replay. */
  async dispatchInput(sessionId: string, input: BrowserInput): Promise<void> {
    await this.requireRecord(sessionId).runtime.dispatchInput(input)
  }

  /** Hit-test one viewport point in the real browser page. */
  async inspectPoint(sessionId: string, point: ViewportPoint): Promise<ElementTarget> {
    return this.requireRecord(sessionId).runtime.inspectPoint(point.x, point.y)
  }

  /** Capture a full current viewport PNG. */
  async screenshot(sessionId: string): Promise<Buffer> {
    return this.requireRecord(sessionId).runtime.screenshot()
  }

  /** Subscribe to state, frame, and panel requests for one Session. */
  subscribe(sessionId: string, listener: (event: BrowserPreviewEvent) => void): () => void {
    let set = this.listeners.get(sessionId)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(sessionId, set)
    }
    set.add(listener)
    return () => {
      set?.delete(listener)
      if (set?.size === 0) this.listeners.delete(sessionId)
    }
  }

  /** Close one Session page and ask connected clients to close the panel. */
  async close(sessionId: string): Promise<void> {
    const record = this.records.get(sessionId)
    if (record === undefined) return
    this.records.delete(sessionId)
    record.unsubscribeFrame()
    record.unsubscribeState()
    await record.runtime.close()
    this.emit(sessionId, { kind: 'close-panel' })
  }

  /** Close every owned browser resource. */
  async dispose(): Promise<void> {
    const ids = [...this.records.keys()]
    await Promise.all(ids.map(async id => this.close(id)))
    await this.launcher.dispose()
    this.listeners.clear()
  }

  private async requireOrCreate(sessionId: string): Promise<BrowserRecord> {
    const current = this.records.get(sessionId)
    if (current !== undefined) return current
    const runtime = await this.launcher.create(sessionId, this.viewport)
    const snapshot: BrowserSnapshot = {
      sessionId,
      url: 'about:blank',
      title: '',
      viewport: this.viewport,
      frameRevision: 0,
      canGoBack: false,
      canGoForward: false,
      status: 'idle',
    }
    const record: BrowserRecord = {
      runtime,
      snapshot,
      historyIndex: -1,
      historyLength: 0,
      unsubscribeFrame: () => {},
      unsubscribeState: () => {},
    }
    record.unsubscribeFrame = runtime.onFrame(bytes => {
      const revision = (record.frame?.revision ?? 0) + 1
      record.frame = { revision, bytes }
      record.snapshot = { ...record.snapshot, frameRevision: revision }
      this.emit(sessionId, { kind: 'frame', revision })
    })
    record.unsubscribeState = runtime.onStateChange(() => {
      void this.refreshSnapshot(sessionId, record).catch(() => {})
    })
    this.records.set(sessionId, record)
    return record
  }

  private requireRecord(sessionId: string): BrowserRecord {
    const record = this.records.get(sessionId)
    if (record === undefined) throw new Error(`browser preview is not open for Session ${JSON.stringify(sessionId)}`)
    return record
  }

  private async refreshSnapshot(sessionId: string, record: BrowserRecord): Promise<BrowserSnapshot> {
    record.snapshot = await this.readSnapshot(sessionId, record, 'ready')
    this.emit(sessionId, { kind: 'snapshot', snapshot: record.snapshot })
    return record.snapshot
  }

  private async readSnapshot(
    sessionId: string,
    record: BrowserRecord,
    status: BrowserSnapshot['status'],
    error?: unknown,
  ): Promise<BrowserSnapshot> {
    return {
      sessionId,
      url: await record.runtime.url(),
      title: await record.runtime.title(),
      viewport: this.viewport,
      frameRevision: record.frame?.revision ?? 0,
      canGoBack: record.historyIndex > 0,
      canGoForward: record.historyIndex >= 0 && record.historyIndex < record.historyLength - 1,
      status,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
    }
  }

  private emit(sessionId: string, event: BrowserPreviewEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event)
  }
}

/** Playwright implementation used by the Host plugin. */
export class PlaywrightBrowserLauncher implements BrowserLauncher {
  private browser: Browser | undefined

  constructor(private readonly executablePath?: string) {}

  async create(_sessionId: string, viewport: BrowserViewport): Promise<BrowserRuntime> {
    const browser = await this.ensureBrowser()
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    return new PlaywrightRuntime(context, page, cdp)
  }

  async dispose(): Promise<void> {
    await this.browser?.close()
    this.browser = undefined
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected() === true) return this.browser
    if (this.executablePath !== undefined) {
      this.browser = await chromium.launch({ headless: true, executablePath: this.executablePath })
      return this.browser
    }
    const failures: string[] = []
    for (const channel of ['chrome', 'chromium', 'msedge'] as const) {
      try {
        this.browser = await chromium.launch({ headless: true, channel })
        return this.browser
      } catch (error) {
        failures.push(`${channel}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(`browser preview could not launch Chromium (${failures.join('; ')})`)
  }
}

class PlaywrightRuntime implements BrowserRuntime {
  private readonly frameListeners = new Set<(frame: Buffer) => void>()
  private readonly stateListeners = new Set<() => void>()
  private readonly pressedKeys = new Set<string>()
  private readonly screencastHandler: (event: { data: string; sessionId: number }) => void
  private readonly navigationHandler: (frame: import('playwright-core').Frame) => void
  private lastFrameAt = 0
  private started = false

  constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {
    this.screencastHandler = event => {
      void this.cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId })
      const now = Date.now()
      if (now - this.lastFrameAt < 80) return
      this.lastFrameAt = now
      const frame = Buffer.from(event.data, 'base64')
      for (const listener of this.frameListeners) listener(frame)
    }
    this.navigationHandler = frame => {
      if (frame !== this.page.mainFrame()) return
      for (const listener of this.stateListeners) listener()
    }
    this.page.on('framenavigated', this.navigationHandler)
  }

  async navigate(url: string): Promise<void> {
    await this.ensureScreencast()
    await this.page.goto(url, { waitUntil: 'domcontentloaded' })
  }

  async back(): Promise<void> { await this.page.goBack({ waitUntil: 'domcontentloaded' }) }
  async forward(): Promise<void> { await this.page.goForward({ waitUntil: 'domcontentloaded' }) }
  async reload(): Promise<void> { await this.page.reload({ waitUntil: 'domcontentloaded' }) }
  async url(): Promise<string> { return this.page.url() }
  async title(): Promise<string> { return this.page.title() }
  async screenshot(): Promise<Buffer> { return this.page.screenshot({ type: 'png' }) }

  async dispatchInput(input: BrowserInput): Promise<void> {
    if (input.kind === 'mouse') {
      const type = input.event === 'move' ? 'mouseMoved' : input.event === 'down' ? 'mousePressed' : 'mouseReleased'
      await this.cdp.send('Input.dispatchMouseEvent', {
        type,
        x: input.x,
        y: input.y,
        button: input.button,
        clickCount: input.event === 'move' ? 0 : 1,
      })
      return
    }
    if (input.kind === 'wheel') {
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: input.x,
        y: input.y,
        deltaX: input.deltaX,
        deltaY: input.deltaY,
      })
      return
    }
    if (input.event === 'down') {
      if (input.text !== undefined && input.text !== '') {
        await this.page.keyboard.insertText(input.text)
      } else {
        this.pressedKeys.add(input.key)
        await this.page.keyboard.down(input.key)
      }
    } else {
      if (!this.pressedKeys.delete(input.key)) return
      await this.page.keyboard.up(input.key)
    }
  }

  async inspectPoint(x: number, y: number): Promise<ElementTarget> {
    const result = await this.page.evaluate(({ x: px, y: py }) => {
      const element = document.elementFromPoint(px, py)
      if (!(element instanceof HTMLElement)) throw new Error('no inspectable element at viewport point')
      const parts: string[] = []
      let current: HTMLElement | null = element
      while (current !== null && current !== document.body) {
        let part = current.tagName.toLowerCase()
        if (current.id !== '') {
          part += `#${CSS.escape(current.id)}`
          parts.unshift(part)
          break
        }
        const parent: HTMLElement | null = current.parentElement
        if (parent !== null) {
          const siblings = [...parent.children].filter(candidate => candidate.tagName === current?.tagName)
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
        }
        parts.unshift(part)
        current = parent
      }
      const rect = element.getBoundingClientRect()
      return {
        tagName: element.tagName,
        selector: parts.join(' > '),
        text: (element.textContent ?? '').trim().slice(0, 160),
        outerHtml: element.outerHTML.slice(0, 500),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      }
    }, { x, y })
    return result
  }

  onFrame(listener: (frame: Buffer) => void): () => void {
    this.frameListeners.add(listener)
    return () => { this.frameListeners.delete(listener) }
  }

  onStateChange(listener: () => void): () => void {
    this.stateListeners.add(listener)
    return () => { this.stateListeners.delete(listener) }
  }

  async close(): Promise<void> {
    this.page.off('framenavigated', this.navigationHandler)
    if (this.started) {
      this.cdp.off('Page.screencastFrame', this.screencastHandler)
      await this.cdp.send('Page.stopScreencast').catch(() => {})
    }
    await this.context.close()
  }

  private async ensureScreencast(): Promise<void> {
    if (this.started) return
    this.started = true
    this.cdp.on('Page.screencastFrame', this.screencastHandler)
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 82,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    })
  }
}
