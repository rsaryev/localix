import { ConflictError, UnprocessableError } from '../../lib/domain-errors'
import { promises as fs, type Stats } from 'node:fs'
import { join, resolve } from 'node:path'
import { createKeyedSerializer } from '../../lib/keyed-serializer'
import { copyExtensionTree, rmrf } from './install-tree'

const PREFIX = '.extension-publish-'
export const isExtensionPublicationArtifact = (name: string): boolean => name.startsWith(PREFIX)
const serialize = createKeyedSerializer()

export interface ExtensionTreeInput {
  source: string
  name: string
  replace?: boolean
  prepare?: (stagedDirectory: string) => Promise<void>
}

interface PreparedTree {
  destination: string
  workspace: string
  staged: string
  backup: string
  identity?: Stats
  previous: Stats | null
  hasBackup: boolean
  activated: boolean
  retain: boolean
}

const statIfPresent = (path: string) =>
  fs.lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
const sameIdentity = (left: Stats | null, right: Stats | null) =>
  left === null || right === null
    ? left === right
    : left.dev === right.dev && left.ino === right.ino

/**
 * Prepare every tree before activation, then retain every backup until the host commit settles.
 * Ordered canonical locks prevent overlapping batches from interleaving or deadlocking. The host
 * callback owns its database transaction. Exception recovery is not cross-resource crash atomicity.
 */
export async function publishExtensionTrees(input: {
  installRoot: string
  trees: readonly ExtensionTreeInput[]
  commit?: (directories: readonly string[]) => Promise<void>
}): Promise<string[]> {
  const names = new Set<string>()
  for (const tree of input.trees) {
    if (!tree.name || tree.name === '.' || tree.name === '..' || /[/\\\0]/.test(tree.name))
      throw new UnprocessableError(
        'invalid_extension_name',
        'Extension name must be one path segment',
      )
    if (names.has(tree.name))
      throw new UnprocessableError(
        'duplicate_extension_destination',
        'Duplicate extension destination',
      )
    names.add(tree.name)
  }
  const root = resolve(input.installRoot)
  await fs.mkdir(root, { recursive: true })
  const canonicalRoot = await fs.realpath(root)
  const keys = [...names].sort().map((name) => join(canonicalRoot, name))
  const lock = (index: number): Promise<string[]> =>
    index === keys.length
      ? publish(root, input.trees, input.commit)
      : serialize(keys[index]!, () => lock(index + 1))
  return lock(0)
}

async function publish(
  root: string,
  inputs: readonly ExtensionTreeInput[],
  commit: ((directories: readonly string[]) => Promise<void>) | undefined,
): Promise<string[]> {
  const prepared: PreparedTree[] = []
  try {
    for (const input of inputs) {
      const source = await fs.realpath(input.source)
      if (!(await fs.stat(source)).isDirectory())
        throw new UnprocessableError(
          'invalid_extension_source',
          'Extension source must be a directory',
        )
      const destination = join(root, input.name)
      const previous = await statIfPresent(destination)
      if (previous && !input.replace)
        throw new ConflictError(
          'extension_exists',
          'An extension already exists at this destination',
        )
      const workspace = await fs.mkdtemp(join(root, PREFIX))
      const tree: PreparedTree = {
        destination,
        workspace,
        previous,
        staged: join(workspace, 'tree'),
        backup: join(workspace, 'backup'),
        hasBackup: false,
        activated: false,
        retain: false,
      }
      prepared.push(tree)
      await copyExtensionTree(source, tree.staged)
      await input.prepare?.(tree.staged)
      tree.identity = await fs.lstat(tree.staged)
      if (!tree.identity.isDirectory())
        throw new UnprocessableError(
          'invalid_extension_tree',
          'Prepared extension must be a directory',
        )
    }
    for (const tree of prepared) {
      if (!sameIdentity(tree.previous, await statIfPresent(tree.destination)))
        throw new ConflictError(
          'extension_changed',
          'Extension destination changed during preparation',
        )
      if (tree.previous) {
        await fs.rename(tree.destination, tree.backup)
        tree.hasBackup = true
      }
      await fs.rename(tree.staged, tree.destination)
      tree.activated = true
    }
    const directories = prepared.map((tree) => tree.destination)
    await commit?.(directories)
    return directories
  } catch (error) {
    const failures: unknown[] = []
    // Attempt every restoration even if one fails; keep only the failed recovery workspaces.
    for (const tree of [...prepared].reverse()) {
      if (!tree.activated && !tree.hasBackup) continue
      try {
        if (tree.activated) {
          if (!sameIdentity(tree.identity!, await statIfPresent(tree.destination)))
            throw new Error('Published extension was replaced outside this installation')
          await fs.rename(tree.destination, tree.staged)
        }
        if (tree.hasBackup) await fs.rename(tree.backup, tree.destination)
      } catch (rollbackError) {
        tree.retain = true
        failures.push(rollbackError)
      }
    }
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        `Extension restoration failed; previous tree retained in ${prepared
          .filter((tree) => tree.retain)
          .map((tree) => tree.workspace)
          .join(', ')}`,
      )
    throw error
  } finally {
    for (const tree of prepared) if (!tree.retain) await rmrf(tree.workspace)
  }
}
