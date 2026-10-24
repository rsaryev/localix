import { promises as fs, type Dirent } from 'node:fs'
import { basename, join } from 'node:path'

import { asStringArray } from '../../lib/coerce'
import { mapLimit } from '../../lib/map-limit'
import { isPathWithin } from '../../lib/path-containment'
import { readDirentsLimit } from '../../lib/read-dir-limit'
import { skillFileErrorDetail } from '../agent-core/skill-file'
import { toAbsList } from './discovery-paths'
import type { PluginArtifactDiagnostic } from './discovery-entrypoints'

/** A resolved Claude Code flat-file, paired with its namespaced (subdir-derived) name. */
export interface CollectedMarkdownFile {
  /** Absolute path to the `.md` file. */
  file: string
  /**
   * The namespaced name: path segments from the scan root to the file (sans `.md`),
   * joined by `:`. `commands/foo/bar.md` → `foo:bar`; a top-level `deploy.md` → `deploy`.
   */
  name: string
  /** A `commands` object-map entry's own fields, which win over the file's frontmatter. */
  overrides?: {
    description?: string
    argumentHint?: string
    model?: string
    allowedTools?: string[]
  }
}

const MAX_CC_MARKDOWN_DEPTH = 8
const MAX_CC_MARKDOWN_ENTRIES = 2000
const MAX_CC_MARKDOWN_ROOTS = 64
const MAX_CONCURRENT_CC_MARKDOWN_ROOTS = 8

interface MarkdownScanState {
  canonicalRoot: string
  seenDirs: Set<string>
  entriesSeen: number
  limitReported: boolean
}

/** Recursively collect every `.md` under `root`, namespacing each by its relative path. */
async function scanDirCollect(
  root: string,
  kind: 'command' | 'agent',
  diagnostics: PluginArtifactDiagnostic[],
  explicit: boolean,
  canonicalRoot: string,
): Promise<CollectedMarkdownFile[]> {
  const out: CollectedMarkdownFile[] = []
  const state: MarkdownScanState = {
    canonicalRoot,
    seenDirs: new Set(),
    entriesSeen: 0,
    limitReported: false,
  }
  const reportLimit = (path: string): void => {
    if (state.limitReported) return
    state.limitReported = true
    diagnostics.push({
      kind,
      path,
      message: `Markdown discovery stopped at the ${MAX_CC_MARKDOWN_ENTRIES}-entry limit`,
    })
  }
  const walk = async (
    d: string,
    prefix: string[],
    reportMissing: boolean,
    depth: number,
  ): Promise<void> => {
    if (depth > MAX_CC_MARKDOWN_DEPTH) {
      diagnostics.push({
        kind,
        path: d,
        message: `Markdown discovery skipped paths deeper than ${MAX_CC_MARKDOWN_DEPTH} directories`,
      })
      return
    }
    if (state.entriesSeen >= MAX_CC_MARKDOWN_ENTRIES) {
      reportLimit(d)
      return
    }
    let canonicalDir: string
    try {
      canonicalDir = await fs.realpath(d)
    } catch (error) {
      if (reportMissing || (error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        diagnostics.push({
          kind,
          path: d,
          message: `Cannot resolve ${kind} directory: ${skillFileErrorDetail(error)}`,
        })
      }
      return
    }
    if (!isPathWithin(state.canonicalRoot, canonicalDir)) {
      diagnostics.push({
        kind,
        path: d,
        message: `Refusing symlink escape outside plugin root: ${canonicalDir}`,
      })
      return
    }
    if (state.seenDirs.has(canonicalDir)) return
    state.seenDirs.add(canonicalDir)
    let entries: Dirent[]
    try {
      const remaining = MAX_CC_MARKDOWN_ENTRIES - state.entriesSeen
      const read = await readDirentsLimit(d, remaining)
      entries = read.entries
      if (read.truncated) reportLimit(d)
    } catch (error) {
      if (reportMissing || (error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        diagnostics.push({
          kind,
          path: d,
          message: `Cannot scan ${kind} directory: ${error instanceof Error ? error.message : 'unknown filesystem error'}`,
        })
      }
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    state.entriesSeen += entries.length
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(d, entry.name), [...prefix, entry.name], true, depth + 1)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const base = entry.name.replace(/\.md$/i, '')
        const file = join(d, entry.name)
        let canonicalFile: string
        try {
          canonicalFile = await fs.realpath(file)
        } catch (error) {
          diagnostics.push({
            kind,
            path: file,
            message: `Cannot resolve ${kind} artifact: ${skillFileErrorDetail(error)}`,
          })
          continue
        }
        if (!isPathWithin(state.canonicalRoot, canonicalFile)) {
          diagnostics.push({
            kind,
            path: file,
            message: `Refusing symlink escape outside plugin root: ${canonicalFile}`,
          })
          continue
        }
        out.push({ file: canonicalFile, name: [...prefix, base].join(':') })
      }
    }
  }
  await walk(root, [], explicit, 0)
  return out
}

