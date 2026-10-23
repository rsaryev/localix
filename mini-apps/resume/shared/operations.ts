import { z } from 'zod'
import {
  documentSchema,
  entryFieldsSchema,
  entrySchema,
  headerSchema,
  idSchema,
  presentationSchema,
  sectionSchema,
  type ResumeDocument,
} from './schema'

/** The document's title, target role and job description — the same edit for the editor and the agent. */
export const metadataOperationSchema = z.strictObject({
  op: z.literal('metadata'),
  value: z.strictObject({
    title: z.string().trim().min(1).max(500).optional(),
    targetRole: z.string().max(500).optional(),
    jobDescription: z.string().max(16_000).optional(),
  }),
})

export const operationSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('header'), value: headerSchema.partial() }),
  metadataOperationSchema,
  z.strictObject({ op: z.literal('presentation'), value: presentationSchema }),
  z.strictObject({ op: z.literal('addSection'), section: sectionSchema }),
  z.strictObject({
    op: z.literal('updateSection'),
    sectionId: idSchema,
    value: sectionSchema.omit({ id: true, type: true, entries: true }).partial(),
  }),
  z.strictObject({ op: z.literal('removeSection'), sectionId: idSchema }),
  z.strictObject({
    op: z.literal('moveSection'),
    sectionId: idSchema,
    index: z.number().int().min(0),
  }),
  z.strictObject({ op: z.literal('addEntry'), sectionId: idSchema, entry: entrySchema }),
  z.strictObject({
    op: z.literal('updateEntry'),
    sectionId: idSchema,
    entryId: idSchema,
    value: entryFieldsSchema.omit({ id: true }).partial(),
  }),
  z.strictObject({ op: z.literal('removeEntry'), sectionId: idSchema, entryId: idSchema }),
  z.strictObject({
    op: z.literal('moveEntry'),
    sectionId: idSchema,
    entryId: idSchema,
    index: z.number().int().min(0),
  }),
])
export const operationsSchema = z.array(operationSchema).min(1).max(50)
export type ResumeOperation = z.infer<typeof operationSchema>

function move<T>(items: T[], index: number, target: number) {
  if (target >= items.length) throw new Error('Position is outside the current list')
  const [item] = items.splice(index, 1)
  items.splice(target, 0, item!)
}

/** Applies one already-validated operation in place, without validating the result. */
export function applyOperation(next: ResumeDocument, operation: ResumeOperation): void {
  if (operation.op === 'header') {
    Object.assign(next.header, operation.value)
    return
  }
  if (operation.op === 'metadata') {
    Object.assign(next, operation.value)
    return
  }
  if (operation.op === 'presentation') {
    next.presentation = operation.value
    return
  }
  if (operation.op === 'addSection') {
    next.sections.push(operation.section)
    return
  }
  const sectionIndex = next.sections.findIndex((section) => section.id === operation.sectionId)
  const section = next.sections[sectionIndex]
  if (!section) throw new Error('Section not found; read the current resume before editing')
  if (operation.op === 'updateSection') {
    Object.assign(section, operation.value)
    return
  }
  if (operation.op === 'removeSection') {
    next.sections.splice(sectionIndex, 1)
    return
  }
  if (operation.op === 'moveSection') {
    move(next.sections, sectionIndex, operation.index)
    return
  }
  if (operation.op === 'addEntry') {
    section.entries.push(operation.entry)
    return
  }
  const entryIndex = section.entries.findIndex((entry) => entry.id === operation.entryId)
  const entry = section.entries[entryIndex]
  if (!entry) throw new Error('Entry not found; read the current resume before editing')
  if (operation.op === 'updateEntry') Object.assign(entry, operation.value)
  if (operation.op === 'removeEntry') section.entries.splice(entryIndex, 1)
  if (operation.op === 'moveEntry') move(section.entries, entryIndex, operation.index)
}

/** Pure, atomic edit batch; stable identifiers rather than array indices address content. */
export function applyOperations(
  document: ResumeDocument,
  input: ResumeOperation[],
): ResumeDocument {
  const operations = operationsSchema.parse(input)
  const next = structuredClone(document)
  for (const operation of operations) applyOperation(next, operation)
  return documentSchema.parse(next)
}
