import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { UnprocessableError } from '../../lib/domain-errors'
import { isPathWithin } from '../../lib/path-containment'

/**
 * Copy an extension tree the way Claude Code copies a plugin into its cache: the whole
 * directory (build output, `node_modules` and dotfiles included), skipping only version
 * control metadata. Symlinks are handled by where their target resolves:
 *
 * - inside the copied tree: kept, rewritten as a relative link to the copied target;
 * - elsewhere inside `linkRoot` (the marketplace a plugin came from): dereferenced, the
 *   target's content is copied in the link's place;
 * - anywhere else, or dangling: skipped.
 *
 * Without `linkRoot` only links inside the tree survive (a local-path install). With it, the
 * tree itself must resolve inside `linkRoot`: a plugin path that is or traverses a symlink out
 * of its marketplace is refused rather than read.
 *
 * Each real directory is copied at most once. Reaching one again links to its first copy, or,
 * while it is still being copied (a link cycle), skips it; so many links between shared
 * directories cost one copy each instead of one per path through them. A file dereferenced
 * through links is likewise copied once and linked to after that, so thousands of links to one
 * large file outside the plugin cannot multiply it on disk.
 */

/** Version control metadata, the only thing never copied. */
const VCS_DIRECTORIES = new Set(['.git', '.svn', '.hg', '.bzr'])

export interface CopyTreeOptions {
  /** Root whose links are dereferenced; the marketplace a plugin was resolved from. */
  linkRoot?: string
}

interface CopyContext {
  sourceRoot: string
  destinationRoot: string
  linkRoot: string
  /** Real directory → where it was first copied. */
  copies: Map<string, string>
  /** Real directories whose copy has not finished yet. */
  active: Set<string>
  /** Real file reached through a link → where it was first copied. */
  linkedFiles: Map<string, string>
}

export async function copyExtensionTree(
  source: string,
  destination: string,
  options: CopyTreeOptions = {},
): Promise<void> {
  const sourceRoot = await fs.realpath(source)
  const linkRoot =
    options.linkRoot === undefined
      ? sourceRoot
      : await confinedLinkRoot(source, sourceRoot, options.linkRoot)
  const context: CopyContext = {
    sourceRoot,
    destinationRoot: destination,
    linkRoot,
    copies: new Map(),
    active: new Set(),
    linkedFiles: new Map(),
  }
  await enter(context, sourceRoot, destination)
}

/** The real link root, which must contain the real tree. */
async function confinedLinkRoot(source: string, sourceRoot: string, declared: string) {
  const linkRoot = await fs.realpath(declared).catch(() => null)
  if (linkRoot && isPathWithin(linkRoot, sourceRoot)) return linkRoot
  throw new UnprocessableError(
    'extension_source_outside',
    `Source ${source} is or traverses a symlink that leads outside ${declared}, so it was not read`,
  )
}

/** Copy a real directory once: link to an earlier copy, skip one still being copied. */
async function enter(context: CopyContext, real: string, to: string): Promise<void> {
  if (context.active.has(real)) return
  const first = context.copies.get(real)
  if (first !== undefined) {
    await fs.symlink(relative(dirname(to), first) || '.', to, 'dir')
    return
  }
  context.copies.set(real, to)
  context.active.add(real)
  try {
    await copyDirectory(context, real, to)
  } finally {
    context.active.delete(real)
  }
}

/** `real` is a canonical directory path. */
async function copyDirectory(context: CopyContext, real: string, to: string): Promise<void> {
  const mode = (await fs.stat(real)).mode
  await fs.mkdir(to, { recursive: true })
  for (const entry of await fs.readdir(real, { withFileTypes: true })) {
    if (VCS_DIRECTORIES.has(entry.name)) continue
    const from = join(real, entry.name)
    const target = join(to, entry.name)
    if (entry.isSymbolicLink()) await copyLink(context, from, target)
    else if (entry.isDirectory()) await enter(context, from, target)
    else if (entry.isFile()) await fs.copyFile(from, target)
    // Sockets, FIFOs and devices are not part of an extension.
  }
  await fs.chmod(to, mode & 0o7777)
}

async function copyLink(context: CopyContext, link: string, to: string): Promise<void> {
  const resolved = await fs.realpath(link).catch(() => null)
  if (!resolved) return
  if (isPathWithin(context.sourceRoot, resolved)) {
    const copied = join(context.destinationRoot, relative(context.sourceRoot, resolved))
    const isDirectory = (await fs.stat(resolved)).isDirectory()
    await fs.symlink(relative(dirname(to), copied) || '.', to, isDirectory ? 'dir' : 'file')
    return
  }
  if (!isPathWithin(context.linkRoot, resolved)) return
  const stats = await fs.stat(resolved)
  if (stats.isDirectory()) await enter(context, resolved, to)
  else if (stats.isFile()) await copyLinkedFile(context, resolved, to)
}

/** Copy a file reached through a link once; later links to it point at that copy. */
async function copyLinkedFile(context: CopyContext, real: string, to: string): Promise<void> {
  const first = context.linkedFiles.get(real)
  if (first !== undefined) {
    await fs.symlink(relative(dirname(to), first), to, 'file')
    return
  }
  context.linkedFiles.set(real, to)
  await fs.copyFile(real, to)
}
