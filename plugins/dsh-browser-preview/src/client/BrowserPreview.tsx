import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { BrowserSnapshot, ElementTarget, MouseButton } from '../protocol.ts'
import { BrowserPreviewHostApi } from './host-api.ts'
import { formatElementAnnotation, scaleViewportPoint } from './model.ts'
import css from './browser-preview.module.css'

interface Injected {
  readonly layout: ILayout
}

type EntryProps = PropsRuntime<'conversation.session.header.utilities'> & Injected

const ACTIVE_ATTRIBUTE = 'data-dsh-browser-preview-active'

function findDetailsColumn(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-pane="details"], [class*="detailsCol"]')
}

function normalizeAddress(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error('请输入网址')
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

function mouseButton(button: number): MouseButton {
  return button === 0 ? 'left' : button === 1 ? 'middle' : button === 2 ? 'right' : 'none'
}

interface PanelProps extends EntryProps {
  readonly api: BrowserPreviewHostApi
  readonly snapshot: BrowserSnapshot | null
  readonly setSnapshot: (snapshot: BrowserSnapshot | null) => void
  readonly closePanel: () => void
}

function BrowserPanel({ api, snapshot, setSnapshot, closePanel, inputActions, useInput }: PanelProps) {
  const [address, setAddress] = useState(snapshot?.url ?? '')
  const [maximized, setMaximized] = useState(false)
  const [annotating, setAnnotating] = useState(false)
  const [target, setTarget] = useState<ElementTarget | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const draft = useInput(state => state.draft)
  const surface = useRef<HTMLDivElement>(null)

  useEffect(() => { if (snapshot !== null) setAddress(snapshot.url) }, [snapshot?.url])

  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try { await operation() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const point = (event: React.PointerEvent<HTMLDivElement> | React.WheelEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const viewport = snapshot?.viewport ?? { width: 1280, height: 800 }
    return scaleViewportPoint(
      { x: event.clientX - box.left, y: event.clientY - box.top },
      { width: box.width, height: box.height },
      viewport,
    )
  }

  const navigate = (): void => {
    void run(async () => { setSnapshot(await api.navigate(normalizeAddress(address))) })
  }

  const inspect = (event: React.PointerEvent<HTMLDivElement>): void => {
    const at = point(event)
    void run(async () => { setTarget(await api.inspect(at.x, at.y)); setComment('') })
  }

  const submitAnnotation = (): void => {
    if (snapshot === null || target === null || comment.trim() === '') return
    const annotation = formatElementAnnotation(snapshot.url, target, comment)
    inputActions.setDraft(draft.trim() === '' ? annotation : `${draft}\n\n${annotation}`)
    setTarget(null)
    setComment('')
    setAnnotating(false)
    closePanel()
  }

  return (
    <section data-dsh-browser-preview className={`${css.panel} ${maximized ? css.maximized : ''}`} aria-label="浏览器预览">
      <header className={css.toolbar}>
        <button aria-label="后退" disabled={!snapshot?.canGoBack} onClick={() => { void run(async () => { setSnapshot(await api.action({ kind: 'back' })) }) }}>←</button>
        <button aria-label="前进" disabled={!snapshot?.canGoForward} onClick={() => { void run(async () => { setSnapshot(await api.action({ kind: 'forward' })) }) }}>→</button>
        <button aria-label="刷新" disabled={snapshot === null} onClick={() => { void run(async () => { setSnapshot(await api.action({ kind: 'reload' })) }) }}>↻</button>
        <form className={css.addressForm} onSubmit={event => { event.preventDefault(); navigate() }}>
          <input aria-label="网址" value={address} placeholder="输入 localhost 或网址" onChange={event => { setAddress(event.target.value) }} />
        </form>
        <button className={annotating ? css.activeButton : ''} aria-label="标注网页" disabled={snapshot === null} onClick={() => { setAnnotating(value => !value); setTarget(null) }}>✎</button>
        <button aria-label={maximized ? '退出最大化' : '最大化'} onClick={() => { setMaximized(value => !value) }}>{maximized ? '↙' : '↗'}</button>
        <button aria-label="关闭预览" onClick={closePanel}>×</button>
      </header>
      {error !== null && <div className={css.error}>{error}</div>}
      <div
        ref={surface}
        className={`${css.surface} ${annotating ? css.annotating : ''}`}
        tabIndex={0}
        onPointerDown={event => {
          surface.current?.focus()
          if (annotating) { inspect(event); return }
          const at = point(event)
          void run(() => api.action({ kind: 'mouse', event: 'down', ...at, button: mouseButton(event.button) }))
        }}
        onPointerUp={event => {
          if (annotating) return
          const at = point(event)
          void run(() => api.action({ kind: 'mouse', event: 'up', ...at, button: mouseButton(event.button) }))
        }}
        onWheel={event => {
          if (annotating) return
          event.preventDefault()
          const at = point(event)
          void run(() => api.action({ kind: 'wheel', ...at, deltaX: event.deltaX, deltaY: event.deltaY }))
        }}
        onKeyDown={event => {
          if (annotating) return
          event.preventDefault()
          const text = event.key.length === 1 && !event.ctrlKey && !event.metaKey ? event.key : undefined
          void run(() => api.action({ kind: 'key', event: 'down', key: event.key, ...(text === undefined ? {} : { text }) }))
        }}
        onKeyUp={event => {
          if (annotating) return
          event.preventDefault()
          void run(() => api.action({ kind: 'key', event: 'up', key: event.key }))
        }}
      >
        {snapshot?.frameRevision
          ? <img draggable={false} src={api.frameUrl(snapshot.frameRevision)} alt={snapshot.title || snapshot.url} />
          : <div className={css.empty}>{snapshot?.status === 'loading' ? '正在载入…' : '输入网址，或让 Agent 打开网页'}</div>}
        {target !== null && snapshot !== null && (
          <div className={css.targetBox} style={{
            left: `${target.rect.x / snapshot.viewport.width * 100}%`, top: `${target.rect.y / snapshot.viewport.height * 100}%`,
            width: `${target.rect.width / snapshot.viewport.width * 100}%`, height: `${target.rect.height / snapshot.viewport.height * 100}%`,
          }} />
        )}
      </div>
      {target !== null && (
        <div className={css.annotationBar}>
          <span title={target.selector}>{target.selector}</span>
          <input autoFocus value={comment} placeholder="写下要告诉 Agent 的问题" onChange={event => { setComment(event.target.value) }} onKeyDown={event => { if (event.key === 'Enter') submitAnnotation() }} />
          <button disabled={comment.trim() === ''} onClick={submitAnnotation}>加入对话</button>
          <button onClick={() => { setTarget(null) }}>取消</button>
        </div>
      )}
      <footer className={css.status}>{snapshot?.title || snapshot?.url || '共享浏览器'}{snapshot?.status === 'loading' ? ' · 载入中' : ''}</footer>
    </section>
  )
}

/** Header utility plus the Session-scoped browser surface in the right column. */
export function BrowserPreviewEntry(props: EntryProps) {
  const { sessionId, layout } = props
  const api = useMemo(() => new BrowserPreviewHostApi(sessionId), [sessionId])
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null)
  const [active, setActive] = useState(false)
  const [target, setTarget] = useState<HTMLElement | null>(() => findDetailsColumn())
  const visibleKey = `dsh.browser-preview.visible.${sessionId}`

  const activate = (): void => {
    document.documentElement.setAttribute(ACTIVE_ATTRIBUTE, sessionId)
    localStorage.setItem(visibleKey, '1')
    setActive(true)
    layout.openDetails()
  }
  const deactivate = (): void => {
    if (document.documentElement.getAttribute(ACTIVE_ATTRIBUTE) === sessionId) document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE)
    localStorage.removeItem(visibleKey)
    setActive(false)
    layout.closeDetails()
  }

  useEffect(() => {
    const observer = new MutationObserver(() => { setTarget(findDetailsColumn()) })
    observer.observe(document.body, { childList: true, subtree: true })
    void api.state().then(value => {
      setSnapshot(value)
      if (value !== null && localStorage.getItem(visibleKey) === '1') activate()
    }).catch(() => {})
    const unsubscribe = api.subscribe(event => {
      if (event.kind === 'frame') setSnapshot(current => current === null ? current : { ...current, frameRevision: event.revision })
      if (event.kind === 'snapshot') setSnapshot(event.snapshot)
      if (event.kind === 'open-panel') { setSnapshot(event.snapshot); activate() }
      if (event.kind === 'close-panel') deactivate()
    })
    return () => {
      observer.disconnect()
      unsubscribe()
      if (document.documentElement.getAttribute(ACTIVE_ATTRIBUTE) === sessionId) document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE)
    }
  }, [api, sessionId])

  return (
    <>
      <button type="button" className={css.headerButton} aria-label="浏览器预览" title="浏览器预览" onClick={() => { active ? deactivate() : activate() }}>◎</button>
      {active && target !== null && createPortal(
        <BrowserPanel {...props} api={api} snapshot={snapshot} setSnapshot={setSnapshot} closePanel={deactivate} />,
        target,
      )}
    </>
  )
}
