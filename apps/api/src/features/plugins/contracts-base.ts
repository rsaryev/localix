/**
 * Shared primitives for the plugin wire contracts — OWNED by
 * `@localixai/plugin-sdk` (`/manifest`), re-exported here so the per-concern
 * contract modules (config / contributions / commands / agents) keep their
 * historical import path without forming a cycle through the manifest barrel.
 */
export {
  PLUGIN_API_VERSION,
  PLUGIN_NAME_RE,
  PLUGIN_QUALIFIED_NAME_RE,
  PLUGIN_SURFACE_AGENT,
  PLUGIN_SURFACE_WORKBENCH,
  PLUGIN_FILE_ASSOCIATION_RANKS,
  PLUGIN_FILE_ASSOCIATION_ROLES,
  isWorkbenchPlugin,
  normalizeFileAssociationExt,
  normalizePluginSurfaces,
  pluginFileAssociationSchema,
  pluginManifestCoreSchema,
} from '@localixai/plugin-sdk/manifest'
export type {
  PluginFileAssociation,
  PluginFileAssociationInput,
  PluginManifestCore,
  PluginManifestCoreInput,
} from '@localixai/plugin-sdk/manifest'
