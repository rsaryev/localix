import type { ManagedSettingsSource } from '../../cc-settings/managed-settings'
import { readSettingsLayers } from '../../cc-settings/settings-files'
import {
  mergeSettingsLayer,
  mergeSettingsSources,
  type Settings,
  type SettingsSource,
} from '../../cc-settings/settings-merge'

/**
 * `$.settings.read`: Claude Code's settings as its engine runs under them — one source as loaded,
 * or every source merged, lowest precedence first: `user` (`$CLAUDE_CONFIG_DIR/settings.json`,
 * else ~/.claude/settings.json), `project` (.claude/settings.json), `local`
 * (.claude/settings.local.json, at the repository root), `flag` (none in Localix) and `policy`
 * (the managed settings). The files and the merge are Claude Code's (`cc-settings/`).
 */

export type { SettingsSource }

const SOURCES: readonly SettingsSource[] = ['user', 'project', 'local', 'flag', 'policy']

const isRecord = (value: unknown): value is Settings =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function createSettingsApi(input: {
  cwd: () => string
  homeDir: string
  env?: Record<string, string | undefined>
  /** The managed source; the machine's own by default. */
  managed?: ManagedSettingsSource | null
}) {
  const layers = () =>
    readSettingsLayers({
      homeDir: input.homeDir,
      cwd: input.cwd(),
      ...(input.env ? { env: input.env } : {}),
      ...(input.managed !== undefined ? { managed: input.managed } : {}),
    })
  return {
    async read(args?: unknown): Promise<Readonly<Settings>> {
      const source = isRecord(args) ? args.source : undefined
      if (typeof source === 'string') {
        if (!SOURCES.includes(source as SettingsSource))
          throw new Error(`settings.read: no source named ${source}`)
        // A source as loaded: the local files (repository root and working directory) as one.
        const own = (await layers()).filter((layer) => layer.source === source)
        return Object.freeze(
          own.reduce<Settings>((out, l) => mergeSettingsLayer(out, l.settings), {}),
        )
      }
      return Object.freeze(mergeSettingsSources(await layers()))
    },
  }
}
