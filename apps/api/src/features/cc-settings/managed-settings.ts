import { execFile } from 'node:child_process'
import { promises as fs, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isRecord } from '../../lib/record'
import { mergeSettingsLayer, type Settings } from './settings-merge'

/**
 * CLAUDE CODE'S MANAGED SETTINGS, as a machine delivers them (managed-settings.md, "Where each
 * mechanism stores the policy"; "How Claude Code combines managed sources"):
 *
 *   - an MDM policy: on macOS the `com.anthropic.claudecode` managed preferences domain (a
 *     configuration profile), read with `plutil`;
 *   - the file-based policy in the system directory: `managed-settings.json`, then every `*.json`
 *     of `managed-settings.d/` in alphabetical order (hidden files skipped), merged.
 *
 * Under the default `first-wins` behaviour the higher source that sets any policy key is the
 * policy and the other is ignored; `managedSourcesBehavior: "merge"` in it combines both.
 * Server-managed settings come from claude.ai with the person's Anthropic sign-in, which Localix
 * does not hold, so they are not read; neither is the Windows registry.
 */

export function managedSettingsDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode'
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode'
  return '/etc/claude-code'
}

export interface ManagedSettingsSource {
  /** The system directory holding `managed-settings.json` and `managed-settings.d/`. */
  dir: string
  /** The MDM policy as JSON, or undefined when the machine has none. */
  readMdm?: () => Promise<Settings | undefined>
}

function readJsonObject(file: string): Settings | undefined {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** `managed-settings.json`, then `managed-settings.d/*.json` alphabetically, merged. */
export function readManagedFiles(dir: string): Settings | undefined {
  const base = readJsonObject(join(dir, 'managed-settings.json'))
  const dropInDir = join(dir, 'managed-settings.d')
  let entries: string[] = []
  try {
    entries = readdirSync(dropInDir)
  } catch {
    entries = []
  }
  const names = entries.filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort()
  let merged = base
  for (const name of names) {
    const part = readJsonObject(join(dropInDir, name))
    if (part) merged = mergeSettingsLayer(merged ?? {}, part)
  }
  return merged
}

const CONTROL_KEYS = new Set(['managedSourcesBehavior', 'wslInheritsWindowsSettings'])
const hasPolicyKey = (settings: Settings | undefined): settings is Settings =>
  Boolean(settings) && Object.keys(settings!).some((key) => !CONTROL_KEYS.has(key))

/** The managed policy in force, or `{}` when the machine delivers none. */
export async function readManagedSettings(source: ManagedSettingsSource): Promise<Settings> {
  const [mdm, files] = await Promise.all([
    source.readMdm?.().catch(() => undefined),
    Promise.resolve(readManagedFiles(source.dir)),
  ])
  const ranked = [mdm, files].filter(hasPolicyKey)
  const top = ranked[0]
  if (!top) return {}
  if (top.managedSourcesBehavior !== 'merge') return top
  // Lower sources first, so the higher one's single values win and lists union.
  return ranked.reverse().reduce<Settings>((out, layer) => mergeSettingsLayer(out, layer), {})
}

/** The macOS configuration profile for Claude Code, converted to JSON by `plutil`. */
export function macosMdmReader(
  file = '/Library/Managed Preferences/com.anthropic.claudecode.plist',
): () => Promise<Settings | undefined> {
  return async () => {
    if (!(await fs.stat(file).catch(() => null))) return undefined
    const json = await new Promise<string | null>((done) =>
      execFile(
        'plutil',
        ['-convert', 'json', '-o', '-', file],
        { timeout: 5_000, windowsHide: true },
        (err, out) => done(err ? null : out),
      ),
    )
    if (!json) return undefined
    try {
      const parsed: unknown = JSON.parse(json)
      return isRecord(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }
}

/** The managed source of this machine. */
export function systemManagedSource(platform: NodeJS.Platform = process.platform) {
  return {
    dir: managedSettingsDir(platform),
    ...(platform === 'darwin' ? { readMdm: macosMdmReader() } : {}),
  } satisfies ManagedSettingsSource
}
