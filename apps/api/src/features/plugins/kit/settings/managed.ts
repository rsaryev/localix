import { execFile } from 'node:child_process'
import { promises as fs, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  composeManagedReads,
  type ManagedComposition,
  type ManagedFileRead,
  type ManagedReads,
  type SourceRead,
} from '@rsaryev/llx-plugin/settings'

/**
 * Where this machine keeps Claude Code's managed settings, read as host I/O for the kit, which
 * composes them (`composeManagedReads`: the drop-in order, `first-wins` against
 * `managedSourcesBehavior: "merge"`, unreadable and broken sources): the file-based policy in the
 * system directory and, on macOS, the `com.anthropic.claudecode` configuration profile read with
 * `plutil`. Server-managed settings need the person's Anthropic sign-in, which Localix does not
 * hold; the Windows registry is not read.
 */

export function managedSettingsDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode'
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode'
  return '/etc/claude-code'
}

export interface ManagedSettingsSource {
  /** The system directory holding `managed-settings.json` and `managed-settings.d/`. */
  dir: string
  /** The MDM profile as JSON, or undefined when the machine has none. */
  readMdm?: () => Promise<Record<string, unknown> | undefined>
}

/** Nothing there is no source; a read that fails is the kit's `unreadable`, never "absent". */
function failed(error: unknown): SourceRead {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
  const cause = code === 'EACCES' || code === 'EPERM' ? 'denied' : 'failed'
  return { unreadable: cause, reason: error instanceof Error ? error.message : String(error) }
}

/** The file's text: the kit parses it and names a broken one. */
const fileRead = (path: string): SourceRead => {
  try {
    return { value: readFileSync(path, 'utf8') }
  } catch (error) {
    return failed(error)
  }
}

function dropInsOf(dir: string): ManagedFileRead['dropIns'] {
  try {
    const names = readdirSync(dir)
    return { files: names.map((name) => ({ name, read: fileRead(join(dir, name)) })) }
  } catch (error) {
    const read = failed(error)
    return read && 'unreadable' in read ? read : undefined
  }
}

/** `managed-settings.json` and the `.json` files of `managed-settings.d/`, as the kit reads them. */
export function managedFileRead(dir: string): ManagedFileRead {
  const dropInDir = join(dir, 'managed-settings.d')
  const base = join(dir, 'managed-settings.json')
  const dropIns = dropInsOf(dropInDir)
  return {
    base: fileRead(base),
    ...(dropIns === undefined ? {} : { dropIns }),
    label: { base, directory: dropInDir, dropIn: (name) => join(dropInDir, name) },
  }
}

/** The managed policy of the source: the file policy alone, or with the MDM profile too. */
export function composeManagedSource(
  source: ManagedSettingsSource,
  mdm?: Record<string, unknown>,
): ManagedComposition {
  const reads: ManagedReads = {
    file: managedFileRead(source.dir),
    ...(mdm === undefined ? {} : { plist: { value: mdm } }),
  }
  return composeManagedReads(reads)
}

/** The managed policy of the source with its MDM profile, when it has one. */
export async function readManagedComposition(
  source: ManagedSettingsSource,
): Promise<ManagedComposition> {
  const mdm = await source.readMdm?.().catch(() => undefined)
  return composeManagedSource(source, mdm)
}

/** The macOS configuration profile for Claude Code, converted to JSON by `plutil`. */
export function macosMdmReader(
  file = '/Library/Managed Preferences/com.anthropic.claudecode.plist',
): () => Promise<Record<string, unknown> | undefined> {
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
    try {
      const parsed: unknown = json ? JSON.parse(json) : undefined
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined
    } catch {
      return undefined
    }
  }
}

/** The managed source of this machine. */
export function systemManagedSource(
  platform: NodeJS.Platform = process.platform,
): ManagedSettingsSource {
  return {
    dir: managedSettingsDir(platform),
    ...(platform === 'darwin' ? { readMdm: macosMdmReader() } : {}),
  }
}
