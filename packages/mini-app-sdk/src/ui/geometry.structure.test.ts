import { describe, expect, test } from 'bun:test'

import {
  AXIS_LABEL_BASELINE,
  AXIS_LABEL_GAP,
  LABEL_CAP_HEIGHT,
  LEGEND_SWATCH,
  LEGEND_SWATCH_Y,
} from './charts/geometry'

describe('chart geometry', () => {
  test('centres the legend swatch on the label instead of on the axis gap', () => {
    // A vertical offset must not be spelled with a horizontal constant that
    // merely happens to hold the same number.
    expect(LEGEND_SWATCH_Y).toBe(-(LEGEND_SWATCH + LABEL_CAP_HEIGHT) / 2)
    expect(AXIS_LABEL_BASELINE).toBe(AXIS_LABEL_GAP + LABEL_CAP_HEIGHT)
  })
})
