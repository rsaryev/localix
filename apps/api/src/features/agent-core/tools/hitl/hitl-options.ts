import { z } from 'zod'

/** One selectable choice in an HITL prompt (ask/quiz) — shared schema + contract. */
export const hitlOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1).optional().describe('Returned when chosen (default: the label).'),
  description: z.string().optional(),
})

/** Resolve the value an HITL option returns when selected: explicit `value`, else its label. */
export function optionValue(option: { label: string; value?: string }): string {
  return option.value ?? option.label
}
