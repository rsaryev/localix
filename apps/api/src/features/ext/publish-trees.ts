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
  /**
   * The folder this tree is published into, when not the batch's `installRoot` (a versioned
   * cache, `<root>/<name>` being one version). Locks are per destination either way.
   */
  root?: string
  replace?: boolean
  /** The marketplace the source came from: links into it are dereferenced, not dropped. */
  linkRoot?: string
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
  /** Destinations to hold through the commit without publishing a tree to them. */
  hold?: readonly string[]
  commit?: (directories: readonly string[]) => Promise<void>
}): Promise<string[]> {
  const destinations = new Set<string>()
  const assertSegment = (name: string) => {
    if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name))
      throw new UnprocessableError(
        'invalid_extension_name',
        'Extension name must be one path segment',
      )
  }
  const root = resolve(input.installRoot)
  for (const tree of input.trees) {
    assertSegment(tree.name)
    const destination = join(resolve(tree.root ?? root), tree.name)
    if (destinations.has(destination))
      throw new UnprocessableError(
        'duplicate_extension_destination',
        'Duplicate extension destination',
      )
    destinations.add(destination)
  }
  for (const name of input.hold ?? []) assertSegment(name)
  const canonical = async (dir: string) => {
    await fs.mkdir(dir, { recursive: true })
    return fs.realpath(dir)
  }
  const canonicalRoot = await canonical(root)
  const treeKeys = await Promise.all(
    input.trees.map(async (tree) =>
      join(tree.root ? await canonical(resolve(tree.root)) : canonicalRoot, tree.name),
    ),
  )
  const keys = [
    ...new Set([...treeKeys, ...(input.hold ?? []).map((name) => join(canonicalRoot, name))]),
  ].sort()
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
      const treeRoot = input.root ? resolve(input.root) : root
      const destination = join(treeRoot, input.name)
      const previous = await statIfPresent(destination)
      if (previous && !input.replace)
        throw new ConflictError(
          'extension_exists',
          'An extension already exists at this destination',
        )
      // Staged beside its destination, so activation is a rename on one filesystem.
      const workspace = await fs.mkdtemp(join(treeRoot, PREFIX))
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
      await copyExtensionTree(source, tree.staged, { linkRoot: input.linkRoot })
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
