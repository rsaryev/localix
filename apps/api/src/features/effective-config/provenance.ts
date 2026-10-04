/**
 * WHERE each effective value came from — and the refusal to guess when a source could not be read.
 *
 * Split from the service because this is the report's only answer to the question it exists to
 * answer ("why isn't my setting applying"), and it has one rule that has to be applied identically
 * in two enums that do not match: a source that could not be read makes provenance UNKNOWABLE, not
 * `default`. Keeping the key loop and the permission scope side by side is what keeps them honest
 * about the same thing.
 */
import { classifyReload } from './reload'
import type { PermissionRule } from '../projects/contracts'
import type {
  ConfigProvenance,
  ConfigScope,
  PermissionSummaryEntry,
  ReloadClass,
} from './contracts'

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export interface ProvenanceInput {
  /** The resolved values — provenance is reported per top-level key of this object. */
  values: Record<string, unknown>
  /** The RAW persisted sources, exactly as loaded (never the resolved view). */
  userSettings: unknown
  projectSettings: unknown
  projectId: string | null
  /** Whether the corresponding read failed — see `./unread-inputs`. */
  projectUnread: boolean
  userUnread: boolean
}

export interface ProvenanceReport {
  provenance: Record<string, ConfigProvenance>
  reload: Record<string, ReloadClass>
  permissions: PermissionSummaryEntry[]
}

export function buildProvenance(input: ProvenanceInput): ProvenanceReport {
  const { values, projectId, projectUnread, userUnread } = input
  const userObj = asRecord(input.userSettings)
  const projObj = asRecord(input.projectSettings)
  const provenance: Record<string, ConfigProvenance> = {}
  const reload: Record<string, ReloadClass> = {}
  // A source that could not be read makes provenance UNKNOWABLE, not `default`: the
  // value shown is the fallback the resolver used, but whether it is the effective one
  // is exactly what the failed read hid. Saying `default` there answers the question
  // this screen exists to answer, wrongly. Project is checked first because it wins:
  // an unreadable project makes every key unknown, while an unreadable user file leaves
  // the keys the project DOES set still attributable.
  const set = (obj: Record<string, unknown>, key: string) =>
    obj[key] !== undefined && (!Array.isArray(obj[key]) || (obj[key] as unknown[]).length)
  for (const key of Object.keys(values)) {
    if (key === 'schemaVersion') continue
    let scope: ConfigScope
    let sourceId: string | undefined
    if (set(projObj, key)) {
      scope = 'project'
      sourceId = projectId ?? undefined
    } else if (projectUnread) {
      scope = 'unknown'
    } else if (set(userObj, key)) {
      scope = 'user'
    } else {
      scope = userUnread ? 'unknown' : 'default'
    }
    provenance[key] = sourceId ? { scope, sourceId } : { scope }
    reload[key] = classifyReload(key)
  }

  // Permission summary with scope.
  const projPerms = projObj.permissions as unknown[] | undefined
  const userPerms = userObj.permissions as unknown[] | undefined
  // Same rule as above, in the one enum that has no `unknown`: an unreadable source can
  // only be reported by NOT claiming a scope it did not establish.
  const permScope: 'default' | 'user' | 'project' | 'unknown' = projPerms?.length
    ? 'project'
    : projectUnread
      ? 'unknown'
      : userPerms?.length
        ? 'user'
        : userUnread
          ? 'unknown'
          : 'default'
  const permissions: PermissionSummaryEntry[] = (
    (values.permissions as PermissionRule[] | undefined) ?? []
  ).map((rule) => ({ ...rule, scope: permScope }))

  return { provenance, reload, permissions }
}
