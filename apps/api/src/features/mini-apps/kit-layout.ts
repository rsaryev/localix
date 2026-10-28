/**
 * The MINI APP KIT: the platform a Localix release publishes for building mini apps — the reference
 * template, the export names of the modules the host shares with mini app UI, the host theme's
 * stylesheets, prebuilt copies of the modules a backend may import, the declarations, and the
 * `tools` module carrying Localix's own rules (`kit-tools.ts`). Localix builds no mini app: the
 * mini-app-authoring plugin reads the kit (`GET /rpc/mini-apps/kit`, or a release's
 * `mini-app-kit.tar.gz`) and builds against it. Staging (`scripts/stage-mini-app-kit.mjs`) writes
 * it; this module is the one description of its layout, and of the modules the host lends every
 * mini app backend at runtime.
 */

/** The kit's directory name, a sibling of the staged mini apps root. */
export const MINI_APP_KIT_DIR_NAME = 'mini-app-kit'
/** The kit's self-description (see {@link MiniAppKitManifest}). */
export const MINI_APP_KIT_MANIFEST = 'kit.json'
export const MINI_APP_KIT_SCHEMA_VERSION = 1
/** The reference mini app every scaffold forks. */
export const MINI_APP_KIT_TEMPLATE_DIR = 'template'
/** The template's own description of its layout (entry, domain, renames). */
export const TEMPLATE_SCAFFOLD_FILE = 'scaffold.json'
/** The host theme's stylesheets, imports rewritten to kit-relative paths. */
export const MINI_APP_KIT_STYLES_DIR = 'ui/styles'
/** Tailwind's utilities layer inside {@link MINI_APP_KIT_STYLES_DIR}: what a mini app emits. */
export const TAILWIND_UTILITIES = 'tailwindcss/utilities.css'
/** Prebuilt backend shared modules (one split build, so they share one zod). */
export const MINI_APP_KIT_BACKEND_DIR = 'backend'
/**
 * `bun <runner> <miniAppDir>` type-checks a user's mini app; prints one JSON diagnostic per line.
 */
export const MINI_APP_KIT_TYPECHECK = 'typescript/check.mjs'
/** `bun test --preload` for a user's mini app: serves the shared modules to its tests. */
export const MINI_APP_KIT_TEST_PRELOAD = 'backend/test-preload.mjs'
/** Packages a user's mini app's UI bundles from the kit (their ES module trees, source maps dropped). */
export const MINI_APP_KIT_UI_VENDOR_DIR = 'ui/vendor'
/**
 * The kit catalog as Markdown — which module for which job — rendered at staging from
 * `@localixai/kit/catalog`. The authoring plugin copies it into each mini app under the same name,
 * so the agent reads it from its own folder.
 */
export const MINI_APP_KIT_CATALOG = 'KIT.md'

/**
 * Packages a user's mini app's UI may import that are NOT host-shared: the build bundles them from the
 * kit's copy. Icons are the case — a shared instance would drag every icon into each import, while
 * the package's per-icon modules let the bundler keep only the ones a mini app uses (one icon: ~5
 * KB against ~740 KB for a single prebundled file).
 */
export const MINI_APP_UI_VENDOR_PACKAGES: readonly string[] = ['lucide-react', 'mediabunny']

/**
 * Backend shared modules a mini app's UI bundles too, from the same prebuilt copy: the contracts in
 * `shared/` are zod schemas both halves import, and a user's mini app has no other zod to resolve.
 */
export const MINI_APP_UI_PREBUILT_MODULES: readonly string[] = ['zod']

/**
 * The modules the HOST hands every mini app backend at runtime, instead of each bundle carrying its
 * own copy (`features/mini-apps/backend-host-modules.ts` serves them; staging and the user-mini-app
 * build leave them external).
 *
 * The defect: every first-party backend bundled its own zod, hono and SDK — 18 copies of zod, and
 * a 476 KB bundle for a game whose own code is 14 KB. Importing the 20 backends cost ~104 MB of RSS
 * against ~46 MB with one shared copy, measured on the staged bundles. One copy also means one
 * class identity: a mini app's `ZodObject` IS the host's. These are the exact specifiers
 * first-party backends import (measured from their build graphs); a specifier the host does not
 * list is bundled as before.
 */
export const MINI_APP_BACKEND_HOST_MODULES = [
  'hono',
  'zod',
  '@localixai/mini-app-sdk/backend',
  '@localixai/mini-app-sdk/navigation',
  '@localixai/mini-app-sdk/resource-refs',
  '@localixai/mini-app-sdk/session-resource',
  '@localixai/mini-app-sdk/typed-error',
  '@localixai/mini-app-sdk/prerequisite',
  '@localixai/mini-app-sdk/rich-text',
  '@localixai/mini-app-sdk/document-layout',
  '@localixai/mini-app-sdk/store-changes',
] as const

export type MiniAppBackendHostModule = (typeof MINI_APP_BACKEND_HOST_MODULES)[number]

/**
 * Bare modules a USER mini app backend may import. They are not installed beside the mini app — a
 * user mini app has no `node_modules` — so the host provides each at runtime (every one is in
 * {@link MINI_APP_BACKEND_HOST_MODULES}). Anything else bare is a build error that names this list;
 * `node:*` and `bun:*` are the runtime's own.
 */
export const MINI_APP_BACKEND_SHARED_MODULES: readonly string[] = [
  'hono',
  'zod',
  '@localixai/mini-app-sdk/backend',
  '@localixai/mini-app-sdk/rich-text',
  '@localixai/mini-app-sdk/document-layout',
  '@localixai/mini-app-sdk/store-changes',
]

/**
 * What a user's mini app's TESTS may import besides {@link MINI_APP_BACKEND_SHARED_MODULES}: a test of
 * shared logic reaches the SDK's UI helpers (a message-context builder) without rendering anything.
 * Rendering tests need the host's DOM harness, which only the in-repo mini apps have.
 */
export const MINI_APP_TEST_EXTRA_MODULES: readonly string[] = [
  '@localixai/mini-app-sdk/ui',
  'react',
  'react/jsx-runtime',
]

/**
 * The kit exports a mini app UI is built from, as `<kit id>:<export>` — the digest the agent's
 * instruction carries lists exactly these, with their props. Everything else in the kit is still
 * importable and typed; these are the controls a copy should reach for before writing its own.
 */
export const MINI_APP_KIT_DIGEST: readonly string[] = [
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
