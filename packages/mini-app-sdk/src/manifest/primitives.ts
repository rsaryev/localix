export const MINI_APP_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i

/**
 * A namespaced command/agent name: one or more {@link MINI_APP_NAME_RE} segments joined
 * by `:`. Nested Claude Code `commands/`/`agents/` subdirectories map their path into
 * this form — `commands/foo/bar.md` → `foo:bar` (full id `<app>:foo:bar`). A plain
 * (non-nested) name is the single-segment case, so this is a strict superset of
 * `MINI_APP_NAME_RE`.
 */
export const MINI_APP_QUALIFIED_NAME_RE = /^[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)*$/i

/**
 * The mini app API contract version this host implements (the `register(ctx)` shape,
 * hook signatures, command/arg/config schemas). A manifest may declare `apiVersion`;
 * a higher major than this means the mini app needs a newer host and is flagged in
 * validation. Bump on any breaking change to the mini-app-facing contract.
 */
export const MINI_APP_API_VERSION = 1

/**
 * ── Mini app SURFACES ────────────────────────────────────────────────────────────
 * WHAT a mini app extends, declared by the mini app itself in `mini-app.json`
 * (`"surfaces": ["agent", "workbench"]`):
 *
 *   - `agent`     — it gives the AGENT capability: tools, skills, slash commands,
 *                   MCP servers, sub-agents, prompt sections. The default.
 *   - `workbench` — it extends the IDE itself: rail sections, WorkItem tabs,
 *                   editors, panels, resource providers (Database/Docker/K8s/…).
 *
 * A mini app may declare BOTH. The host NEVER hardcodes which mini app is which —
 * every consumer reads the declaration. The field is a free-form string array on
 * purpose: an unknown surface is carried through untouched rather than rejected,
 * so a future host can give it meaning without a manifest migration.
 */
export const MINI_APP_SURFACE_AGENT = 'agent'
export const MINI_APP_SURFACE_WORKBENCH = 'workbench'

/** Broad launcher groups. A mini app declares at most one primary category. */
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
 * absent/empty → `['agent']`, the default surface. Pure.
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
 * Does a mini app extend the IDE workbench? The single predicate every UI grouping
 * uses — a mini app that declares the `workbench` surface belongs to the
 * workspace-tools bucket even when it also carries agent tools; everything else
 * is an agent mini app.
 */
export function isWorkbenchMiniApp(surfaces?: readonly string[] | null): boolean {
  return normalizeMiniAppSurfaces(surfaces).includes(MINI_APP_SURFACE_WORKBENCH)
}

/** Store media limits a manifest is held to by its schema (`media.ts` checks the files). */
export const MINI_APP_SCREENSHOTS_MAX = 10
export const MINI_APP_TAGS_MAX = 8
/** A tag: lower-case words joined by dashes (`board-game`). */
export const MINI_APP_TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A path that stays inside the app's folder: relative, forward slashes, no `..` segment. */
export function isAppRelativePath(path: string): boolean {
  if (!path || path.includes('\\') || path.includes('\0') || path.startsWith('/')) return false
  if (/^[a-z]:/i.test(path)) return false
  return path
    .replace(/^\.\//, '')
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}
