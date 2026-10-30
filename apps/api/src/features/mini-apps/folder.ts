import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'

import {
  MINI_APP_MANIFEST_FILE,
  miniAppManifestSchema,
  type MiniAppManifest,
} from '@localixai/mini-app-sdk/app-manifest'
import { summarizeZodIssues } from '@localixai/mini-app-sdk/backend'
import { resolveWithin } from '@localixai/path-containment'

import { pathExists } from '../ext/fs-discovery'
import { miniAppHostFieldsSchema, type MiniAppCommand, type MiniAppHostFields } from './contracts'
import { readRevocation } from './revocation-file'

/**
 * One mini app folder read the way Localix runs it: `.localix-mini-app/mini-app.json` by the SDK's
 * schema (its paths are the app folder's), the fields
 * the host validates itself, the backend entries and the guide, each confined to the folder. Kept
 * apart from discovery (which scans the roots) because the mini app
 * kit's tools judge a folder with exactly this before Localix ever sees it.
 */

/** What a mini app's folder must not also hold: a plugin (rule X2). */
const NOT_A_MINI_APP = ['.claude-plugin/plugin.json']

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
  /** Why its marketplace took it back (`revocation-file.ts`); set, it does not run. */
  revoked?: string
  /** The backend entrypoints, absolute and inside the folder. */
  backendEntries: string[]
  /** Its guide, absolute and inside the folder. */
  guide?: string
  /** The folder its guide's pages live in. */
  pages?: string
  /** Its sandboxed views and prompt sections, validated by the host. */
  views: MiniAppHostFields['views']
  promptSections: MiniAppHostFields['promptSections']
  /** Its commands, `/<app>:<name>`, with their prompts and argument pickers. */
  commands: MiniAppCommand[]
}

export async function loadMiniApp(
  dir: string,
  scope: 'global' | 'project',
  projectId: string,
): Promise<DiscoveredMiniApp> {
  const base = {
    name: basename(dir),
    dir,
    scope,
    projectId,
    backendEntries: [],
    views: [],
    promptSections: [],
    commands: [],
  }
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
  const host = miniAppHostFieldsSchema.safeParse({
    views: manifest.views,
    promptSections: manifest.promptSections,
    commandArgs: Object.fromEntries(
      Object.entries(manifest.commands ?? {}).map(([name, command]) => [name, command.args ?? []]),
    ),
  })
  if (!host.success)
    return {
      ...base,
      name: manifest.name,
      manifest,
      error: `Invalid ${MINI_APP_MANIFEST_FILE}: ${summarizeZodIssues(host.error).message}`,
    }
  const commands: MiniAppCommand[] = Object.entries(manifest.commands ?? {}).map(
    ([name, command]) => ({
      name,
      description: command.description,
      prompt: command.prompt,
      args: host.data.commandArgs[name] ?? [],
      ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
      ...(command.featured ? { featured: true } : {}),
      ...(command.activateTools ? { activateTools: command.activateTools } : {}),
    }),
  )
  const named = {
    ...base,
    name: manifest.name,
    manifest,
    views: host.data.views,
    promptSections: host.data.promptSections,
    commands,
  }
  if (beside)
    return {
      ...named,
      error: `${MINI_APP_MANIFEST_FILE} and ${beside} are both here: a folder is a plugin or a mini app, not both`,
    }

  const declared = manifest.backend === undefined ? [] : [manifest.backend].flat()
  const backendEntries = declared.flatMap((entry) => {
    const contained = resolveWithin(dir, entry)
    return contained ? [contained] : []
  })
  // Only files that are there: a guide the prompt marks must be one the agent can read.
  const guidePath = resolveWithin(dir, manifest.guide)
  const pagesPath = resolveWithin(dir, 'guide')
  const [guide, pages, revocation] = await Promise.all([
    guidePath ? pathExists(guidePath).then((found) => (found ? guidePath : undefined)) : undefined,
    pagesPath ? pathExists(pagesPath).then((found) => (found ? pagesPath : undefined)) : undefined,
    scope === 'global' ? readRevocation(dir) : null,
  ])
  return {
    ...named,
    backendEntries,
    ...(revocation ? { revoked: revocation.reason } : {}),
    ...(backendEntries.length < declared.length
      ? { error: `A backend entry leaves the mini app's folder: ${declared.join(', ')}` }
      : {}),
    ...(guide ? { guide } : {}),
    ...(pages ? { pages } : {}),
  }
}
