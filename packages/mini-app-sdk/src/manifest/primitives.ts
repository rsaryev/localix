export const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i

/**
 * A namespaced command/agent name: one or more {@link PLUGIN_NAME_RE} segments joined
 * by `:`. Nested Claude Code `commands/`/`agents/` subdirectories map their path into
 * this form — `commands/foo/bar.md` → `foo:bar` (full id `<plugin>:foo:bar`). A plain
 * (non-nested) name is the single-segment case, so this is a strict superset of
 * `PLUGIN_NAME_RE`.
 */
export const PLUGIN_QUALIFIED_NAME_RE = /^[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)*$/i

/**
 * The plugin API contract version this host implements (the `register(ctx)` shape,
 * hook signatures, command/arg/config schemas). A manifest may declare `apiVersion`;
 * a higher major than this means the plugin needs a newer host and is flagged in
 * validation. Bump on any breaking change to the plugin-facing contract.
 */
export const MINI_APP_API_VERSION = 1

/**
 * ── Plugin SURFACES ────────────────────────────────────────────────────────────
 * WHAT a plugin extends, declared by the plugin itself in `plugin.json`
 * (`"surfaces": ["agent", "workbench"]`):
 *
 *   - `agent`     — it gives the AGENT capability: tools, skills, slash commands,
 *                   MCP servers, sub-agents, prompt sections. The default.
 *   - `workbench` — it extends the IDE itself: rail sections, WorkItem tabs,
 *                   editors, panels, resource providers (Database/Docker/K8s/…).
 *
 * A plugin may declare BOTH. The host NEVER hardcodes which plugin is which —
 * every consumer reads the declaration. The field is a free-form string array on
 * purpose: an unknown surface is carried through untouched rather than rejected,
 * so a future host can give it meaning without a manifest migration.
 */
export const MINI_APP_SURFACE_AGENT = 'agent'
export const MINI_APP_SURFACE_WORKBENCH = 'workbench'

/** Broad launcher groups. A plugin declares one primary category; older manifests use Other. */
export const MINI_APP_CATEGORIES = ['development', 'data', 'content', 'utilities', 'games'] as const
export type MiniAppCategory = (typeof MINI_APP_CATEGORIES)[number]

/**
 * Supported declarative config-option types. `directory` and `file` are path-valued
 * strings at runtime, while allowing hosts to offer a path-oriented editor.
 */
export const MINI_APP_CONFIG_TYPES = ['string', 'number', 'boolean', 'directory', 'file'] as const
export type MiniAppConfigType = (typeof MINI_APP_CONFIG_TYPES)[number]

/**
 * Normalize a manifest's declared surfaces: trimmed, lower-cased, de-duped;
 * absent/empty → `['agent']` (the default surface, so every legacy manifest keeps
 * behaving as an agent plugin). Pure.
 */
export function normalizeMiniAppSurfaces(declared?: readonly string[] | null): string[] {
  const seen = new Set<string>()
  for (const s of declared ?? []) {
    const v = s.trim().toLowerCase()
    if (v) seen.add(v)
  }
  return seen.size > 0 ? [...seen] : [MINI_APP_SURFACE_AGENT]
}

/**
 * Does a plugin extend the IDE workbench? The single predicate every UI grouping
 * uses — a plugin that declares the `workbench` surface belongs to the
 * workspace-tools bucket even when it also carries agent tools; everything else
 * is an agent plugin.
 */
export function isWorkbenchMiniApp(surfaces?: readonly string[] | null): boolean {
  return normalizeMiniAppSurfaces(surfaces).includes(MINI_APP_SURFACE_WORKBENCH)
}
