import type { ResumeDocument } from '../shared/schema'
import { draftSchema } from '../shared/draft-schema'

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const identified = (value: unknown): value is Array<Record<string, unknown> & { id: string }> =>
  Array.isArray(value) && value.every((item) => object(item) && typeof item.id === 'string')

/** Three-way merge by field and stable identity. Conflicting edits are never silently chosen. */
export function mergeDocuments(
  base: ResumeDocument,
  draft: ResumeDocument,
  remote: ResumeDocument,
): { document: ResumeDocument | null; conflicts: string[] } {
  const conflicts: string[] = []
  function merge(before: unknown, local: unknown, saved: unknown, path: string): unknown {
    if (equal(local, saved) || equal(before, saved)) return structuredClone(local)
    if (equal(before, local)) return structuredClone(saved)
    if (identified(before) && identified(local) && identified(saved)) {
      const common = before.map((item) => item.id)
      const localOrder = local.map((item) => item.id).filter((id) => common.includes(id))
      const savedOrder = saved.map((item) => item.id).filter((id) => common.includes(id))
      const beforeLocal = common.filter((id) => localOrder.includes(id))
      const beforeSaved = common.filter((id) => savedOrder.includes(id))
      const localMoved = !equal(localOrder, beforeLocal)
      const savedMoved = !equal(savedOrder, beforeSaved)
      if (localMoved && savedMoved && !equal(localOrder, savedOrder))
        conflicts.push(`${path}.order`)
      const order = [
        ...new Set([
          ...(localMoved ? local : saved).map((item) => item.id),
          ...local.map((item) => item.id),
          ...saved.map((item) => item.id),
        ]),
      ]
      return order
        .map((id) =>
          merge(
            before.find((item) => item.id === id),
            local.find((item) => item.id === id),
            saved.find((item) => item.id === id),
            `${path}[${id}]`,
          ),
        )
        .filter((item) => item !== undefined)
    }
    if (object(before) && object(local) && object(saved))
      return Object.fromEntries(
        [...new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(saved)])].map(
          (key) => [key, merge(before[key], local[key], saved[key], path ? `${path}.${key}` : key)],
        ),
      )
    conflicts.push(path)
    return local
  }
  const merged = merge(base, draft, remote, '')
  if (conflicts.length) return { document: null, conflicts }
  const parsed = draftSchema.safeParse(merged)
  return parsed.success
    ? { document: parsed.data, conflicts: [] }
    : { document: null, conflicts: parsed.error.issues.map((issue) => issue.path.join('.')) }
}
