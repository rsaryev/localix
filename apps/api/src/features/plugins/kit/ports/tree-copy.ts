import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  planTreeCopy,
  pluginRootIssue,
  type Dereference,
  type TreeEntry,
} from '@rsaryev/llx-plugin/marketplace'
import { UnprocessableError } from '../../../../lib/domain-errors'

/**
 * Copy a plugin tree the way Claude Code copies a plugin into its cache: the whole directory
 * (build output, `node_modules` and dotfiles included), skipping version control metadata and the
 * sockets, FIFOs and devices that are not part of a plugin. What happens to each link is the kit's
 * `planTreeCopy` (plugins/host-marketplace.md, "Share files within a marketplace with symlinks"):
 * within the plugin it is kept as a relative link, elsewhere in `linkRoot` (the marketplace the
 * plugin came from) the target's content is copied in its place, every time it is linked, and
 * anything else is skipped. Without `linkRoot` only links within the plugin survive.
 *
 * A dereferenced directory is listed and planned again, its children's paths below the link's and
 * its real path added to what is being copied, so a link back into it is a skipped cycle. The whole
 * tree is listed and planned before anything is written: a refused copy leaves nothing behind.
 */

/** Version control metadata, never copied. */
const VCS_DIRECTORIES = new Set(['.git', '.svn', '.hg', '.bzr'])

const MIB = 1024 * 1024
/**
 * Localix's own safety limit on what dereferenced links bring into one copy, so links that fan out
 * over several levels cannot multiply a hostile marketplace's content. The numbers are those Claude
 * Code documents for a copied plugin directory (plugins/marketplace-reference.md, "Output that fails
 * the install or update": "larger than 256 MiB or has more than 20,000 entries"); applying them to
 * dereferenced content is Localix's decision, not the docs'.
 */
const DEREFERENCE_LIMITS = { maxEntries: 20_000, maxBytes: 256 * MIB }

/** A listed entry, with where it is read from and the mode a directory keeps. */
type Found = TreeEntry & { readonly source: string; readonly mode: number }

/** What the copy writes, gathered before the first write. */
interface Walk {
  readonly pluginRoot: string
  readonly marketplaceRoot?: string
  readonly destination: string
  readonly directories: { from: string; to: string; mode: number }[]
  readonly files: { from: string; to: string }[]
  readonly links: { target: string; to: string }[]
  /** Entries and bytes brought in through dereferences, over the whole copy. */
  readonly brought: { entries: number; bytes: number }
}

export async function copyPluginTree(
  source: string,
  destination: string,
  options: { linkRoot?: string } = {},
): Promise<void> {
  const pluginRoot = await fs.realpath(source)
  const walk: Walk = {
    pluginRoot,
    ...(options.linkRoot === undefined
      ? {}
      : { marketplaceRoot: await confinedRoot(source, pluginRoot, options.linkRoot) }),
    destination,
    directories: [],
    files: [],
    links: [],
    brought: { entries: 0, bytes: 0 },
  }
  await plan(walk, await list(pluginRoot, ''), [])
  await write(walk, (await fs.stat(pluginRoot)).mode)
}

/** The marketplace's real path, which must contain the real plugin root. */
async function confinedRoot(source: string, pluginRoot: string, declared: string) {
  // An unresolvable root stays as declared: a real path is never inside a path that does not exist.
  const marketplaceRoot = await fs.realpath(declared).catch(() => declared)
  const issue = pluginRootIssue({ entryPath: source, pluginRoot, marketplaceRoot })
  if (issue) throw new UnprocessableError('extension_source_outside', issue.message)
  return marketplaceRoot
}

/** Every entry under `root`, links not followed, paths below `prefix`. */
async function list(root: string, prefix: string): Promise<Found[]> {
  const found: Found[] = []
  await listInto(found, root, prefix)
  return found
}

async function listInto(found: Found[], directory: string, prefix: string): Promise<void> {
  for (const name of await fs.readdir(directory)) {
    if (VCS_DIRECTORIES.has(name)) continue
    const entry = await entryOf(join(directory, name), prefix === '' ? name : `${prefix}/${name}`)
    if (!entry) continue
    found.push(entry)
    if (entry.isDirectory) await listInto(found, entry.source, entry.path)
  }
}

