import { operationsSchema, type ResumeOperation } from '../shared/operations'
import type { ResumeDocument } from '../shared/schema'

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function changed<T extends object>(before: T, after: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(after).filter(([key, value]) => !equal(before[key as keyof T], value)),
  ) as Partial<T>
}
function reorder(
  current: string[],
  wanted: string[],
  make: (id: string, index: number) => ResumeOperation,
  ops: ResumeOperation[],
) {
  wanted.forEach((id, index) => {
    const oldIndex = current.indexOf(id)
    if (oldIndex !== index) {
      ops.push(make(id, index))
      current.splice(oldIndex, 1)
      current.splice(index, 0, id)
    }
  })
}

/** Translate a local draft into explicit field deltas; never send an old whole document. */
export function documentOperations(
  before: ResumeDocument,
  after: ResumeDocument,
): ResumeOperation[] {
  const ops: ResumeOperation[] = []
  const header = changed(before.header, after.header)
  if (Object.keys(header).length) ops.push({ op: 'header', value: header })
  const metadata = changed(
    { title: before.title, targetRole: before.targetRole, jobDescription: before.jobDescription },
    { title: after.title, targetRole: after.targetRole, jobDescription: after.jobDescription },
  )
  if (Object.keys(metadata).length) ops.push({ op: 'metadata', value: metadata })
  if (!equal(before.presentation, after.presentation))
    ops.push({ op: 'presentation', value: after.presentation })
  for (const section of before.sections)
    if (!after.sections.some((item) => item.id === section.id))
      ops.push({ op: 'removeSection', sectionId: section.id })
  const sectionOrder = before.sections
    .filter((section) => after.sections.some((item) => item.id === section.id))
    .map((section) => section.id)
  for (const section of after.sections) {
    const old = before.sections.find((item) => item.id === section.id)
    if (!old) {
      ops.push({ op: 'addSection', section })
      sectionOrder.push(section.id)
      continue
    }
    const value = changed(
      {
        title: old.title,
        hidden: old.hidden,
        columns: old.columns,
        showProficiency: old.showProficiency,
        variant: old.variant,
      },
      {
        title: section.title,
        hidden: section.hidden,
        columns: section.columns,
        showProficiency: section.showProficiency,
        variant: section.variant,
      },
    )
    if (Object.keys(value).length) ops.push({ op: 'updateSection', sectionId: section.id, value })
    for (const entry of old.entries)
      if (!section.entries.some((item) => item.id === entry.id))
        ops.push({ op: 'removeEntry', sectionId: section.id, entryId: entry.id })
    const entryOrder = old.entries
      .filter((entry) => section.entries.some((item) => item.id === entry.id))
      .map((entry) => entry.id)
    for (const entry of section.entries) {
      const previous = old.entries.find((item) => item.id === entry.id)
      if (!previous) {
        ops.push({ op: 'addEntry', sectionId: section.id, entry })
        entryOrder.push(entry.id)
      } else {
        const { id: _id, ...fields } = changed(previous, entry)
        if (Object.keys(fields).length)
          ops.push({ op: 'updateEntry', sectionId: section.id, entryId: entry.id, value: fields })
      }
    }
    reorder(
      entryOrder,
      section.entries.map((entry) => entry.id),
      (entryId, index) => ({ op: 'moveEntry', sectionId: section.id, entryId, index }),
      ops,
    )
  }
  reorder(
    sectionOrder,
    after.sections.map((section) => section.id),
    (sectionId, index) => ({ op: 'moveSection', sectionId, index }),
    ops,
  )
  return ops.length ? operationsSchema.parse(ops) : []
}
