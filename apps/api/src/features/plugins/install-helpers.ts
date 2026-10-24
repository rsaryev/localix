import { ConflictError, InvalidRequestError } from '../../lib/domain-errors'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import { ApiError } from '../../lib/errors'
import { gitUrl, isGitSource } from '../ext/git-source'
import {
  copyExtensionTree,
  isUnderInstallRoot,
  readManifestName,
  rmrf,
  stripDotGit,
} from '../ext/install-tree'
import { findManifestPath } from './discovery'
import { PLUGIN_ID_NAME_RE } from './contracts'
import { marketplaceOnlyHint } from './claude-code-marketplace'
import { fetchGitTree } from './git-fetch'
import { publishExtensionTree, type ExtensionPublicationLifecycle } from '../ext/publish-tree'

export interface MaterializedPluginSource {
  directory: string
  name: string
  inPlace: boolean
  /** The marketplace the source was resolved from; see `copyExtensionTree`. */
  linkRoot?: string
}

/** Source acquisition owns temporary clones; publication owns installed files and state. */
export async function withPluginSource<T>(
  input: { source: string; installRoot: string; nameOverride?: string; linkRoot?: string },
  operation: (source: MaterializedPluginSource) => Promise<T>,
): Promise<T> {
  if (isGitSource(input.source)) {
    const temporary = join(tmpdir(), `localix-plugin-${randomUUID()}`)
    try {
      await cloneRepo(gitUrl(input.source), temporary)
      await stripDotGit(temporary)
      // A cloned repository is the plugin itself; nothing outside it may be linked in.
      return await withPluginSource({ ...input, source: temporary, linkRoot: undefined }, operation)
    } finally {
      await rmrf(temporary)
    }
  }
  if (!isAbsolute(input.source))
    throw new InvalidRequestError(
      'plugin_bad_source',
      'Local plugin source must be an absolute directory path or a git URL',
    )
  if (!(await fs.stat(input.source).catch(() => null))?.isDirectory())
    throw new InvalidRequestError('plugin_bad_source', `Not a directory: ${input.source}`)
  if (input.nameOverride !== undefined && !PLUGIN_ID_NAME_RE.test(input.nameOverride))
    throw new InvalidRequestError('plugin_invalid', 'Invalid plugin name override')
  const name = input.nameOverride ?? (await manifestName(input.source))
  const directory = resolve(input.source)
  return operation({
    directory,
    name,
    inPlace: isUnderInstallRoot(directory, resolve(input.installRoot), name),
    ...(input.linkRoot ? { linkRoot: input.linkRoot } : {}),
  })
}

// ---- install helpers --------------------------------------------------------

/**
 * Fetch a git repo at `ref` (a branch, tag or commit; the default branch when absent) into
 * `dest`, optionally checking out only the `sparse` directory. Throws on failure.
 */
export async function cloneRepo(
  url: string,
  dest: string,
  ref?: string,
  sparse?: string | string[],
): Promise<void> {
  const paths = Array.isArray(sparse) && sparse.length === 0 ? undefined : sparse
  await fetchGitTree(url, dest, { ...(ref ? { ref } : {}), ...(paths ? { sparse: paths } : {}) })
}

/**
 * Copy a local plugin directory under the install root (or register it in place).
 * `nameOverride` forces the install directory name — used for marketplace installs
 * whose plugin dir has no plugin.json (a `strict:false` entry-as-manifest), where the
 * temp/clone dir basename is not a valid plugin name but the entry name is.
 */
export async function installFromLocal(
  source: string,
  installRoot: string,
  replace = false,
  nameOverride?: string,
  lifecycle?: ExtensionPublicationLifecycle,
): Promise<string> {
  return withPluginSource({ source, installRoot, nameOverride }, async (materialized) => {
    if (materialized.inPlace) {
      await lifecycle?.prepare?.(materialized.directory)
      await lifecycle?.commit?.(materialized.directory)
      return materialized.directory
    }
    return publishPluginTree(
      materialized.directory,
      installRoot,
      materialized.name,
      replace,
      lifecycle,
    )
  })
}

/** Copy a plugin source tree whole (VCS metadata aside), handling symlinks as Claude Code does. */
export const copyPluginTree = copyExtensionTree

async function manifestName(dir: string): Promise<string> {
  // A mini app names itself; else the plugin's manifest (Claude Code's, or a legacy one) does.
  const pluginManifest = await findManifestPath(dir)
  const declared = pluginManifest ? await readManifestName(pluginManifest) : null
  const hint = declared ? null : await marketplaceOnlyHint(dir)
  if (hint) throw new InvalidRequestError('plugin_claude_marketplace', hint)
  if (declared) {
    if (!PLUGIN_ID_NAME_RE.test(declared))
      throw new InvalidRequestError('plugin_invalid', 'Invalid plugin name in manifest')
    return declared
  }
  // The fallback becomes the install directory AND the manifest-facing name, so it
  // must satisfy the same rules — otherwise a dir like ".my-plugins" would install
  // under a name the manifest schema rejects on every later discovery.
  const fallback = basename(dir)
  if (!PLUGIN_ID_NAME_RE.test(fallback)) {
    throw new InvalidRequestError(
      'plugin_invalid',
      `Cannot derive a valid plugin name: plugin.json has no "name" and the directory name "${fallback}" is not a valid plugin name.`,
    )
  }
  return fallback
}

async function publishPluginTree(
  source: string,
  installRoot: string,
  name: string,
  replace: boolean,
  lifecycle?: ExtensionPublicationLifecycle,
) {
  try {
    return await publishExtensionTree({ source, installRoot, name, replace, ...lifecycle })
  } catch (error) {
    if (error instanceof ApiError && error.code === 'extension_exists')
      throw new ConflictError(
        'plugin_exists',
        'A plugin already exists at this destination. Remove it first.',
      )
    throw error
  }
}
