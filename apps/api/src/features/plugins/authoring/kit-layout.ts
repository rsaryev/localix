/**
 * The PLUGIN KIT: everything the running app needs to scaffold, build and check a user plugin,
 * shipped beside the staged first-party plugins (`resources/plugin-kit` in a release, the dev
 * staging root in development).
 *
 * The defect it stops: `/plugin create` used to run a script from the Localix source checkout and
 * hand the agent that checkout's path, so an agent asked for a plugin edited the application's own
 * repository — and on an installed app, which has no checkout, the command could not work at all.
 * A user plugin is not part of the app. It is authored in `~/.localix/plugins/<name>` and the app
 * builds it with inputs it carries itself: the reference template, the export names of the modules
 * the host shares with plugin UI, the host theme's stylesheets, and prebuilt copies of the modules
 * a plugin backend may import. Staging (`scripts/stage-plugin-kit.mjs`) writes the kit; the API
 * reads it. This module is the one description of its layout both sides use.
 */

/** The kit's directory name, a sibling of the staged plugins root. */
export const PLUGIN_KIT_DIR_NAME = 'plugin-kit'
/** The kit's self-description (see {@link PluginKitManifest}). */
export const PLUGIN_KIT_MANIFEST = 'kit.json'
export const PLUGIN_KIT_SCHEMA_VERSION = 1
/** The reference plugin every scaffold forks. */
export const PLUGIN_KIT_TEMPLATE_DIR = 'template'
/** The template's own description of its layout (entry, domain, renames). */
export const TEMPLATE_SCAFFOLD_FILE = 'scaffold.json'
/** The host theme's stylesheets, imports rewritten to kit-relative paths. */
export const PLUGIN_KIT_STYLES_DIR = 'ui/styles'
/** Tailwind's utilities layer inside {@link PLUGIN_KIT_STYLES_DIR}: what a plugin emits. */
export const TAILWIND_UTILITIES = 'tailwindcss/utilities.css'
/** Prebuilt backend shared modules (one split build, so they share one zod). */
export const PLUGIN_KIT_BACKEND_DIR = 'backend'
/** `bun <runner> <pluginDir>` type-checks a user plugin; prints one JSON diagnostic per line. */
export const PLUGIN_KIT_TYPECHECK = 'typescript/check.mjs'
/** `bun test --preload` for a user plugin: serves the shared modules to its tests. */
export const PLUGIN_KIT_TEST_PRELOAD = 'backend/test-preload.mjs'
/** Packages a user plugin's UI bundles from the kit (their ES module trees, source maps dropped). */
export const PLUGIN_KIT_UI_VENDOR_DIR = 'ui/vendor'
/**
 * The kit catalog as Markdown — which module for which job — rendered at staging from
 * `@localixai/kit/catalog`. Every build copies it into the plugin under the same name, beside the
 * generated `tsconfig.json`, so the agent reads it from its own folder.
 */
export const PLUGIN_KIT_CATALOG = 'KIT.md'

/**
 * Packages a user plugin's UI may import that are NOT host-shared: the build bundles them from the
 * kit's copy. Icons are the case — a shared instance would drag every icon into each import, while
 * the package's per-icon modules let the bundler keep only the ones a plugin uses (one icon: ~5 KB
 * against ~740 KB for a single prebundled file).
 */
export const PLUGIN_UI_VENDOR_PACKAGES: readonly string[] = ['lucide-react']

/**
 * Backend shared modules a plugin's UI bundles too, from the same prebuilt copy: the contracts in
 * `shared/` are zod schemas both halves import, and a user plugin has no other zod to resolve.
 */
export const PLUGIN_UI_PREBUILT_MODULES: readonly string[] = ['zod']

/**
 * The modules the HOST hands every plugin backend at runtime, instead of each bundle carrying its
 * own copy (`features/plugins/backend-host-modules.ts` serves them; staging and the user-plugin
 * build leave them external).
 *
 * The defect: every first-party backend bundled its own zod, hono and SDK — 18 copies of zod, and
 * a 476 KB bundle for a game whose own code is 14 KB. Importing the 20 backends cost ~104 MB of RSS
 * against ~46 MB with one shared copy, measured on the staged bundles. One copy also means one
 * class identity: a plugin's `ZodObject` IS the host's. These are the exact specifiers first-party
 * backends import (measured from their build graphs); a specifier the host does not list is
 * bundled as before.
 */
export const PLUGIN_BACKEND_HOST_MODULES = [
  'hono',
  'zod',
  '@localixai/plugin-sdk/backend',
  '@localixai/plugin-sdk/navigation',
  '@localixai/plugin-sdk/resource-refs',
  '@localixai/plugin-sdk/session-resource',
  '@localixai/plugin-sdk/typed-error',
  '@localixai/plugin-sdk/prerequisite',
] as const

