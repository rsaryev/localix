import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  AXIS_LABEL_BASELINE,
  AXIS_LABEL_GAP,
  AXIS_TICK_FONT,
  CHART_FRAME_INSET,
  CHART_LEGEND_GAP,
  LABEL_CAP_HEIGHT,
  LEGEND_LABEL_GAP,
  LEGEND_SWATCH,
  LEGEND_SWATCH_RADIUS,
  LEGEND_SWATCH_Y,
} from './charts/geometry'

const uiRoot = import.meta.dir
const read = (path: string) => readFileSync(resolve(uiRoot, path), 'utf8')

/**
 * SDK UI components render inside host and plugin surfaces that are already on
 * the workbench geometry scale (`--chrome-control-*` in the app stylesheet).
 * These are the rules that keep them from drifting back off it.
 */
describe('SDK UI geometry contracts', () => {
  test('sizes segmented controls with the host control scale, never raw heights', () => {
    const source = read('segmented-control.tsx')

    // Track sm/md and item sm/md, in that order: 24/32 outer, 20/28 inner.
    for (const token of [
      'h-[var(--chrome-control-sm)]',
      'h-[var(--chrome-control-lg)]',
      'h-[var(--chrome-control-xs)]',
      'h-[var(--chrome-control-md)]',
    ]) {
      expect(source).toContain(token)
    }

    // A raw Tailwind height would silently re-introduce a second scale.
    expect(source).not.toMatch(/'[^']*\bh-\d(?:\.\d)?\b/)
    expect(source).not.toMatch(/`[^`]*\bh-\d(?:\.\d)?\b/)
  })

  test('keeps an item exactly one rung inside its p-0.5 track', () => {
    const source = read('segmented-control.tsx')
    // Keyed by the track's rung. sm: 24 − 2×2 = 20 (xs). lg: 32 − 2×2 = 28 (md). Both p-0.5.
    expect(source).toContain("sm: 'h-[var(--chrome-control-sm)]'")
    expect(source).toContain("lg: 'h-[var(--chrome-control-lg)]'")
    expect(source).toContain("sm: 'h-[var(--chrome-control-xs)]'")
    expect(source).toContain("lg: 'h-[var(--chrome-control-md)]'")
    expect(source.match(/ p-0\.5\b/g) ?? []).toHaveLength(2)
  })

  test('lets every segmented item shrink instead of forcing consumer overrides', () => {
    const source = read('segmented-control.tsx')
    expect(source.match(/min-w-0/g) ?? []).not.toHaveLength(0)
    // The action item and the radio item are the same control; neither may be
    // the one that overflows its track when a label is long.
    expect(source.match(/min-w-0/g)!.length).toBeGreaterThanOrEqual(3)
  })

  test('keeps the compact facade on the shared item padding ladder', () => {
    // `Segmented` styles its options on top of the shared item classes; an
    // inline-padding override there made it wider than every other segment.
    expect(read('segmented-control.tsx')).not.toContain("className: 'px-3")
  })

  test('gives every chart renderer one geometry vocabulary', () => {
    const cartesian = read('charts/CartesianChart.tsx')
    const pie = read('charts/PieChart.tsx')

    expect(cartesian).toContain("from './geometry'")
    expect(pie).toContain("from './geometry'")

    // Same role, same number: the legend swatch and its label gap must not be
    //9/4 in the cartesian chart and 10/8 in the pie chart.
    expect(LEGEND_SWATCH).toBe(10)
    expect(LEGEND_LABEL_GAP).toBe(8)
    expect(LEGEND_SWATCH_RADIUS).toBe(2)
    expect(cartesian).toContain('width={LEGEND_SWATCH}')
    expect(cartesian).toContain('height={LEGEND_SWATCH}')
    expect(cartesian).toContain('rx={LEGEND_SWATCH_RADIUS}')
    expect(cartesian).toContain('x={LEGEND_SWATCH + LEGEND_LABEL_GAP}')
    // `size-2.5` is the pie legend's 10px swatch; `gap-2` its 8px label gap.
    expect(pie).toContain('size-2.5')
    expect(pie).toContain('gap-2 ')

    // Both cartesian axes share one tick size and one label gap.
    expect(AXIS_LABEL_BASELINE).toBe(AXIS_LABEL_GAP + 6)
    expect(cartesian).toContain('x={-AXIS_LABEL_GAP}')
    expect(cartesian.match(/y=\{plotH \+ AXIS_LABEL_BASELINE\}/g) ?? []).toHaveLength(2)
    expect(cartesian.match(/fontSize=\{AXIS_TICK_FONT\}/g) ?? []).toHaveLength(4)
    expect(AXIS_TICK_FONT).toBe(10)
    expect(cartesian).not.toMatch(/fontSize=\{\d/)
  })

  test('measures the pie against the frame it actually renders', () => {
    const pie = read('charts/PieChart.tsx')
    // The container is `p-3` + `gap-4`; subtracting a flat 16 clipped the pie
    // in a short panel because the vertical padding alone is 24.
    expect(CHART_FRAME_INSET).toBe(12)
    expect(CHART_LEGEND_GAP).toBe(16)
    expect(pie).toContain('p-3')
    expect(pie).toContain('gap-4')
    expect(pie).toContain('height - CHART_FRAME_INSET * 2')
    expect(pie).toContain('width - CHART_FRAME_INSET * 2 - CHART_LEGEND_GAP')
    expect(pie).not.toContain('height - 16')
  })

  test('shares the frame inset between chart kinds, on all four edges', () => {
    const cartesian = read('charts/CartesianChart.tsx')
    expect(cartesian).toContain('top: CHART_FRAME_INSET')
    expect(cartesian).toContain('right: CHART_FRAME_INSET')
    // The legend row is the bottom edge of the frame; it used to sit at a
    // hand-picked `height - 8`, nearer the edge than any other mark.
    expect(cartesian).toContain('y={height - CHART_FRAME_INSET}')
    expect(cartesian).not.toContain('y={height - 8}')
  })

  test('centres the legend swatch on the label instead of on the axis gap', () => {
    // A vertical offset must not be spelled with a horizontal constant that
    // merely happens to hold the same number.
    expect(LEGEND_SWATCH_Y).toBe(-(LEGEND_SWATCH + LABEL_CAP_HEIGHT) / 2)
    expect(AXIS_LABEL_BASELINE).toBe(AXIS_LABEL_GAP + LABEL_CAP_HEIGHT)
    const cartesian = read('charts/CartesianChart.tsx')
    expect(cartesian).toContain('y={LEGEND_SWATCH_Y}')
    expect(cartesian).not.toContain('y={-AXIS_LABEL_GAP}')
  })

  test('gives a distribution row the same box whether or not it drills down', () => {
    const source = read('stats-charts.tsx')
    // `isSelectable` can make some rows buttons and leave others plain; only
    // the button used to carry the padded box, so a mixed list stepped between
    // a 24px and a 20px row.
    expect(source).toContain(
      "const ROW_BOX = 'group/row -mx-1 flex items-center gap-3 px-1 py-0.5'",
    )
    expect(source.match(/ROW_BOX/g) ?? []).toHaveLength(3)
    expect(source).not.toContain('className="group/row flex items-center gap-3"')
  })

  test('lets a measured chart shrink inside a flex parent', () => {
    // Without min-*-0 the SVG's intrinsic size is a floor, and consumers have
    // to wrap ChartView in their own clamp to get it to give width back.
    const view = read('charts/ChartView.tsx')
    expect(view).toContain('min-h-0')
    expect(view).toContain('min-w-0')
    expect(view).toContain('overflow-hidden')
  })

  test('keeps hand-drawn stats charts on the spacing scale', () => {
    const source = read('stats-charts.tsx')
    // Arbitrary spacing values (`gap-[3px]`) are a second scale by another name.
    expect(source).not.toMatch(/\b(?:gap|p|px|py|m|mx|my|mt|mb)-\[/)
  })

  test('draws the drag ghost exactly one control tall', () => {
    const source = read('drag-image.ts')
    // 12px/1.5 line box (18) + 2×4 padding + 2×1 border = 28 = --chrome-control-md.
    expect(source).toContain('padding:4px 10px')
    expect(source).toContain('--chrome-control-md')
    expect(source).toContain('12px/1.5')
  })
})
