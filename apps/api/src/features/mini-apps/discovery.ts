import { promises as fs } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import {
  MINI_APP_MANIFEST_FILE,
  miniAppManifestSchema,
  type MiniAppManifest,
} from '@localixai/mini-app-sdk/app-manifest'
import { summarizeZodIssues } from '@localixai/mini-app-sdk/backend'
import { resolveWithin } from '@localixai/path-containment'

import { listSubdirs, pathExists } from '../ext/fs-discovery'

/**
 * Where mini apps live and how one is read. A mini app is Localix's own format and shares
 * nothing with a plugin (docs/internals/plugins-and-mini-apps.md): this module reads
 * `mini-app.json` and nothing of the Claude Code format, and the plugins feature never reads
 * these folders.
 *
 *   ~/.localix/mini-apps/<name>/              the user's, in every project
 *   <project>/.localix/mini-apps/<name>/      a project's, under a name the user's do not hold
 */
export const MINI_APPS_SUBDIR = '.localix/mini-apps'

/** What a folder beside `mini-app.json` must not hold: a plugin, or a manifest from before. */
const NOT_A_MINI_APP = ['.claude-plugin/plugin.json', '.localix-app/app.json', 'plugin.json']

export interface DiscoveredMiniApp {
  name: string
  dir: string
  /** Where it lives. A global one is projected into every project as that project's. */
  scope: 'global' | 'project'
  projectId: string
  /** The parsed manifest; null when it does not parse (see `error`). */
  manifest: MiniAppManifest | null
  /** Why it cannot run; set, it contributes nothing. */
  error?: string
  /** The backend entrypoints, absolute and inside the folder. */
  backendEntries: string[]
  /** Its guide, absolute and inside the folder. */
  guide?: string
  /** The folder its guide's pages live in. */
  pages?: string
}

export async function loadMiniApp(
  dir: string,
  scope: 'global' | 'project',
  projectId: string,
): Promise<DiscoveredMiniApp> {
  const base = { name: basename(dir), dir, scope, projectId, backendEntries: [] }
  const fail = (error: string): DiscoveredMiniApp => ({ ...base, manifest: null, error })
  const beside = (
    await Promise.all(
      NOT_A_MINI_APP.map(async (file) => ((await pathExists(join(dir, file))) ? file : null)),
    )
  ).find((file) => file !== null)

  let json: unknown
  try {
    json = JSON.parse(await fs.readFile(join(dir, MINI_APP_MANIFEST_FILE), 'utf8'))
  } catch (error) {
    return fail(`Cannot read ${MINI_APP_MANIFEST_FILE}: ${(error as Error).message}`)
  }
  const parsed = miniAppManifestSchema.safeParse(json)
  if (!parsed.success)
    return fail(`Invalid ${MINI_APP_MANIFEST_FILE}: ${summarizeZodIssues(parsed.error).message}`)
  const manifest = parsed.data
  const named = { ...base, name: manifest.name, manifest }
  if (beside)
    return {
      ...named,
      error: `${MINI_APP_MANIFEST_FILE} and ${beside} are both here: a folder is a mini app or a plugin, not both`,
    }

  const declared = manifest.backend === undefined ? [] : [manifest.backend].flat()
  const backendEntries = declared.flatMap((entry) => {
    const contained = resolveWithin(dir, entry)
    return contained ? [contained] : []
  })
  const guide = resolveWithin(dir, manifest.guide) ?? undefined
  const pages = resolveWithin(dir, 'guide') ?? undefined
  return {
    ...named,
    backendEntries,
    ...(backendEntries.length < declared.length
      ? { error: `A backend entry leaves the mini app's folder: ${declared.join(', ')}` }
      : {}),
    ...(guide ? { guide } : {}),
    ...(pages ? { pages } : {}),
  }
}

async function scanRoot(
  root: string,
  scope: 'global' | 'project',
  projectId: string,
): Promise<DiscoveredMiniApp[]> {
  const folders = await listSubdirs(root)
  const found = await Promise.all(
    folders
      .filter((name) => !name.startsWith('.'))
      .map(async (name) => {
        const dir = join(root, name)
        return (await pathExists(join(dir, MINI_APP_MANIFEST_FILE)))
          ? loadMiniApp(dir, scope, projectId)
          : null
      }),
  )
  return found.filter((entry): entry is DiscoveredMiniApp => entry !== null)
}

/** First one of a name wins, sorted by name. */
function byPrecedence(batches: DiscoveredMiniApp[][]): DiscoveredMiniApp[] {
  const byName = new Map<string, DiscoveredMiniApp>()
  for (const app of batches.flat()) if (!byName.has(app.name)) byName.set(app.name, app)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The mini apps visible to one scope. The user's own come first: a project picks its own
 * names, and a project copy that shadowed one of the user's would inherit the yes given to it.
 */
export async function discoverMiniApps(opts: {
  homeDir: string
  cwd?: string | null
  projectId?: string
}): Promise<DiscoveredMiniApp[]> {
  const projectId = opts.projectId ?? ''
  const absCwd = opts.cwd && opts.cwd !== '/' ? resolve(opts.cwd) : null
  const [own, projects] = await Promise.all([
    scanRoot(join(opts.homeDir, MINI_APPS_SUBDIR), 'global', ''),
    projectId && absCwd && absCwd !== opts.homeDir
      ? scanRoot(join(absCwd, MINI_APPS_SUBDIR), 'project', projectId)
      : Promise.resolve([]),
  ])
  return byPrecedence([own.map((app) => ({ ...app, projectId })), projects])
}

/** Where a new mini app of this scope is installed. */
export function miniAppInstallRoot(
  scope: 'global' | 'project',
  cwd: string | null | undefined,
  home: string,
): string {
  return join(scope === 'project' && cwd ? resolve(cwd) : home, MINI_APPS_SUBDIR)
}
