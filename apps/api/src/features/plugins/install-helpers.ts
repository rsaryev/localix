import { ConflictError, InvalidRequestError } from '../../lib/domain-errors'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

import { ApiError, errorMessage } from '../../lib/errors'
import { childEnv } from '../../lib/login-shell-env'
import { gitUrl, isGitSource } from '../ext/git-source'
import {
  copyExtensionTree,
  isUnderInstallRoot,
  readManifestName,
  rmrf,
  stripDotGit,
} from '../ext/install-tree'
import { findManifestPath } from './discovery'
import { PLUGIN_NAME_RE } from './contracts'
import {
  CLAUDE_CODE_MARKETPLACE_HINT,
  isClaudeCodeMarketplace,
  readClaudeCodePluginName,
} from './import-claude-code'
import { publishExtensionTree, type ExtensionPublicationLifecycle } from '../ext/publish-tree'

const execFileAsync = promisify(execFile)

export interface MaterializedPluginSource {
  directory: string
  name: string
  inPlace: boolean
}

/** Source acquisition owns temporary clones; publication owns installed files and state. */
export async function withPluginSource<T>(
  input: { source: string; installRoot: string; nameOverride?: string },
  operation: (source: MaterializedPluginSource) => Promise<T>,
): Promise<T> {
  if (isGitSource(input.source)) {
    const temporary = join(tmpdir(), `localix-plugin-${randomUUID()}`)
    try {
      await cloneRepo(gitUrl(input.source), temporary)
      await stripDotGit(temporary)
      return await withPluginSource({ ...input, source: temporary }, operation)
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
  if (input.nameOverride !== undefined && !PLUGIN_NAME_RE.test(input.nameOverride))
    throw new InvalidRequestError('plugin_invalid', 'Invalid plugin name override')
  const name = input.nameOverride ?? (await manifestName(input.source))
  const directory = resolve(input.source)
  return operation({
    directory,
    name,
    inPlace: isUnderInstallRoot(directory, resolve(input.installRoot), name),
  })
}

// ---- install helpers --------------------------------------------------------

/** Shallow-clone a git repo (optional ref) into `dest`. Throws on failure. */
export async function cloneRepo(url: string, dest: string, ref?: string): Promise<void> {
  const args = ['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), url, dest]
  try {
    // Explicit env: a no-`env` spawn under Bun sees only the process-start
    // snapshot — a GUI launch would hand git the bare PATH (login-shell-env.ts).
    await execFileAsync('git', args, { timeout: 120_000, env: childEnv(), windowsHide: true })
  } catch (err) {
    await rmrf(dest)
    throw new InvalidRequestError('plugin_clone_failed', `git clone failed: ${errorMessage(err)}`)
  }
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

/** Copy a plugin source tree, skipping VCS/dependency/build cruft and following no symlinks. */
export const copyPluginTree = copyExtensionTree

async function manifestName(dir: string): Promise<string> {
  const manifestPath = (await findManifestPath(dir)) ?? join(dir, 'plugin.json')
  // A Claude Code plugin is converted after staging; its name comes from its own manifest.
  const declared = (await readManifestName(manifestPath)) ?? (await readClaudeCodePluginName(dir))
  if (!declared && (await isClaudeCodeMarketplace(dir)))
    throw new InvalidRequestError('plugin_claude_marketplace', CLAUDE_CODE_MARKETPLACE_HINT)
  if (declared) {
    if (!PLUGIN_NAME_RE.test(declared))
      throw new InvalidRequestError('plugin_invalid', 'Invalid plugin name in manifest')
    return declared
  }
  // The fallback becomes the install directory AND the manifest-facing name, so it
  // must satisfy the same rules — otherwise a dir like ".my-plugins" would install
  // under a name the manifest schema rejects on every later discovery.
  const fallback = basename(dir)
  if (!PLUGIN_NAME_RE.test(fallback)) {
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