/**
 * Resolve the `.md` files a Claude Code component field points at: the string path
 * entries in the manifest array (objects ignored) plus every `.md` under the default
 * `<dir>/<defaultSubdir>` — scanned RECURSIVELY so nested folders namespace into the
 * name (`commands/foo/bar.md` → `foo:bar`, full id `<plugin>:foo:bar`). Explicit `.md`
 * path entries keep their bare basename. All confined to the plugin directory; deduped
 * by name (first source wins: explicit entries before the default dir), name-sorted.
 *
 * `opts.replaceDefault` (CC spec REPLACE semantics): when true AND the field lists at
 * least one string path, the default `<dir>/<defaultSubdir>` is NOT scanned — the
 * manifest listing replaces the default, exactly as Claude Code does for `commands`
 * and `agents`. With no string paths the default scan still happens (an inline-object
 * only field never hides the default dir).
 */
export async function collectMarkdownFiles(
  dir: string,
  field: unknown[] | undefined,
  defaultSubdir: string,
  opts?: {
    replaceDefault?: boolean
    /** `false`: the default folder is not scanned even with no path listed (an object map). */
    scanDefault?: boolean
    diagnostics?: PluginArtifactDiagnostic[]
    kind?: 'command' | 'agent'
  },
): Promise<CollectedMarkdownFile[]> {
  const diagnostics = opts?.diagnostics ?? []
  const kind = opts?.kind ?? (defaultSubdir === 'agents' ? 'agent' : 'command')
  let canonicalRoot: string
  try {
    canonicalRoot = await fs.realpath(dir)
  } catch (error) {
    diagnostics.push({
      kind,
      path: dir,
      message: `Cannot resolve plugin root: ${skillFileErrorDetail(error)}`,
    })
    return []
  }
  let pathEntries = asStringArray(field)
  if (pathEntries.length > MAX_CC_MARKDOWN_ROOTS) {
    diagnostics.push({
      kind,
      path: dir,
      message: `Markdown discovery uses the first ${MAX_CC_MARKDOWN_ROOTS} declared roots (received ${pathEntries.length})`,
    })
    pathEntries = pathEntries.slice(0, MAX_CC_MARKDOWN_ROOTS)
  }
  const paths = toAbsList(dir, pathEntries)
  // Keyed off the RESOLVED (safe) paths, not the raw entries — a manifest whose only
  // listed paths were dropped as unsafe (`..`, absolute) never hides the default dir.
  const skipDefault =
    opts?.scanDefault === false || (opts?.replaceDefault === true && paths.length > 0)
  // Explicit entries first (in declared order), then the default dir — so a name
  // declared explicitly wins over the same name discovered in the default scan.
  const explicitGroups = await mapLimit(paths, MAX_CONCURRENT_CC_MARKDOWN_ROOTS, async (abs) => {
    let canonical: string
    try {
      canonical = await fs.realpath(abs)
    } catch (error) {
      diagnostics.push({
        kind,
        path: abs,
        message: `Cannot read ${kind} artifact: ${skillFileErrorDetail(error)}`,
      })
      return []
    }
    if (!isPathWithin(canonicalRoot, canonical)) {
      diagnostics.push({
        kind,
        path: abs,
        message: `Refusing symlink escape outside plugin root: ${canonical}`,
      })
      return []
    }
    if (abs.endsWith('.md')) {
      try {
        const stat = await fs.stat(canonical)
        if (!stat.isFile()) {
          diagnostics.push({
            kind,
            path: abs,
            message: `${kind === 'command' ? 'Command' : 'Agent'} artifact is not a regular file`,
          })
          return []
        }
        return [{ file: canonical, name: basename(abs).replace(/\.md$/i, '') }]
      } catch (error) {
        diagnostics.push({
          kind,
          path: abs,
          message: `Cannot read ${kind} artifact: ${error instanceof Error ? error.message : 'unknown filesystem error'}`,
        })
        return []
      }
    }
    return scanDirCollect(canonical, kind, diagnostics, true, canonicalRoot)
  })
  const groups = [
    ...explicitGroups,
    ...(skipDefault
      ? []
      : [await scanDirCollect(join(dir, defaultSubdir), kind, diagnostics, false, canonicalRoot)]),
  ]
  const byName = new Map<string, CollectedMarkdownFile>()
  for (const group of groups) {
    for (const item of group) if (!byName.has(item.name)) byName.set(item.name, item)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
