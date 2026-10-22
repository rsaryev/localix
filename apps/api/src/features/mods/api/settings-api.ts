import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/**
 * `$.settings.read`: Claude Code's settings as its engine runs under them — one source as loaded,
 * or every source merged, lowest precedence first: `user` (~/.claude/settings.json), `project`
 * (.claude/settings.json), `local` (.claude/settings.local.json), `flag` (none in Localix) and
 * `policy` (the managed settings). Objects merge key by key; lists join, without repeats, as
 * Claude Code joins permission rules across sources.
 */

export type SettingsSource = 'user' | 'project' | 'local' | 'flag' | 'policy'

const SOURCES: readonly SettingsSource[] = ['user', 'project', 'local', 'flag', 'policy']

/** Where macOS, Linux and Windows keep Claude Code's managed settings. */
export function managedSettingsPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json'
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-settings.json'
  return '/etc/claude-code/managed-settings.json'
}

type Settings = Record<string, unknown>

const isRecord = (value: unknown): value is Settings =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

async function readSettings(file: string | null): Promise<Settings> {
  if (!file) return {}
  const text = await fs.readFile(file, 'utf8').catch(() => null)
  if (text === null) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function mergeSettings(lower: Settings, higher: Settings): Settings {
  const merged: Settings = { ...lower }
  for (const [key, value] of Object.entries(higher)) {
    const below = merged[key]
    merged[key] =
      isRecord(below) && isRecord(value)
        ? mergeSettings(below, value)
        : Array.isArray(below) && Array.isArray(value)
          ? [...new Set([...below, ...value])]
          : value
  }
  return merged
}

export function createSettingsApi(input: {
  cwd: () => string
  homeDir: string
  managedPath?: string
}) {
  const fileOf = (source: SettingsSource): string | null => {
    if (source === 'user') return join(input.homeDir, '.claude', 'settings.json')
    if (source === 'project') return join(input.cwd(), '.claude', 'settings.json')
    if (source === 'local') return join(input.cwd(), '.claude', 'settings.local.json')
    if (source === 'policy') return input.managedPath ?? managedSettingsPath()
    return null
  }
  return {
    async read(args?: unknown): Promise<Readonly<Settings>> {
      const source = isRecord(args) ? args.source : undefined
      if (typeof source === 'string') {
        if (!SOURCES.includes(source as SettingsSource))
          throw new Error(`settings.read: no source named ${source}`)
        return Object.freeze(await readSettings(fileOf(source as SettingsSource)))
      }
      const layers = await Promise.all(SOURCES.map((name) => readSettings(fileOf(name))))
      return Object.freeze(layers.reduce(mergeSettings, {}))
    },
  }
}
