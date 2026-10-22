import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { MergedSource } from '@localixai/claude-plugin'

import { errorMessage } from '../../lib/errors'
import { isRecord } from '../../lib/record'
import { confineToDir, pathExists } from '../ext/fs-discovery'

/**
 * A plugin's hooks files, read the way Claude Code reads them: `hooks/hooks.json` first when it
 * exists, then each file the manifest lists, then its inline maps. A file that cannot be loaded
 * contributes nothing and says why, in Claude Code's words (plugin troubleshooting, "Hooks fail to
 * load"): `Failed to load hooks from <path>: <reason>`, `hooks path not found: <path>` or
 * `hooks path escapes plugin directory: <path>`. The plugin's other components still load.
 */
export interface PluginHookFiles {
  configs: unknown[]
  errors: string[]
}

const SHELLS = new Set(['bash', 'powershell'])

/** Why one handler entry breaks the hooks schema, or `undefined` when it is well formed. */
function handlerProblem(handler: unknown, at: string): string | undefined {
  if (!isRecord(handler)) return `${at}: expected an object`
  if (handler.type !== undefined && typeof handler.type !== 'string')
    return `${at}.type: expected a string`
  if (handler.type !== undefined && handler.type !== 'command') return undefined
  if (typeof handler.command !== 'string' || !handler.command.trim())
    return `${at}.command: expected a non-empty string`
  const args = handler.args
  if (args !== undefined && !(Array.isArray(args) && args.every((a) => typeof a === 'string')))
    return `${at}.args: expected an array of strings`
  if (handler.shell !== undefined && !SHELLS.has(handler.shell as string))
    return `${at}.shell: expected "bash" or "powershell"`
  if (handler.timeout !== undefined && typeof handler.timeout !== 'number')
    return `${at}.timeout: expected a number`
  return undefined
}

/**
 * Why a parsed hooks FILE breaks the hooks schema, or `undefined` when it is well formed. A file
 * wraps its event map in a top-level `hooks` key — one with only the event map fails to load, as in
 * Claude Code — unless it is a mod's file, which names a hooks module in `modules`. Unknown event
 * names are not errors here: validation reports them as never fired.
 */
export function hooksFileProblem(raw: unknown): string | undefined {
  if (!isRecord(raw)) return 'expected a JSON object'
  if (raw.hooks === undefined) {
    return raw.modules !== undefined
      ? undefined
      : 'missing the top-level "hooks" key: a hooks file wraps its event map in { "hooks": { … } }'
  }
  if (!isRecord(raw.hooks)) return '"hooks": expected an object'
  for (const [event, groups] of Object.entries(raw.hooks)) {
    if (!Array.isArray(groups)) return `hooks.${event}: expected an array of matcher groups`
    for (const [index, group] of groups.entries()) {
      const at = `hooks.${event}[${index}]`
      if (!isRecord(group)) return `${at}: expected an object`
      if (group.matcher !== undefined && typeof group.matcher !== 'string')
        return `${at}.matcher: expected a string`
      if (!Array.isArray(group.hooks)) return `${at}.hooks: expected an array of hook handlers`
      for (const [i, handler] of group.hooks.entries()) {
        const problem = handlerProblem(handler, `${at}.hooks[${i}]`)
        if (problem) return problem
      }
    }
  }
  return undefined
}

type FileRead = { config: unknown } | { error: string }

async function readHooksFile(file: string, listed: boolean): Promise<FileRead | undefined> {
  if (!(await pathExists(file)))
    return listed ? { error: `hooks path not found: ${file}` } : undefined
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch (error) {
    return { error: `Failed to load hooks from ${file}: ${errorMessage(error)}` }
  }
  const problem = hooksFileProblem(raw)
  return problem ? { error: `Failed to load hooks from ${file}: ${problem}` } : { config: raw }
}

/** Read a plugin's hooks configs in Claude Code's order, collecting each file's load failure. */
export async function readPluginHookFiles(
  dir: string,
  defaultFile: string,
  source: MergedSource,
): Promise<PluginHookFiles> {
  const fallback = join(dir, defaultFile)
  const errors: string[] = []
  const files: string[] = []
  for (const path of source.files) {
    const file = confineToDir(dir, path)
    if (file === null) errors.push(`hooks path escapes plugin directory: ${path}`)
    else if (file !== fallback) files.push(file)
  }
  const reads = await Promise.all([
    readHooksFile(fallback, false),
    ...files.map((file) => readHooksFile(file, true)),
  ])
  const configs: unknown[] = []
  for (const read of reads) {
    if (!read) continue
    if ('error' in read) errors.push(read.error)
    else configs.push(read.config)
  }
  return { configs: [...configs, ...source.inline], errors }
}
