import { z } from 'zod'

const finite = z.number().finite()
export const graphCameraSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inspect') }),
  z.object({ kind: z.literal('fit') }),
  z.object({ kind: z.literal('focus'), nodes: z.array(z.string()).min(1).max(30) }),
  z.object({ kind: z.literal('zoom'), zoom: finite.min(0.1).max(2.5) }),
  z.object({ kind: z.literal('pan'), x: finite.min(-5).max(5), y: finite.min(-5).max(5) }),
  z.object({
    kind: z.literal('area'),
    x: finite,
    y: finite,
    width: finite.positive(),
    height: finite.positive(),
  }),
])

/** Reported by the visible tab; graph nodes are derived from source, never editable board data. */
export const graphCameraReportSchema = z.object({
  revision: z.number().int().nonnegative(),
  scope: z.string().max(500),
  trail: z.array(z.string().max(500)).max(6),
  selected: z.string().max(500).nullable(),
  viewport: z.object({ x: finite, y: finite, zoom: finite.min(0.1).max(2.5) }),
  size: z.object({ width: finite.positive(), height: finite.positive() }),
  visible: z.array(z.string().max(500)).max(200),
  missing: z.array(z.string().max(500)).max(30).optional(),
})

export type GraphCameraReport = z.infer<typeof graphCameraReportSchema>
