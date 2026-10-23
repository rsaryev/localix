import { pluginOriginLabel } from '@localixai/api/plugin-presentation'
import { backendClient } from '@/shared/api/client'
import { miniAppContribSnapshot } from '@/shared/contrib/enabledMiniApps'
import type { SlashArgOption } from './SlashArgSpec'

/**
 * Live option lists for the BUILT-IN `/plugin` and `/mini-app` commands' arguments.
 *
 * Every value these args take already exists somewhere the client can see: the
 * installed set is in the capability snapshot the workbench holds, and each
 * marketplace listing carries its own plugin entries. Before this, the composer
 * offered one free-text slot reading `<src> · <name> · <owner/repo>` for all of
 * them, so picking an installed plugin meant recalling its exact spelling while
 * the app had the list on screen two panels away.
 *
 * Filtering happens HERE (the dynamic-arg contract is "the source already filtered
 * by the query"), and every list is a suggestion, not a gate — `parseCommandArgs`
 * commits any typed token for a dynamic arg, which is what keeps a git URL, an
 * `owner/repo` or a local path installable while the menu shows catalog entries.
 */

/** Match on value OR label, case-insensitively — the same rule `filterArgOptions` uses. */
function matches(option: SlashArgOption, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return option.value.toLowerCase().includes(q) || option.label.toLowerCase().includes(q)
}

/** A cap, not a target: a menu longer than this is scrolled past, not read. */
const MAX_OPTIONS = 40

type Only = 'enabled' | 'disabled' | 'any'

/** Offering an enabled one under `enable` offers a no-op; under `disable` only what runs. */
const onlyFor = (action: string | undefined): Only =>
  action === 'enable' ? 'disabled' : action === 'disable' ? 'enabled' : 'any'

/** The Claude Code plugins the snapshot holds: never a mini app, which has its own command. */
function installedPluginOptions(only: Only): SlashArgOption[] {
  return (miniAppContribSnapshot().document?.plugins ?? [])
    .filter((plugin) => only === 'any' || (plugin.enabled ? 'enabled' : 'disabled') === only)
    .map((plugin) => ({
      value: plugin.name,
      label: plugin.displayName || plugin.name,
      description: [
        `v${plugin.version}`,
        plugin.enabled ? 'enabled' : 'disabled',
        pluginOriginLabel(plugin),
      ].join(' · '),
    }))
}

async function marketplaceEntryOptions(): Promise<SlashArgOption[]> {
  const marketplaces = await backendClient.listMarketplaces().catch(() => [])
  return marketplaces.flatMap((market) =>
    (market.plugins ?? []).map((entry) => ({
      // The exact `<name>@<marketplace>` form `/plugin install` resolves.
      value: `${entry.name}@${market.name}`,
      label: entry.name,
      description: entry.description || `From the ${market.name} marketplace`,
    })),
  )
}

async function marketplaceOptions(): Promise<SlashArgOption[]> {
  const marketplaces = await backendClient.listMarketplaces().catch(() => [])
  return marketplaces.map((market) => ({
    value: market.name,
    label: market.name,
    description: market.unsupported
      ? 'Unsupported Claude Code marketplace'
      : `${market.count} plugin${market.count === 1 ? '' : 's'}`,
  }))
}

/**
 * Resolve one `/plugin` argument's options. `argName` comes from the shared catalog's
 * `PLUGIN_ARGS`; `action` is the sub-command chip already committed, which is what
 * lets `enable` offer only what is off and `disable` only what is on.
 */
export async function loadPluginCommandArgOptions(
  argName: string,
  action: string | undefined,
  query: string,
): Promise<SlashArgOption[]> {
  const options = await resolveOptions(argName, action)
  return options.filter((option) => matches(option, query)).slice(0, MAX_OPTIONS)
}

async function resolveOptions(
  argName: string,
  action: string | undefined,
): Promise<SlashArgOption[]> {
  switch (argName) {
    case 'plugin':
      return installedPluginOptions(onlyFor(action))
    case 'target':
      return [
        {
          value: '--strict',
          label: '--strict',
          description: 'Promote every warning to an error',
        },
        ...installedPluginOptions('any'),
      ]
    case 'source':
      return marketplaceEntryOptions()
    case 'market':
      return marketplaceOptions()
    default:
      return []
  }
}

/** A catalog by where it lives, as the store's catalog menu names it. */
function catalogLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:' ? 'A folder on this computer' : parsed.host
  } catch {
    return url
  }
}

/** The catalogs the person added, for `/mini-app catalog remove`; the built-in one stays. */
async function addedCatalogOptions(): Promise<SlashArgOption[]> {
  const catalogs = await backendClient.listMiniAppCatalogs().catch(() => [])
  return catalogs
    .filter((catalog) => !catalog.builtIn)
    .map((catalog) => ({
      value: catalog.url,
      label: catalogLabel(catalog.url),
      description: catalog.url,
    }))
}

/** The installed mini apps, for `/mini-app enable|disable|remove`; added catalogs for `catalog remove`. */
export async function loadMiniAppCommandArgOptions(
  argName: string,
  action: string | undefined,
  query: string,
): Promise<SlashArgOption[]> {
  if (argName === 'catalog')
    return (await addedCatalogOptions()).filter((option) => matches(option, query))
  if (argName !== 'app') return []
  const only = onlyFor(action)
  return miniAppContribSnapshot()
    .miniApps.filter((app) => only === 'any' || (app.enabled ? 'enabled' : 'disabled') === only)
    .map((app) => ({
      value: app.name,
      label: app.displayName || app.name,
      description: [
        ...(app.version ? [`v${app.version}`] : []),
        app.enabled ? 'enabled' : 'disabled',
        app.scope,
      ].join(' · '),
    }))
    .filter((option) => matches(option, query))
    .slice(0, MAX_OPTIONS)
}
