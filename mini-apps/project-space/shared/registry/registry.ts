import type { ElementTypeSpec } from './contract'

/**
 * The element types this build knows, and the questions only the registry answers.
 *
 * An element's props are read through `read`, never taken from the file as they are: props
 * written at an older version are migrated one step at a time, then validated, so every reader
 * downstream sees the current shape with its defaults. What cannot be read is REPORTED, never
 * dropped — an unknown type, one a newer build wrote, props that fail their schema — so the board
 * keeps the element and shows it as it is, and a save writes it back unchanged.
 */
export type PropsRead =
  | { status: 'ok'; props: Record<string, unknown> }
  | { status: 'unknown' }
  | { status: 'newer'; version: number }
  | { status: 'invalid'; message: string }

export interface TypeRegistry {
  get(type: string): ElementTypeSpec | undefined
  all(): readonly ElementTypeSpec[]
  read(type: string, props: Record<string, unknown>, writtenVersion?: number): PropsRead
  /** The type that takes a path: the best extension claim, a folder claim, else the fallback. */
  claimPath(path: string, isFolder: boolean): ElementTypeSpec
  claimUrl(url: string): ElementTypeSpec | undefined
}

/** The type a path falls back to when no type claims its extension: a plain file reference. */
export const FALLBACK_PATH_TYPE = 'file'

export function createTypeRegistry(specs: readonly ElementTypeSpec[]): TypeRegistry {
  const byType = new Map<string, ElementTypeSpec>()
  for (const spec of specs) {
    if (byType.has(spec.type)) throw new Error(`element type "${spec.type}" registered twice`)
    if ((spec.migrations?.length ?? 0) !== spec.version - 1)
      throw new Error(`element type "${spec.type}" needs ${spec.version - 1} migrations`)
    byType.set(spec.type, spec)
  }
  const rank = (spec: ElementTypeSpec) => spec.claims?.rank ?? 0
  const best = (candidates: ElementTypeSpec[]) =>
    candidates.sort((a, b) => rank(b) - rank(a) || a.type.localeCompare(b.type))[0]

  return {
    get: (type) => byType.get(type),
    all: () => [...byType.values()],
    read(type, props, writtenVersion = 1) {
      const spec = byType.get(type)
      if (!spec) return { status: 'unknown' }
      if (writtenVersion > spec.version) return { status: 'newer', version: writtenVersion }
      let current = props
      for (let version = writtenVersion; version < spec.version; version++) {
        const migrate = spec.migrations?.[version - 1]
        if (migrate) current = migrate(current)
      }
      const parsed = spec.props.safeParse(current)
      if (parsed.success) return { status: 'ok', props: parsed.data as Record<string, unknown> }
      const issue = parsed.error.issues[0]
      const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
      return { status: 'invalid', message: `${where}${issue?.message ?? 'invalid props'}` }
    },
    claimPath(path, isFolder) {
      const specs = [...byType.values()]
      if (isFolder) {
        const folder = best(specs.filter((spec) => spec.claims?.folder))
        if (folder) return folder
      }
      const name = path.split('/').pop() ?? path
      const dot = name.lastIndexOf('.')
      const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
      const claimed = extension
        ? best(specs.filter((spec) => spec.claims?.extensions?.includes(extension)))
        : undefined
      const fallback = byType.get(FALLBACK_PATH_TYPE)
      if (claimed) return claimed
      if (!fallback) throw new Error(`no "${FALLBACK_PATH_TYPE}" type to reference a path with`)
      return fallback
    },
    claimUrl: (url) => best([...byType.values()].filter((spec) => spec.claims?.url && url)),
  }
}
