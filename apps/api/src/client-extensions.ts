/**
 * The plugin and mini app half of the client barrel (`client.ts` re-exports it): their records,
 * the pure presentation helpers every surface shares, and the mini app store's shapes. Two
 * products that share nothing; they sit together here only because both are extensions.
 */

// The agnostic agent-vs-workbench split: a mini app DECLARES its surfaces in
// `mini-app.json`, every consumer (onboarding steps, settings grouping) reads the
// declaration through these pure helpers — no host-side plugin allowlist.
export {
  MINI_APP_SURFACE_AGENT,
  MINI_APP_SURFACE_WORKBENCH,
  normalizeMiniAppSurfaces,
  isWorkbenchMiniApp,
} from './features/mini-apps/contracts-base'
export {
  pluginCapabilityLabels,
  pluginIssueSummary,
  pluginOriginLabel,
} from './features/plugins/presentation'
export type { PluginIssueSummary } from './features/plugins/presentation'

export type {
  PluginRecord,
  PluginProvides,
  PluginConfigField,
  PluginConfigOption,
  PluginConfigType,
  PluginManifest,
  PluginCommand,
  MiniAppCommandArg,
  PluginCommandSpec,
  ListPluginCommandsResponse,
  PluginValidation,
  MarketplaceListing,
  ListPluginsResponse,
  SetPluginEnabledRequest,
  SetPluginConfigRequest,
  InstallPluginRequest,
  RemovePluginRequest,
} from './features/plugins/contracts'
export type {
  PluginUpdatesResponse,
  PluginUpdateJob,
  UpdateMarketplaceResponse,
} from './features/plugins/contracts-updates'

export type {
  MiniAppRecord,
  MiniAppConfigField,
  MiniAppCommandSpec,
  MiniAppContributions,
  MiniAppToolDescriptor,
  MiniAppUiDescriptor,
} from './features/mini-apps/contracts'
export type { MiniAppViewSpec } from './features/mini-apps/contracts-contributions'
export type {
  MiniAppCatalogEntryRecord,
  MiniAppCatalogPreviewRecord,
  MiniAppStoreEntryRecord,
  MiniAppStorePageRecord,
  MiniAppStoreResponse,
} from './features/mini-apps/contracts-store'
