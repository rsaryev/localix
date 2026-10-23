/**
 * One geometry vocabulary for the SDK chart renderers.
 *
 * A dashboard mixes chart kinds — a cartesian panel beside a pie panel — and
 * they read as one system only if the shared roles (frame inset, legend swatch,
 * swatch-to-label gap, axis label gap) are the same number in every renderer
 * rather than a magic literal per file. Colors are not here on purpose: the
 * series palette lives in `scales.ts` and is settled.
 */

/** Breathing room between a chart's box and its marks; matches the pie frame's `p-3`. */
export const CHART_FRAME_INSET = 12

/** Gap between a chart's marks and its legend; matches the pie frame's `gap-4`. */
export const CHART_LEGEND_GAP = 16

/** Legend swatch edge, in px — the SVG twin of the pie legend's `size-2.5`. */
export const LEGEND_SWATCH = 10

/** Legend swatch corner radius, matching the pie legend's `rounded-sm`. */
export const LEGEND_SWATCH_RADIUS = 2

/** Swatch-to-label gap — the SVG twin of the pie legend row's `gap-2`. */
export const LEGEND_LABEL_GAP = 8

/** Horizontal breathing room between two legend entries. */
export const LEGEND_ENTRY_GAP = 12

/** Axis tick label size, shared by both axes and every cartesian mark type. */
export const AXIS_TICK_FONT = 10

/** Gap between the plot edge and an axis tick label, shared by both axes. */
export const AXIS_LABEL_GAP = 8

/** Cap height of a tick/legend label at `AXIS_TICK_FONT`; what "vertically centred on the text" means here. */
export const LABEL_CAP_HEIGHT = 6

/** Plot edge → tick-label baseline: the gap above plus the label's cap height. */
export const AXIS_LABEL_BASELINE = AXIS_LABEL_GAP + LABEL_CAP_HEIGHT

/**
 * Legend swatch top, relative to the label baseline at y=0.
 *
 * Centres the swatch on the label's cap box rather than borrowing the axis
 * label gap, which happened to be the same number and made a vertical offset
 * silently depend on a horizontal one.
 */
export const LEGEND_SWATCH_Y = -(LEGEND_SWATCH + LABEL_CAP_HEIGHT) / 2
