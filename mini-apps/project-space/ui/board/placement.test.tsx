import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { bindMiniAppUiComponents } from '@localixai/mini-app-sdk/ui'
import { emptySpace } from '../../shared/format/document'
import { applyOps } from '../../shared/ops/apply'
import { spaceTypes } from '../../shared/types'
import { INSERTABLE } from '../elements'
import { shapePath } from '../elements/shape-path'
import { PlacementPreview } from './PlacementGhost'
import { placementOf } from './placement'

test('every insertable preview has the props and dimensions of the created element', () => {
  const Empty = () => null
  const unbind = bindMiniAppUiComponents({
    FileTab: Empty,
    TableGrid: () => <div>Host table grid</div>,
    ContextBindingIcon: Empty,
    ContextBindingPreview: Empty,
    Input: Empty,
    Textarea: Empty,
    ProblemLine: Empty,
    ProblemState: Empty,
  })
  try {
    for (const view of INSERTABLE) {
      const placement = placementOf(
        view.type,
        view.insert?.input === 'link' ? { url: 'https://example.com' } : undefined,
      )!
      expect(placement).not.toBeNull()
      const { space, results } = applyOps(
        emptySpace(),
        [{ op: 'create', id: 'preview', type: view.type, props: placement.props, x: 0, y: 0 }],
        { registry: spaceTypes },
      )
      expect(results[0]?.ok).toBe(true)
      expect(space.elements.preview).toMatchObject({ ...placement.size, props: placement.props })
      const html = renderToStaticMarkup(<PlacementPreview placement={placement} />)
      expect(html).toContain('space-ghost-content')
      expect(html).not.toContain('<textarea')
      expect(html).not.toContain('space-selected')
      expect(html.includes('space-surface')).toBe(view.chrome === 'card')
    }
  } finally {
    unbind()
  }
})

test('a chosen shape preview draws its actual geometry and material', () => {
  const placement = placementOf('shape', { kind: 'triangle', color: 'purple', fill: 'none' })!
  const html = renderToStaticMarkup(<PlacementPreview placement={placement} />)
  expect(html).toContain('space-tone-purple')
  expect(html).toContain('space-shape-none')
  expect(html).toContain(shapePath('triangle', placement.size.w, placement.size.h, 1.5))
  expect(html).not.toContain('space-shape-material')
})

test('navigation, reference types and invalid presets cannot become placement previews', () => {
  for (const type of ['select', 'hand', 'unknown', 'file']) expect(placementOf(type)).toBeNull()
  expect(placementOf('shape', { kind: 'invalid' })).toBeNull()
})