export type PluginBackendHostModule = (typeof PLUGIN_BACKEND_HOST_MODULES)[number]

/**
 * Bare modules a USER plugin backend may import. They are not installed beside the plugin — a user
 * plugin has no `node_modules` — so the host provides each at runtime (every one is in
 * {@link PLUGIN_BACKEND_HOST_MODULES}). Anything else bare is a build error that names this list;
 * `node:*` and `bun:*` are the runtime's own.
 */
export const PLUGIN_BACKEND_SHARED_MODULES: readonly string[] = [
  'hono',
  'zod',
  '@localixai/plugin-sdk/backend',
]

/**
 * What a user plugin's TESTS may import besides {@link PLUGIN_BACKEND_SHARED_MODULES}: a test of
 * shared logic reaches the SDK's UI helpers (a message-context builder) without rendering anything.
 * Rendering tests need the host's DOM harness, which only the in-repo plugins have.
 */
export const PLUGIN_TEST_EXTRA_MODULES: readonly string[] = [
  '@localixai/plugin-sdk/ui',
  'react',
  'react/jsx-runtime',
]

/**
 * The kit exports a plugin UI is built from, as `<kit id>:<export>` — the digest the agent's
 * instruction carries lists exactly these, with their props. Everything else in the kit is still
 * importable and typed; these are the controls a copy should reach for before writing its own.
 */
export const PLUGIN_KIT_DIGEST: readonly string[] = [
  'button:Button',
  'icon-button:IconButton',
  'input:Input',
  'textarea:Textarea',
  'select:Select',
  'switch:Switch',
  'checkbox:Checkbox',
  'toggle-pill:TogglePill',
  'tabs:TabBar',
  'stat:StatCard',
  'progress-bar:ProgressBar',
  'chip:Chip',
  'spinner:Spinner',
  'empty-hint:EmptyHint',
  'state-notice:StateNotice',
  'confirm-dialog:ConfirmDialog',
]

/** Where a user plugin's backend source starts. */
export const USER_PLUGIN_BACKEND_SOURCE = 'backend/index.ts'
/**
 * Where the host writes its builds: one content-named file per build (`index-<hash>.mjs`), and
 * `plugin.json` `tools` is rewritten to name the current one. Never one fixed file — see
 * `backend-build.ts` for the restart that caused.
 */
export const USER_PLUGIN_BACKEND_DIR = 'dist/backend'
/** Whether a manifest `tools` value names a host build of the backend. */
export function isUserPluginBackendBuild(tools: unknown): boolean {
  // A shape check on the manifest string (one module file directly in the build directory), not a
  // containment decision: the loader resolves and confines `tools` itself.
  return typeof tools === 'string' && /^\.\/dist\/backend\/[^/\\]+\.mjs$/u.test(tools)
}

export interface PluginKitManifest {
  schemaVersion: typeof PLUGIN_KIT_SCHEMA_VERSION
  /** `@localixai/kit/<id>` ids, sorted. */
  kitModules: string[]
  /**
   * One line per core control — `<id>: <Export> { own props }` — read from the kit's real
   * declarations at staging, so the agent is told props that exist. Absent in a kit staged before
   * the declarations were real.
   */
  kitDigest?: string[]
  /** The kit-relative {@link PLUGIN_KIT_CATALOG}. Absent in a kit staged before the catalog. */
  kitCatalog?: string
  /** Every UI shared specifier → its value export names (the shims re-export exactly these). */
  uiSharedExports: Record<string, string[]>
  /** The stylesheet a plugin's utilities are compiled against, relative to the kit. */
  hostStylesheet: string
  /** Backend and test shared specifiers → the kit-relative prebuilt module. */
  backendModules: Record<string, string>
  /** {@link PLUGIN_UI_VENDOR_PACKAGES} → the kit-relative ES module entry. */
  uiVendorModules: Record<string, string>
  /** Every importable specifier → the kit-relative declaration file that types it. */
  typePaths: Record<string, string>
  /** The kit-relative TypeScript compiler module (pure JavaScript, every platform). */
  typescript: string
}

export function isPluginKitManifest(value: unknown): value is PluginKitManifest {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === PLUGIN_KIT_SCHEMA_VERSION &&
    Array.isArray(record.kitModules) &&
    typeof record.hostStylesheet === 'string' &&
    !!record.uiSharedExports &&
    typeof record.uiSharedExports === 'object' &&
    !!record.backendModules &&
    typeof record.backendModules === 'object' &&
    !!record.uiVendorModules &&
    typeof record.uiVendorModules === 'object' &&
    !!record.typePaths &&
    typeof record.typePaths === 'object' &&
    typeof record.typescript === 'string'
  )
}
