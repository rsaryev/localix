import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PreviewQuickAdd } from './PreviewQuickAdd'

describe('PreviewQuickAdd', () => {
  test('positions from the same 28px control measure it renders', () => {
    const html = renderToStaticMarkup(
      <PreviewQuickAdd
        rect={{ x: 10, y: 50, width: 120, height: 18 }}
        bodySize={{ w: 400, h: 300 }}
        onAdd={() => {}}
      />,
    )

    expect(html).toContain('style="left:10px;top:16px"')
    expect(html).toContain('h-[var(--chrome-control-md)]')
    expect(html).toContain('w-[116px]')
    expect(html).toContain('z-(--z-controls)')
    expect(html).not.toContain('title=')
  })

  test('flips below a selection near the top and clamps to the preview edge', () => {
    const html = renderToStaticMarkup(
      <PreviewQuickAdd
        rect={{ x: 390, y: 2, width: 24, height: 18 }}
        bodySize={{ w: 400, h: 300 }}
        onAdd={() => {}}
      />,
    )

    expect(html).toContain('style="left:278px;top:26px"')
  })
})
