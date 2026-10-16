import { z } from 'zod'

export const viewStateKindSchema = z.enum(['surface', 'draft'])
const stateKey = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/u)
export const viewStateAddressSchema = z.object({ kind: viewStateKindSchema, key: stateKey })
const base = { key: stateKey, expectedRevision: z.number().int().nonnegative() }
export const viewStateWriteSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...base,
      kind: z.literal('surface'),
      value: z
        .object({ sessionId: z.string().min(1).max(160).nullable() })
        .strict()
        .nullable(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('draft'),
      value: z
        .object({ text: z.string().max(32_000) })
        .strict()
        .nullable(),
    })
    .strict(),
])
export type ViewStateKind = z.infer<typeof viewStateKindSchema>
export type ViewStateAddress = z.infer<typeof viewStateAddressSchema>
export type ViewStateWrite = z.infer<typeof viewStateWriteSchema>
export interface ViewStateValues {
  surface: { sessionId: string | null }
  draft: { text: string }
}
export interface ViewStateSnapshot<K extends ViewStateKind = ViewStateKind> {
  kind: K
  key: string
  revision: number
  value: ViewStateValues[K] | null
  updatedAt: string | null
}
export interface ViewStateWriteResult<K extends ViewStateKind = ViewStateKind> {
  accepted: boolean
  state: ViewStateSnapshot<K>
}
