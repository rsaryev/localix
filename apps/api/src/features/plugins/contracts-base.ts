/**
 * Shared primitives for the plugin wire contracts — OWNED by
 * `@localixai/mini-app-sdk` (`/manifest`), re-exported here so the per-concern
 * contract modules (config / contributions / commands / agents) keep their
 * historical import path without forming a cycle through the manifest barrel.
 */
export {
  PLUGIN_API_VERSION,
  PLUGIN_NAME_RE,
  PLUGIN_QUALIFIED_NAME_RE,
  PLUGIN_SURFACE_AGENT,
  PLUGIN_SURFACE_WORKBENCH,
  isWorkbenchPlugin,
  normalizePluginSurfaces,
  pluginManifestCoreSchema,
} from '@localixai/mini-app-sdk/manifest'
