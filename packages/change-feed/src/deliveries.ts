import type { Cascades, EntityRegistry, RefSchemas } from './contracts'

/** One recorded notice, as the feed's table holds it. */
export type NoticeRow = { seq: number; entity: string; op: string; ref_json: string | null }

export type PlannedDelivery = { kind: string; delivery: Record<string, unknown> }

/**
 * What one row delivers: the change itself and, for a deletion, `parent-deleted` to each child kind
 * in the registry's cascades. A kind the registry does not know, or a ref its schema rejects,
 * delivers nothing. Throws only on a ref that is not JSON.
 */
export function plannedDeliveries<R extends RefSchemas, C extends Cascades<R>>(
  registry: EntityRegistry<R, C>,
  row: NoticeRow,
): PlannedDelivery[] {
  const schema = registry.refs[row.entity as keyof R]
  if (!schema) return []
  if (row.op === 'resync')
    return [{ kind: row.entity, delivery: { entity: row.entity, op: 'resync' } }]
  const parsed = schema.safeParse(row.ref_json ? JSON.parse(row.ref_json) : null)
  if (!parsed.success) return []
  const change = { entity: row.entity, op: row.op, ref: parsed.data }
  const out: PlannedDelivery[] = [{ kind: row.entity, delivery: change }]
  if (row.op === 'deleted') {
    const cascades = registry.cascades as Record<string, readonly string[] | undefined>
    for (const child of cascades[row.entity] ?? []) {
      out.push({ kind: child, delivery: { entity: child, op: 'parent-deleted', parent: change } })
    }
  }
  return out
}
