import { z } from 'zod'
import type { ElementTypeSpec } from '../registry/contract'

const props = z.object({
  source: z
    .string()
    .max(64 * 1024)
    .default('flowchart LR\nA[Start] --> B[Finish]'),
  title: z.string().default(''),
})

export const mermaidType: ElementTypeSpec<z.infer<typeof props>> = {
  type: 'mermaid',
  version: 1,
  label: 'Mermaid diagram',
  description:
    'A live Mermaid diagram, rendered from its editable source (all supported Mermaid grammars). props: source, title. Change source to redraw it; text also sets source. Read by ids to get its full definition. For a flowchart prefer a native `flow` element, which the board lays out and styles; use this for other grammars (class, state, ER, gantt, pie…) or a flowchart the native reader refuses.',
  props,
  size: { w: 560, h: 320 },
  minSize: { w: 160, h: 100 },
  textProp: 'source',
  text: (value) => [value.title, value.source].filter(Boolean).join('\n'),
}
