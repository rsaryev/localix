import { z } from 'zod'
import { idSchema, presentationSchema, sectionTypes, type ResumeDocument } from '../shared/schema'
import { applyOperation, metadataOperationSchema, type ResumeOperation } from '../shared/operations'
import {
  entryInputSchema,
  headerInputSchema,
  normalizeEntry,
  normalizeHeader,
  normalizeSection,
  sectionInputSchema,
} from './authoring'

/** A section's UUID, or its type for the first section of that type (created by addEntry). */
const sectionRef = z.union([idSchema, z.enum(sectionTypes)])
const index = z.number().int().min(0)

export const authoringOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('header'), value: headerInputSchema }),
  metadataOperationSchema,
  z.strictObject({ op: z.literal('presentation'), value: presentationSchema.partial() }),
  z.strictObject({ op: z.literal('addSection'), section: sectionInputSchema }),
  z.strictObject({
    op: z.literal('updateSection'),
    sectionId: sectionRef,
    value: sectionInputSchema.omit({ id: true, type: true, entries: true }).partial(),
  }),
  z.strictObject({ op: z.literal('removeSection'), sectionId: sectionRef }),
  z.strictObject({ op: z.literal('moveSection'), sectionId: sectionRef, index }),
  z.strictObject({ op: z.literal('addEntry'), sectionId: sectionRef, entry: entryInputSchema }),
  z.strictObject({
    op: z.literal('updateEntry'),
    sectionId: sectionRef,
    entryId: idSchema,
    value: entryInputSchema.omit({ id: true }),
  }),
  z.strictObject({ op: z.literal('removeEntry'), sectionId: sectionRef, entryId: idSchema }),
  z.strictObject({ op: z.literal('moveEntry'), sectionId: sectionRef, entryId: idSchema, index }),
])
export const authoringOperationsSchema = z.array(authoringOperationSchema).min(1).max(50)
export type AuthoringOperation = z.infer<typeof authoringOperationSchema>

/**
 * Rewrites authored operations into stored ones against the current document, applying each to
 * a working copy so a later operation can address a section an earlier one added. Entry edits
 * are normalized after merging, so a field the section type does not take is folded or dropped
 * (and reported) instead of refusing the whole batch.
 */
export function resolveOperations(
  document: ResumeDocument,
  input: AuthoringOperation[],
  notes: string[],
): ResumeOperation[] {
  const working = structuredClone(document)
  const resolved: ResumeOperation[] = []
  const emit = (operation: ResumeOperation) => {
    applyOperation(working, structuredClone(operation))
    resolved.push(operation)
  }
  const findSection = (ref: string, where: string, create = false) => {
    const section = working.sections.find((item) => item.id === ref || item.type === ref)
    if (section) return section
    if (!create || idSchema.safeParse(ref).success)
      throw new Error(`${where}: section ${ref} not found; read the current resume before editing`)
    const added = normalizeSection({ type: ref as (typeof sectionTypes)[number] }, notes, where)
    emit({ op: 'addSection', section: added })
    notes.push(`${where}: added a ${ref} section`)
    return added
  }
  input.forEach((operation, position) => {
    const where = `operations[${position}]`
    if (operation.op === 'header')
      return emit({ op: 'header', value: normalizeHeader(operation.value) })
    if (operation.op === 'metadata') return emit(operation)
    if (operation.op === 'presentation')
      return emit({ op: 'presentation', value: { ...working.presentation, ...operation.value } })
    if (operation.op === 'addSection')
      return emit({
        op: 'addSection',
        section: normalizeSection(operation.section, notes, `${where}.section`),
      })
    const section = findSection(operation.sectionId, where, operation.op === 'addEntry')
    const sectionId = section.id
    if (operation.op === 'updateSection') return emit({ ...operation, sectionId })
    if (operation.op === 'removeSection' || operation.op === 'moveSection')
      return emit({ ...operation, sectionId })
    if (operation.op === 'addEntry')
      return emit({
        op: 'addEntry',
        sectionId,
        entry: normalizeEntry(
          section.type,
          operation.entry,
          notes,
          `${where}.entry`,
          section.variant,
        ),
      })
    if (operation.op === 'removeEntry' || operation.op === 'moveEntry')
      return emit({ ...operation, sectionId })
    const current = section.entries.find((entry) => entry.id === operation.entryId)
    if (!current)
      throw new Error(`${where}: entry ${operation.entryId} not found in ${section.type}`)
    const { id: _id, ...value } = normalizeEntry(
      section.type,
      { ...current, ...operation.value },
      notes,
      `${where}.value`,
      section.variant,
    )
    // Merging cannot delete an optional field, so a cleared one is written empty instead.
    for (const key of ['context', 'proficiency'] as const)
      if (current[key] && value[key] === undefined) value[key] = ''
    emit({ op: 'updateEntry', sectionId, entryId: operation.entryId, value })
  })
  return resolved
}
