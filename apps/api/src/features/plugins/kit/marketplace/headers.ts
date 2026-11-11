import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  archiveDownloadHeaders,
  entryLayer,
  helperCache,
  resolveHeaders,
  urlSourceLayer,
  type DownloadHeaderPorts,
  type HeadersSetting,
} from '@rsaryev/llx-plugin/marketplace'
import { isRecord } from '../../../../lib/record'
import { hostCommandRunner } from '../ports/command-runner'
import { hostLocations, processEnvironment, systemClock } from '../ports/host-io'
import { marketplacePolicy } from './policy'

/**
 * The request headers of a catalog fetch and of an archive download, decided by the kit
 * (`resolveHeaders`, `archiveDownloadHeaders`; plugins/host-marketplace.md, "Authenticate archive
 * downloads"): the fixed `headers`, the JSON a `headersHelper` command prints over them when it may
 * run, the `url` source's on its own origin under the entry's. The kit runs the command through
 * Localix's process runner from Claude Code's configuration folder, or from the home folder on a
 * computer that has none.
 */

type Headers = Readonly<Record<string, string>>

/** One per process: a `url` source's command output is reused for 60 seconds. */
const cache = helperCache(systemClock)

function portsFor(home: string): DownloadHeaderPorts {
  const runner = hostCommandRunner({ maxOutputBytes: 1024 * 1024 })
  return {
    runner: { run: (run) => runner.run({ ...run, cwd: existsSync(run.cwd) ? run.cwd : home }) },
    environment: processEnvironment(() => process.env),
    locations: hostLocations({ homeDir: home, projectDir: () => home, pluginRoot: () => home }),
    cache,
  }
}

/** What managed settings say about running commands, and whether they declare the marketplace. */
async function settingFor(marketplace: string | undefined, managedDir: string | undefined) {
  const { settings } = await marketplacePolicy(managedDir)
  const declared = isRecord(settings.extraKnownMarketplaces) ? settings.extraKnownMarketplaces : {}
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : undefined)
  const disabled = flag(settings.disableCommandPluginSources)
  const managedOnly = flag(settings.allowManagedHooksOnly)
  const setting: HeadersSetting = {
    platform: process.platform === 'win32' ? 'windows' : 'posix',
    folderTrusted: false,
    settingsApproved: false,
    managedMarketplace: marketplace !== undefined && Object.hasOwn(declared, marketplace),
    ...(disabled === undefined ? {} : { disableCommandPluginSources: disabled }),
    ...(managedOnly === undefined ? {} : { allowManagedHooksOnly: managedOnly }),
  }
  return setting
}

const signal = () => new AbortController().signal

export interface UrlSourceHeaders {
  url: string
  name?: string
  headers?: Headers
  headersHelper?: string
}

export interface HeaderContext {
  homeDir?: string | undefined
  managedSettingsDir?: string | undefined
}

/** The headers a `url` marketplace's catalog is fetched with; a failed command throws its message. */
export async function catalogHeaders(source: UrlSourceHeaders, ctx: HeaderContext = {}) {
  const home = ctx.homeDir ?? homedir()
  const layer = urlSourceLayer({ kind: 'url', ...source }, 'user')
  const setting = await settingFor(source.name, ctx.managedSettingsDir)
  const read = await resolveHeaders(layer, setting, portsFor(home), { signal: signal() })
  if ('severity' in read) throw new Error(read.message)
  return read.headers
}

export interface ArchiveHeadersRequest {
  archiveUrl: string
  plugin: string
  marketplace: string
  /** The entry's own `headers` and `headersHelper`. */
  entry: { headers?: Headers; headersHelper?: string }
  /** The marketplace's `url` source, when it was added by URL. */
  source?: UrlSourceHeaders
  /** The person accepted the entry's command for this archive URL. */
  accepted: boolean
}

/** The headers an archive is downloaded with; a refused or failed command throws its message. */
export async function archiveHeaders(req: ArchiveHeadersRequest, ctx: HeaderContext = {}) {
  const home = ctx.homeDir ?? homedir()
  const command = req.entry.headersHelper
  const entry = entryLayer({ name: req.plugin, ...req.entry }, req.archiveUrl, {
    origin: 'catalog',
    operation: 'install',
    ...(req.accepted && command !== undefined
      ? { accepted: { command, archiveUrl: req.archiveUrl, queryCounts: true } }
      : {}),
  })
  const read = await archiveDownloadHeaders(
    {
      archiveUrl: req.archiveUrl,
      entry,
      ...(req.source
        ? { marketplace: urlSourceLayer({ kind: 'url', ...req.source }, 'user') }
        : {}),
    },
    await settingFor(req.marketplace, ctx.managedSettingsDir),
    portsFor(home),
    { signal: signal() },
  )
  if ('severity' in read) throw new Error(read.message)
  return read.headers
}