/** A file, a directory or a link; nothing for a socket, FIFO or device. */
async function entryOf(source: string, path: string): Promise<Found | undefined> {
  const stats = await fs.lstat(source)
  if (stats.isSymbolicLink()) return linkOf(source, path)
  if (!stats.isDirectory() && !stats.isFile()) return undefined
  const bytes = stats.isFile() ? stats.size : 0
  return {
    path,
    isDirectory: stats.isDirectory(),
    isSymlink: false,
    bytes,
    source,
    mode: stats.mode,
  }
}

async function linkOf(source: string, path: string): Promise<Found | undefined> {
  const link = { path, isDirectory: false, isSymlink: true, bytes: 0, source, mode: 0 }
  const real = await fs.realpath(source).catch(() => undefined)
  if (real === undefined) return link
  const stats = await fs.stat(real)
  if (!stats.isDirectory() && !stats.isFile()) return undefined
  return { ...link, target: { path: real, isDirectory: stats.isDirectory() } }
}

/** Plan one listing and gather what it writes; dereferenced directories are planned in turn. */
async function plan(walk: Walk, found: Found[], copying: readonly string[]): Promise<void> {
  const { pluginRoot, marketplaceRoot } = walk
  const decided = planTreeCopy(found, {
    pluginRoot,
    ...(marketplaceRoot === undefined ? {} : { marketplaceRoot }),
    copying,
  })
  const byPath = new Map(found.map((entry) => [entry.path, entry]))
  for (const path of decided.copy) {
    const entry = byPath.get(path)
    if (entry) gather(walk, entry)
  }
  for (const link of decided.relinks)
    walk.links.push({ target: link.target, to: join(walk.destination, link.path) })
  for (const dereference of decided.dereferences) await dereferenced(walk, dereference, copying)
}

function gather(walk: Walk, entry: Found): void {
  const to = join(walk.destination, entry.path)
  if (entry.isDirectory) walk.directories.push({ from: entry.source, to, mode: entry.mode })
  else walk.files.push({ from: entry.source, to })
}

/** A dereferenced target: a file is copied, a directory listed and planned again. */
async function dereferenced(walk: Walk, link: Dereference, copying: readonly string[]) {
  const stats = await fs.stat(link.from)
  const to = join(walk.destination, link.path)
  bring(walk, 1, stats.isDirectory() ? 0 : stats.size)
  if (!link.isDirectory) {
    walk.files.push({ from: link.from, to })
    return
  }
  walk.directories.push({ from: link.from, to, mode: stats.mode })
  const found = await list(link.from, link.path)
  // A link inside is counted when it is dereferenced in turn, so each entry counts once.
  const copied = found.filter((entry) => !entry.isSymlink)
  bring(
    walk,
    copied.length,
    copied.reduce((total, entry) => total + entry.bytes, 0),
  )
  await plan(walk, found, [...copying, link.from])
}

function bring(walk: Walk, entries: number, bytes: number): void {
  walk.brought.entries += entries
  walk.brought.bytes += bytes
  const { maxEntries, maxBytes } = DEREFERENCE_LIMITS
  if (walk.brought.entries > maxEntries)
    throw new UnprocessableError(
      'plugin_links_too_large',
      `The plugin's links bring more than ${maxEntries.toLocaleString('en-US')} entries into its copy, too many to copy`,
    )
  if (walk.brought.bytes > maxBytes)
    throw new UnprocessableError(
      'plugin_links_too_large',
      `The plugin's links bring more than ${maxBytes / MIB} MiB into its copy, too large to copy`,
    )
}

/** Write what was gathered; directory modes last, deepest first, so none blocks its own content. */
async function write(walk: Walk, rootMode: number): Promise<void> {
  await fs.mkdir(walk.destination, { recursive: true })
  for (const directory of walk.directories) await fs.mkdir(directory.to, { recursive: true })
  for (const file of walk.files) await fs.copyFile(file.from, file.to)
  for (const link of walk.links) await fs.symlink(link.target, link.to)
  for (const directory of [...walk.directories].reverse())
    await fs.chmod(directory.to, directory.mode & 0o7777)
  await fs.chmod(walk.destination, rootMode & 0o7777)
}
