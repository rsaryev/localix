import { z } from 'zod'
import { colorSchema } from '../format/schema'
import type { ElementTypeSpec } from '../registry/contract'

/**
 * A NATIVE 2×2 matrix: items placed by two judgements (impact and effort, reach and confidence),
 * the four quarters named. Drawn by Mermaid it is a picture; here an item is dragged to where the
 * room now thinks it belongs, and its numbers follow.
 *
 * Written and read as Mermaid's `quadrantChart` (`text`/`fromText`): `quadrant-1` is the top
 * right, counting anticlockwise, as Mermaid has it. An item marked `:::focal` is drawn in the
 * element's colour — the one or two the matrix is about.
 */
const point = z.object({
  label: z.string().trim().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  focal: z.boolean().optional(),
})
const axis = z.object({ low: z.string().default(''), high: z.string().default('') })

const quadrantProps = z.object({
  title: z.string().default(''),
  color: colorSchema.default('orange'),
  xAxis: axis.default({ low: 'Low effort', high: 'High effort' }),
  yAxis: axis.default({ low: 'Low impact', high: 'High impact' }),
  /** Top right, top left, bottom left, bottom right — Mermaid's quadrant-1 to quadrant-4. */
  quadrants: z
    .tuple([z.string(), z.string(), z.string(), z.string()])
    .default(['Major projects', 'Quick wins', 'Fill-ins', 'Thankless tasks']),
  points: z.array(point).max(60).default([]),
})
export type QuadrantProps = z.infer<typeof quadrantProps>
export type QuadrantContent = Omit<QuadrantProps, 'color'>

const round = (value: number) => Math.round(value * 100) / 100
const clean = (text: string) => text.replace(/[\n:[\]]/gu, ' ').trim()

export function writeQuadrant(content: QuadrantContent): string {
  const lines = ['quadrantChart']
  if (content.title) lines.push(`  title ${clean(content.title)}`)
  lines.push(`  x-axis ${clean(content.xAxis.low)} --> ${clean(content.xAxis.high)}`)
  lines.push(`  y-axis ${clean(content.yAxis.low)} --> ${clean(content.yAxis.high)}`)
  content.quadrants.forEach((name, index) => lines.push(`  quadrant-${index + 1} ${clean(name)}`))
  for (const item of content.points)
    lines.push(
      `  ${clean(item.label)}${item.focal ? ':::focal' : ''}: [${round(item.x)}, ${round(item.y)}]`,
    )
  return lines.join('\n')
}

const AXIS = /^([xy])-axis\s+(.*?)(?:\s*-->\s*(.*))?$/u
const QUADRANT = /^quadrant-([1-4])\s+(.+)$/u
const POINT = /^(.+?)(?::::([\w-]+))?\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]\s*$/u

export function readQuadrant(text: string): QuadrantContent | string {
  const lines = text
    .replace(/^```\w*\n?|```\s*$/gu, '')
    .split('\n')
    .map((line) => line.replace(/%%.*$/u, '').trim())
    .filter(Boolean)
  if (!/^quadrantChart\b/u.test(lines[0] ?? '')) return 'a 2×2 matrix starts with "quadrantChart"'
  const content: QuadrantContent = {
    title: '',
    xAxis: { low: '', high: '' },
    yAxis: { low: '', high: '' },
    quadrants: ['', '', '', ''],
    points: [],
  }
  for (const [index, line] of lines.slice(1).entries()) {
    let match: RegExpExecArray | null
    if (line.startsWith('title ')) content.title = line.slice(6).trim()
    else if ((match = AXIS.exec(line)))
      content[match[1] === 'x' ? 'xAxis' : 'yAxis'] = {
        low: match[2]!.trim(),
        high: (match[3] ?? '').trim(),
      }
    else if ((match = QUADRANT.exec(line)))
      content.quadrants[Number(match[1]) - 1] = match[2]!.trim()
    else if ((match = POINT.exec(line))) {
      const x = Number(match[3])
      const y = Number(match[4])
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return `line ${index + 2}: a point lies in 0…1`
      content.points.push({
        label: match[1]!.trim(),
        x,
        y,
        ...(match[2] === 'focal' ? { focal: true } : {}),
      })
    } else if (!/^classDef\b|^style\b/u.test(line))
      return `line ${index + 2}: "${line}" is not a quadrantChart statement`
  }
  return content
}

export const isQuadrantText = (text: string) =>
  /^quadrantChart\b/u.test(text.replace(/^```\w*\n?/u, '').trimStart())

export const quadrantType: ElementTypeSpec<QuadrantProps> = {
  type: 'quadrant',
  version: 1,
  label: '2×2 matrix',
  description:
    'A native 2×2 matrix (impact vs effort, reach vs confidence) whose items a person can drag. Easiest: pass `text` as Mermaid — "quadrantChart", "x-axis Low effort --> High effort", "y-axis Low impact --> High impact", "quadrant-1 Major projects" (top right; 2 top left, 3 bottom left, 4 bottom right), then one item per line "Offline mode: [0.3, 0.8]" with x and y in 0…1; mark the one or two that matter "Offline mode:::focal: [0.3, 0.8]". props.color tints focal items.',
  props: quadrantProps,
  size: { w: 520, h: 460 },
  minSize: { w: 320, h: 300 },
  text: (props) => writeQuadrant(props),
  summary: (props) =>
    [props.title || '2×2 matrix', props.points.map((item) => item.label).join(', ')]
      .filter(Boolean)
      .join(': '),
  fromText: (text) => readQuadrant(text) as ReturnType<NonNullable<ElementTypeSpec['fromText']>>,
  claimsText: (text) => isQuadrantText(text) && typeof readQuadrant(text) !== 'string',
  exactText: true,
}
