import { describe, expect, it, vi } from 'vitest'
import type { BrowserInput, BrowserViewport, ElementTarget } from '../src/protocol.ts'
import {
  BrowserPreviewService,
  type BrowserLauncher,
  type BrowserRuntime,
} from '../src/browser-service.ts'

class FakeRuntime implements BrowserRuntime {
  currentUrl = 'about:blank'
  currentTitle = ''
  readonly inputs: BrowserInput[] = []
  readonly navigations: string[] = []
  closed = false
  private frameListener: ((frame: Buffer) => void) | undefined
  private stateListener: (() => void) | undefined

  async navigate(url: string): Promise<void> {
    this.currentUrl = url
    this.currentTitle = `Page ${url}`
    this.navigations.push(url)
  }

  async back(): Promise<void> {}
  async forward(): Promise<void> {}
  async reload(): Promise<void> {}
  async url(): Promise<string> { return this.currentUrl }
  async title(): Promise<string> { return this.currentTitle }
  async screenshot(): Promise<Buffer> { return Buffer.from('png') }
  async dispatchInput(input: BrowserInput): Promise<void> { this.inputs.push(input) }
  async inspectPoint(_x: number, _y: number): Promise<ElementTarget> {
    return {
      tagName: 'BUTTON',
      selector: '#save',
      text: 'Save',
      outerHtml: '<button id="save">Save</button>',
      rect: { x: 10, y: 20, width: 80, height: 32 },
    }
  }
  onFrame(listener: (frame: Buffer) => void): () => void {
    this.frameListener = listener
    return () => { this.frameListener = undefined }
  }
  onStateChange(listener: () => void): () => void {
    this.stateListener = listener
    return () => { this.stateListener = undefined }
  }
  emitFrame(frame = Buffer.from('jpeg')): void { this.frameListener?.(frame) }
  emitStateChange(): void { this.stateListener?.() }
  async close(): Promise<void> { this.closed = true }
}

class FakeLauncher implements BrowserLauncher {
  readonly runtimes: FakeRuntime[] = []
  async create(_sessionId: string, _viewport: BrowserViewport): Promise<BrowserRuntime> {
    const runtime = new FakeRuntime()
    this.runtimes.push(runtime)
    return runtime
  }
  async dispose(): Promise<void> {}
}

describe('BrowserPreviewService', () => {
  it('isolates browser pages and state between DSH Sessions', async () => {
    const launcher = new FakeLauncher()
    const service = new BrowserPreviewService(launcher)

    await service.open('session-a', 'http://127.0.0.1:4173/')
    await service.open('session-b', 'http://127.0.0.1:4174/')

    expect(launcher.runtimes).toHaveLength(2)
    expect((await service.snapshot('session-a'))?.url).toBe('http://127.0.0.1:4173/')
    expect((await service.snapshot('session-b'))?.url).toBe('http://127.0.0.1:4174/')
  })

  it('forwards input only to the addressed Session page', async () => {
    const launcher = new FakeLauncher()
    const service = new BrowserPreviewService(launcher)
    await service.open('session-a', 'http://127.0.0.1:4173/')
    await service.open('session-b', 'http://127.0.0.1:4174/')

    await service.dispatchInput('session-a', { kind: 'mouse', event: 'down', x: 40, y: 20, button: 'left' })

    expect(launcher.runtimes[0].inputs).toEqual([{ kind: 'mouse', event: 'down', x: 40, y: 20, button: 'left' }])
    expect(launcher.runtimes[1].inputs).toEqual([])
  })

  it('publishes an open-panel event and retains the newest frame', async () => {
    const launcher = new FakeLauncher()
    const service = new BrowserPreviewService(launcher)
    const events: string[] = []
    service.subscribe('session-a', event => { events.push(event.kind) })

    await service.open('session-a', 'http://127.0.0.1:4173/')
    launcher.runtimes[0].emitFrame(Buffer.from('newest'))

    expect(events).toEqual(['snapshot', 'open-panel', 'frame'])
    expect(service.frame('session-a')).toEqual({ revision: 1, bytes: Buffer.from('newest') })
  })

  it('closes only the addressed Session page', async () => {
    const launcher = new FakeLauncher()
    const service = new BrowserPreviewService(launcher)
    await service.open('session-a', 'http://127.0.0.1:4173/')
    await service.open('session-b', 'http://127.0.0.1:4174/')

    await service.close('session-a')

    expect(launcher.runtimes[0].closed).toBe(true)
    expect(launcher.runtimes[1].closed).toBe(false)
    expect(await service.snapshot('session-a')).toBeUndefined()
  })

  it('publishes page-initiated navigation state', async () => {
    const launcher = new FakeLauncher()
    const service = new BrowserPreviewService(launcher)
    await service.open('session-a', 'http://127.0.0.1:4173/')
    const snapshots: string[] = []
    service.subscribe('session-a', event => {
      if (event.kind === 'snapshot') snapshots.push(event.snapshot.url)
    })

    launcher.runtimes[0].currentUrl = 'http://127.0.0.1:4173/next'
    launcher.runtimes[0].emitStateChange()
    await vi.waitFor(() => { expect(snapshots).toContain('http://127.0.0.1:4173/next') })
  })
})
