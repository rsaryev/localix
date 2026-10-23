/**
 * The contract between a plugin's built UI ARTIFACT and the host that loads it.
 *
 * A plugin's workbench UI is not part of the host application: it is built into its own ES
 * module artifact, served by the API, imported by URL and replaced in place when it changes —
 * the same way in development and in a packaged app. Compiling plugin UI INTO the host (a glob
 * over the plugins tree) made every plugin edit an edit of the app, and the only way to show it
 * was to reload the whole page, mid-turn.
 *
 * An artifact bundles its own dependencies EXCEPT the shared modules below, which must be the
 * host's single instance: React (one renderer, one set of hooks), this SDK (its bindings,
 * command maps, stores and contexts are module state) and the host UI kit (its components read
 * host contexts). The build replaces each shared import with a module that awaits the host's
 * copy — so a shared module is loaded when the chunk that needs it loads, never before.
 */

/** Global the host installs before importing any artifact; see {@link MiniAppUiSharedModules}. */
export const MINI_APP_UI_SHARED_GLOBAL = '__LOCALIX_MINI_APP_UI_SHARED__'

/** What the host provides under {@link MINI_APP_UI_SHARED_GLOBAL}. */
export interface MiniAppUiSharedModules {
  /** Resolve a shared specifier to the host's module namespace; rejects for anything else. */
  load(specifier: string): Promise<Record<string, unknown>>
  /**
   * The same, synchronously, for {@link MINI_APP_UI_PRELOADED_MODULES} — which the host loads before
   * importing any artifact, so their shims need no top-level `await`. That matters: an older
   * CommonJS dependency `require`s React, and a `require` cannot reach a module that awaits.
   */
  require(specifier: string): Record<string, unknown>
}

/** Shared modules the host loads before any artifact, and which artifacts read synchronously. */
export const MINI_APP_UI_PRELOADED_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
]

/** The host UI kit: the host's explicit public component surface. */
export const MINI_APP_UI_KIT_PREFIX = '@localixai/kit/'

/**
 * Every specifier an artifact takes from the host instead of bundling it: React's and ReactDOM's
 * entries, any kit module but the test harness that shares its namespace (`@localixai/kit/testing*`,
 * never part of the runtime), and any SDK subpath but the backend entry, which never belongs in a
 * browser artifact.
 *
 * A pattern and not only a predicate, because the artifact build filters imports with it — and
 * that filter has to match exactly these: a bundler callback that matches an import it then
 * declines is not neutral (the plugin UI builder says why).
 */
export const MINI_APP_UI_SHARED_MODULE =
  /^(?:react(?:\/jsx-(?:dev-)?runtime)?|react-dom(?:\/client)?|@localixai\/kit\/(?!testing).+|@localixai\/mini-app-sdk\/(?!backend(?:\/|$)).+)$/u

/** Whether an artifact must take `specifier` from the host instead of bundling it. */
export function isMiniAppUiSharedModule(specifier: string): boolean {
  return MINI_APP_UI_SHARED_MODULE.test(specifier)
}

/** Where an artifact lives inside a plugin's installed copy. */
export const MINI_APP_UI_ARTIFACT_DIR = 'dist/ui'
/** The artifact's self-description, beside its files. */
export const MINI_APP_UI_ARTIFACT_MANIFEST = 'manifest.json'

/**
 * `dist/ui/manifest.json`. Paths are relative to the artifact directory. `revision` is a hash
 * of every artifact file, so it moves exactly when the UI changed — not when the plugin's
 * backend or docs did — and a host holding an older revision replaces that plugin, nothing else.
 */
export interface MiniAppUiArtifactManifest {
  entry: string
  styles: string[]
  revision: string
}

export function isMiniAppUiArtifactManifest(value: unknown): value is MiniAppUiArtifactManifest {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.entry === 'string' &&
    typeof record.revision === 'string' &&
    Array.isArray(record.styles) &&
    record.styles.every((style) => typeof style === 'string')
  )
}
