import { z } from 'zod'
import { colorSchema } from '../format/schema'
import type { ElementTypeSpec } from '../registry/contract'
import { readMindmap, writeMindmap } from './mindmap-text'
import { layoutMindmap } from './mindmap-layout'

const props = z
  .object({
    color: colorSchema.default('blue'),
    nodes: z
      .array(
        z.object({
          id: z.string().regex(/^[A-Za-z][\w-]*$/u),
          text: z.string().min(1).max(2000),
          parent: z.string().min(1).optional(),
        }),
      )
      .min(1)
      .max(200)
      .default([
        { id: 'idea', text: 'Main idea' },
        { id: 'branch', text: 'Branch', parent: 'idea' },
      ]),
  })
  .superRefine((value, ctx) => {
    const ids = new Set(value.nodes.map((node) => node.id))
    const parents = new Map(value.nodes.map((node) => [node.id, node.parent]))
    if (
      ids.size !== value.nodes.length ||
      value.nodes.filter((node) => !node.parent).length !== 1
    ) {
      ctx.addIssue({ code: 'custom', message: 'Use unique node ids and exactly one root' })
      return
    }
    for (const node of value.nodes) {
      const seen = new Set<string>([node.id])
      let parent = node.parent
      while (parent) {
        if (!ids.has(parent) || seen.has(parent)) {
          ctx.addIssue({
            code: 'custom',
            message: 'A parent must exist and the tree must have no cycles',
          })
          break
        }
        seen.add(parent)
        parent = parents.get(parent)
      }
    }
  })
export type MindmapProps = z.infer<typeof props>
export const mindmapType: ElementTypeSpec<MindmapProps> = {
  type: 'mindmap',
  version: 1,
  label: 'Mind map',
  description:
    'A native tree of ideas. props: color, nodes [{id, text, parent?}]; exactly one root, no cycles. text accepts Mermaid mindmap with indentation and plain or labelled nodes. Layout and size follow the tree.',
  props: props as unknown as ElementTypeSpec<MindmapProps>['props'],
  size: { w: 420, h: 240 },
  minSize: { w: 260, h: 100 },
  text: writeMindmap,
  fromText: (text) => {
    const read = readMindmap(text)
    if (typeof read === 'string') return read
    const parsed = props.safeParse(read)
    return parsed.success ? read : parsed.error.issues[0]!.message
  },
  claimsText: (text) => /^\s*(?:```mermaid\s*\n)?mindmap\b/u.test(text),
  measure: (value) => {
    const layout = layoutMindmap(value.nodes)
    return { w: layout.width, h: layout.height + 32 }
  },
}
