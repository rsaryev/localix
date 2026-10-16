import type {
  CapabilitySnapshot,
  CapabilityToolSurface,
  PluginViewSpec,
  PluginRecord,
} from '@/shared/api/contracts'

export interface PluginContribSnapshot {
  /**
   * The server document this store was built from, verbatim — the ONE answer every
   * capability surface reads. Kept whole (rather than only the fields the workbench
   * gates on) so a second surface asking for this scope's agents, MCP servers,
   * skills or themes reads them from here instead of fetching a second document.
   * `null` before the first complete response, or for a frame restored from the
   * previous launch, which stores only the gating fields.
   */
  document: CapabilitySnapshot | null
  /** Names of enabled plugins, or null before the first fetch resolves. */
  enabledNames: Set<string> | null
  /** Installed plugin records, including disabled plugins and plugins with no UI views. */
  plugins: PluginRecord[]
  /** Sandboxed views contributed by enabled plugins — one rail button + tab each. */
  views: PluginViewSpec[]
  /**
   * The scope's tool surface + catalog, or null before the first fetch resolves.
   * Same document as `plugins` above, so a tool cannot outlive its owning plugin's
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

export const EMPTY_SNAPSHOT: PluginContribSnapshot = {
  document: null,
  enabledNames: null,
  plugins: [],
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
