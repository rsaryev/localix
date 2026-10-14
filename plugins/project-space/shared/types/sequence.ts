import { z } from 'zod'
import { colorSchema } from '../format/schema'
import type { ElementTypeSpec } from '../registry/contract'
import { layoutSequence } from './sequence-layout'
import { isSequenceText, readSequence, writeSequence, type SequenceContent } from './sequence-text'

/**
 * A NATIVE sequence diagram: participants with lifelines, and messages between them in time
 * order. Built from boxes and connectors, a sequence has no lifelines and its return arrows fall
 * on top of its calls (the agent drew one that way and the six messages read as three lines);
 * here the rows keep every message apart and the arrow kind says call, async or return.
 *
 * It is written and read as Mermaid (`fromText`/`text`), sized by its content (`measure`), and a
 * pasted `sequenceDiagram` block becomes one (`claimsText`).
 */
const participant = z.object({
  id: z.string().trim().min(1),
  label: z.string().optional(),
  kind: z.enum(['participant', 'actor', 'database']).default('participant'),
})
const message = z.object({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  text: z.string().default(''),
  kind: z.enum(['sync', 'async', 'return']).default('sync'),
})

const sequenceProps = z
  .object({
    title: z.string().default(''),
    /** The accent of its heads, from the board's palette like a shape's. */
    color: colorSchema.default('blue'),
    participants: z.array(participant).default([]),
    messages: z.array(message).default([]),
  })
  .superRefine((props, context) => {
    const known = new Set(props.participants.map((entry) => entry.id))
    props.messages.forEach((entry, index) => {
      for (const end of ['from', 'to'] as const)
        if (!known.has(entry[end]))
          context.addIssue({
            code: 'custom',
            path: ['messages', index, end],
            message: `"${entry[end]}" is not a participant`,
          })
    })
  })

type SequenceProps = z.infer<typeof sequenceProps>

export const sequenceType: ElementTypeSpec<SequenceProps> = {
  type: 'sequence',
  version: 1,
  label: 'Sequence diagram',
  description:
    'A sequence diagram with lifelines. Easiest: pass `text` as Mermaid — "sequenceDiagram", "participant Web as Web UI", "actor User", "database DB", then "User->>Web: create" (call), "Web-)Queue: event" (async), "API-->>Web: 201" (return). Sized by its content. props.color tints its participants.',
  props: sequenceProps as unknown as ElementTypeSpec<SequenceProps>['props'],
  size: { w: 600, h: 300 },
  minSize: { w: 200, h: 120 },
  text: (props) => writeSequence(props as SequenceContent),
  fromText: (text) => readSequence(text) as ReturnType<NonNullable<ElementTypeSpec['fromText']>>,
  measure: (props) => {
    const layout = layoutSequence(props as SequenceContent)
    return { w: layout.width, h: layout.height }
  },
  claimsText: isSequenceText,
}
