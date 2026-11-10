import {
  mergedSettings,
  readClaudeSettings,
  type ManagedSettingsSource,
  type Settings,
  type SettingsFileScope,
} from '../../plugins/kit'
import { isRecord } from '../../../lib/record'

/**
 * `$.settings.read`: Claude Code's settings as its engine runs under them — one source as loaded,
 * or every source merged, lowest precedence first: `user` (`$CLAUDE_CONFIG_DIR/settings.json`,
 * else ~/.claude/settings.json), `project` (.claude/settings.json), `local`
 * (.claude/settings.local.json), `flag` (none in Localix) and `policy` (the managed settings).
 * Reading and merging are the kit's (`plugins/kit`).
 */

const SCOPES: Readonly<Record<string, SettingsFileScope | null>> = {
  user: 'user',
  project: 'project',
  local: 'local',
  flag: null,
  policy: 'managed',
}

export function createSettingsApi(input: {
  cwd: () => string
  homeDir: string
  env?: Record<string, string | undefined>
  /** The managed source; the machine's own by default. */
  managed?: ManagedSettingsSource | null
}) {
  return {
    async read(args?: unknown): Promise<unknown> {
      const settings = await load(args)
      const key = isRecord(args) ? args.key : undefined
      // A key resolves to that key's value, anything else to the settings object.
      return typeof key === 'string' ? settings[key as keyof Settings] : settings
    },
  }
  async function load(args?: unknown): Promise<Readonly<Settings>> {
    const source = isRecord(args) ? args.source : undefined
    if (typeof source === 'string' && !Object.hasOwn(SCOPES, source))
      throw new Error(`settings.read: no source named ${source}`)
    const scope = typeof source === 'string' ? SCOPES[source] : undefined
    if (scope === null) return Object.freeze({})
    const settings = await readClaudeSettings({
      homeDir: input.homeDir,
      cwd: input.cwd(),
      ...(input.env ? { env: input.env } : {}),
      ...(input.managed !== undefined ? { managed: input.managed } : {}),
    })
    return Object.freeze(mergedSettings(settings, scope))
  }
}
