import type { BrowserViewport, ElementTarget, ViewportPoint } from '../protocol.ts'

/** Convert one point in the scaled preview image to the browser viewport. */
export function scaleViewportPoint(point: ViewportPoint, rendered: BrowserViewport, viewport: BrowserViewport): ViewportPoint {
  return {
    x: Math.round(point.x * viewport.width / rendered.width),
    y: Math.round(point.y * viewport.height / rendered.height),
  }
}

/** Render an inspected DOM target as text ready for the active Session draft. */
export function formatElementAnnotation(url: string, target: ElementTarget, comment: string): string {
  const text = target.text === '' ? '' : `\n文本: ${target.text}`
  return `网页标注：${comment.trim()}\nURL: ${url}\n元素: ${target.selector}${text}\n位置: x=${Math.round(target.rect.x)}, y=${Math.round(target.rect.y)}, w=${Math.round(target.rect.width)}, h=${Math.round(target.rect.height)}`
}
