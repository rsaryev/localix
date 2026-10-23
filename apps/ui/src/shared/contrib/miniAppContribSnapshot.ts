import type {
  CapabilitySnapshot,
  CapabilityToolSurface,
  MiniAppRecord,
  MiniAppViewSpec,
} from '@/shared/api/contracts'

export interface MiniAppContribSnapshot {
  /**
   * The server document this store was built from, verbatim — the ONE answer every
   * capability surface reads. Kept whole (rather than only the fields the workbench
   * gates on) so a second surface asking for this scope's agents, MCP servers,
   * skills or themes reads them from here instead of fetching a second document.
   * `null` before the first complete response, or for a frame restored from the
   * previous launch, which stores only the gating fields.
   */
  document: CapabilitySnapshot | null
  /** Names of enabled mini apps, or null before the first fetch resolves. */
  enabledNames: Set<string> | null
  /** Installed mini app records, including disabled apps and apps with no UI views. */
  miniApps: MiniAppRecord[]
  /** Sandboxed views contributed by enabled mini apps — one rail button + tab each. */
  views: MiniAppViewSpec[]
  /**
   * The scope's tool surface + catalog, or null before the first fetch resolves.
   * Same document as `miniApps` above, so a tool cannot outlive its owning app's
   * enable state by one refresh cycle.
   */
  tools: CapabilityToolSurface | null
  /**
   * Server capability revision this store is converged to, or -1 when nothing has
   * loaded. `-1` rather than 0 because 0 is a real server revision ("no capability
   * mutation since boot") and must not read as "already up to date".
   */
  revision: number
}

export const EMPTY_SNAPSHOT: MiniAppContribSnapshot = {
  document: null,
  enabledNames: null,
  miniApps: [],
  views: [],
  tools: null,
  revision: -1,
}

export function sameEnabledNames(
  left: ReadonlySet<string> | null,
  right: ReadonlySet<string> | null,
): boolean {
  if (left === null || right === null) return left === right
  return left.size === right.size && [...right].every((name) => left.has(name))
}
