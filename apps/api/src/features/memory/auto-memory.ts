import { realpathSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { claudeConfigDir } from '../cc-settings/config-dir'
import { localSettingsRoot, readSettingsFileLayers } from '../cc-settings/settings-files'
import { mergeSettingsSources } from '../cc-settings/settings-merge'
import { expandHome } from '../../lib/home-path'

/**
 * CLAUDE CODE'S AUTO MEMORY, IN CLAUDE CODE'S OWN FOLDER (memory.md, "Auto memory"). A chat reads
 * and keeps the very folder Claude Code does, so what one learned about a repository the other
 * already knows:
 *
 *   `<config>/projects/<project>/memory/`, `<config>` being `CLAUDE_CONFIG_DIR` or `~/.claude`
 *
 * `<project>` is the repository's main checkout, so every worktree and subfolder of it shares one
 * folder; outside a repository it is the working folder itself. The folder holds a `MEMORY.md`
 * index, whose first 200 lines or 25KB load into the prompt, and the topic files it points to,
 * which the model reads when they matter and keeps with the ordinary file tools.
 */

export const MEMORY_INDEX_LINES = 200
export const MEMORY_INDEX_BYTES = 25 * 1024

/** Claude Code's name for a project folder: non-alphanumerics become `-`, long names get a hash. */
export function claudeProjectKey(projectPath: string): string {
  const name = projectPath.replace(/[^a-zA-Z0-9]/g, '-')
  if (name.length <= 200) return name
  let hash = 0
  for (let i = 0; i < projectPath.length; i++)
    hash = ((hash << 5) - hash + projectPath.charCodeAt(i)) | 0
  return `${name.slice(0, 200)}-${Math.abs(hash).toString(36)}`
}

const truthy = (value: string | undefined) =>
  !!value && !['0', 'false', 'no', 'off', ''].includes(value.trim().toLowerCase())

/**
 * The run's memory folder, or null when the person turned auto memory off
 * (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`, or `autoMemoryEnabled: false` in their settings).
 */
export function autoMemoryDir(input: {
  cwd: string
  homeDir: string
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
}): string | null {
  const env = input.env ?? process.env
  if (truthy(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY)) return null
  let cwd = resolve(input.cwd)
  try {
    cwd = realpathSync(cwd)
  } catch {}
  const layers = readSettingsFileLayers({ ...input, cwd, env, managed: null })
  if (mergeSettingsSources(layers).autoMemoryEnabled === false) return null
  // A repository's committed settings cannot send memory elsewhere: only the person's own may.
  const own = mergeSettingsSources(layers.filter((layer) => layer.source !== 'project'))
  const configured = own.autoMemoryDirectory
  if (typeof configured === 'string' && configured.trim()) {
    const dir = configured.trim()
    return resolve(expandHome(dir, input.homeDir))
  }
  // `localSettingsRoot` declines a repository rooted at home, where Claude Code keeps no local
  // settings file; memory still keys on that root, so it is asked with a home that never matches.
  const project = localSettingsRoot(cwd, '\0', input.platform) ?? cwd
  return join(claudeConfigDir(input.homeDir, env), 'projects', claudeProjectKey(project), 'memory')
}

/** MEMORY.md as the prompt carries it: its first 200 lines or 25KB, whichever ends first. */
export async function readMemoryIndex(dir: string): Promise<{ index: string; clipped: boolean }> {
  const raw = (await readFile(join(dir, 'MEMORY.md'), 'utf8').catch(() => '')).trimEnd()
  const lines = raw.split('\n').slice(0, MEMORY_INDEX_LINES).join('\n')
  const index = Buffer.from(lines).subarray(0, MEMORY_INDEX_BYTES).toString('utf8')
  return { index, clipped: index.length < raw.length }
}

/**
 * `/memory <fact>`: the fact in a file of its own, as the model would save it, and its pointer
 * appended to MEMORY.md. A file of the same name is kept; the new one takes the next free name.
 */
export async function rememberFact(dir: string, fact: string): Promise<string> {
  const text = fact.trim()
  const line = text.split('\n')[0]!.slice(0, 120)
  // Letters and digits of any script stay: a Russian fact would otherwise slug to `note` and
  // every one after it to `note-2`, `note-3`, naming nothing.
  const slug =
    Array.from(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, ''),
    )
      .slice(0, 48)
      .join('')
      .replace(/-+$/g, '') || 'note'
  // A `]` would end the link text early, so the entry would point nowhere.
  const title = line.replace(/[[\]]/g, '\\$&')
  await mkdir(dir, { recursive: true })
  const body = (name: string) =>
    `---\nname: ${name}\ndescription: ${JSON.stringify(line)}\nmetadata:\n  type: project\n---\n\n${text}\n`
  for (let n = 1; ; n++) {
    const name = n === 1 ? slug : `${slug}-${n}`
    try {
      await writeFile(join(dir, `${name}.md`), body(name), { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
    const index = join(dir, 'MEMORY.md')
    const current = await readFile(index, 'utf8').catch(() => '')
    const lead = current && !current.endsWith('\n') ? '\n' : ''
    await appendFile(index, `${lead}- [${title}](${name}.md) — ${line}\n`)
    return `${name}.md`
  }
}
