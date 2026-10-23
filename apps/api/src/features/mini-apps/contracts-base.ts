/**
 * Shared primitives for the plugin wire contracts — OWNED by
 * `@localixai/mini-app-sdk` (`/manifest`), re-exported here so the per-concern
 * contract modules (config / contributions / commands / agents) keep their
 * historical import path without forming a cycle through the manifest barrel.
 */
export {
  MINI_APP_API_VERSION,
  PLUGIN_NAME_RE,
  PLUGIN_QUALIFIED_NAME_RE,
  MINI_APP_SURFACE_AGENT,
  MINI_APP_SURFACE_WORKBENCH,
  isWorkbenchMiniApp,
  normalizeMiniAppSurfaces,
  miniAppManifestCoreSchema,
} from '@localixai/mini-app-sdk/manifest'
