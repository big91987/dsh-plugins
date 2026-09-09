import { describe, expect, it } from 'vitest'
import { formatElementAnnotation, scaleViewportPoint } from '../src/client/model.ts'

describe('browser preview client model', () => {
  it('maps rendered-image points into browser viewport coordinates', () => {
    expect(scaleViewportPoint({ x: 320, y: 200 }, { width: 640, height: 400 }, { width: 1280, height: 800 }))
      .toEqual({ x: 640, y: 400 })
  })

  it('formats an inspected element as a concise conversation-ready annotation', () => {
    expect(formatElementAnnotation('https://example.com/app', {
      tagName: 'BUTTON', selector: '#save', text: '保存', outerHtml: '<button id="save">保存</button>',
      rect: { x: 10, y: 20, width: 80, height: 32 },
    }, '这里的间距太小')).toContain('网页标注：这里的间距太小\nURL: https://example.com/app\n元素: #save')
  })
})
