// Bounded traversal and canonical path checks shared by filesystem and plugin skills.
import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import { mapLimit } from '../../lib/map-limit'
import { isPathWithin } from '../../lib/path-containment'
import { readDirentsLimit } from '../../lib/read-dir-limit'
import { skillFileErrorDetail } from './skill-file'
import {
  MAX_SKILL_ENTRIES_PER_ROOT,
  MAX_SKILL_SCAN_DEPTH,
  MAX_CONCURRENT_SKILL_READS,
  type SkillScanLogger,
} from './skill-scan-contracts'

/** Skills the curator archived live in `<skills-root>/.archive/<name>` — never discovered. */
const ARCHIVE_DIR_NAME = '.archive'

/**
 * The real kind of a directory entry, with SYMLINKS FOLLOWED.
 *
 * The trap: a `Dirent` for a symlink reports `isSymbolicLink()` and nothing else —
 * `isDirectory()` and `isFile()` are BOTH false, whatever the link points at. So the
 * obvious `isDirectory()` filter silently drops every symlinked entry, and a symlink
 * is exactly how these conventions share one skill/command tree across projects
 * (skills.md: a `<skill-name>` entry may be a link to a directory elsewhere on disk).
 * Only a `stat` — which follows the link — knows. Dangling/unreadable links are
 * skipped with diagnostics; canonical containment is enforced before any read.
 *
 * Both scanners below need that answer; deriving it twice is two chances to forget
 * half of it.
 */
async function direntKind(
  dir: string,
  entry: Dirent,
  logger: SkillScanLogger,
): Promise<'file' | 'dir' | null> {
  if (entry.isDirectory()) return 'dir'
  if (entry.isFile()) return 'file'
  if (!entry.isSymbolicLink()) return null
  try {
    const st = await fs.stat(join(dir, entry.name))
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null
  } catch (error) {
    const path = join(dir, entry.name)
    logger.warn(`[skills] ignoring unreadable symlink "${path}": ${skillFileErrorDetail(error)}`, {
      code: 'unreadable_symlink',
      path,
    })
    return null
  }
}

export async function canonicalPathWithin(
  path: string,
  safetyRoot: string | null,
  logger: SkillScanLogger,
): Promise<string | null> {
  let canonical: string
  try {
    canonical = await fs.realpath(path)
  } catch (error) {
    logger.warn(`[skills] ignoring unreadable path "${path}": ${skillFileErrorDetail(error)}`, {
      code: 'unreadable_path',
      path,
    })
    return null
  }
  if (safetyRoot && !isPathWithin(safetyRoot, canonical)) {
    logger.warn(`[skills] ignoring symlink escape "${path}" -> "${canonical}"`, {
      code: 'symlink_escape',
      path,
      target: canonical,
      safetyRoot,
    })
    return null
  }
  return canonical
}

export interface SkillFileCandidate {
  fallbackName: string
  skillDir: string
  path: string
  readPath: string
}

export async function collectSkillFiles(
  dir: string,
  depth: number,
  allowSkillAtCurrentDir: boolean,
  out: SkillFileCandidate[],
  state: {
    logger: SkillScanLogger
    safetyRoot: string | null
    seenDirs: Set<string>
    seenFiles: Set<string>
    entriesSeen: number
    limitWarned: boolean
    depthWarned: boolean
  },
): Promise<void> {
  if (state.entriesSeen >= MAX_SKILL_ENTRIES_PER_ROOT) return
  if (depth === 0 && !allowSkillAtCurrentDir) {
    try {
      await fs.lstat(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      state.logger.warn(
        `[skills] cannot access skill container "${dir}": ${skillFileErrorDetail(error)}`,
        { code: 'container_unreadable', path: dir },
      )
      return
    }
  }
  const canonicalDir = await canonicalPathWithin(dir, state.safetyRoot, state.logger)
  if (!canonicalDir) return
  if (state.seenDirs.has(canonicalDir)) {
    state.logger.warn(`[skills] ignoring skill directory cycle/alias "${dir}"`, {
      code: 'duplicate_canonical_path',
      path: dir,
      target: canonicalDir,
    })
    return
  }
  state.seenDirs.add(canonicalDir)

  let dirents: Dirent[]
  try {
    const remaining = MAX_SKILL_ENTRIES_PER_ROOT - state.entriesSeen
    const read = await readDirentsLimit(dir, remaining)
    dirents = read.entries.sort((a, b) => a.name.localeCompare(b.name))
    state.entriesSeen += dirents.length
    if (read.truncated && !state.limitWarned) {
      state.limitWarned = true
      state.logger.warn(
        `[skills] skill scan reached the ${MAX_SKILL_ENTRIES_PER_ROOT}-entry limit under "${dir}"`,
        { code: 'entry_limit', path: dir, limit: MAX_SKILL_ENTRIES_PER_ROOT },
      )
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      state.logger.warn(
        `[skills] cannot scan skill directory "${dir}": ${skillFileErrorDetail(error)}`,
        { code: 'container_unreadable', path: dir },
      )
    }
    return
  }

  const classified = await mapLimit(dirents, MAX_CONCURRENT_SKILL_READS, async (entry) => ({
    entry,
    kind: await direntKind(dir, entry, state.logger),
  }))
  const skillFile = allowSkillAtCurrentDir
    ? classified.find(({ entry, kind }) => entry.name === 'SKILL.md' && kind === 'file')
    : undefined
  if (skillFile) {
    const path = join(dir, skillFile.entry.name)
    const readPath = await canonicalPathWithin(path, state.safetyRoot, state.logger)
    if (!readPath) return
    if (state.seenFiles.has(readPath)) {
      state.logger.warn(`[skills] ignoring duplicate canonical skill "${path}" -> "${readPath}"`, {
        code: 'duplicate_canonical_path',
        path,
        target: readPath,
      })
      return
    }
    state.seenFiles.add(readPath)
    out.push({ fallbackName: basename(dir), skillDir: dir, path, readPath })
    return
  }

  const childDirs = classified.filter(
    ({ entry, kind }) =>
      kind === 'dir' &&
      entry.name !== ARCHIVE_DIR_NAME &&
      entry.name !== 'node_modules' &&
      !entry.name.startsWith('.'),
  )
  if (depth >= MAX_SKILL_SCAN_DEPTH) {
    if (childDirs.length > 0 && !state.depthWarned) {
      state.depthWarned = true
      state.logger.warn(
        `[skills] skill scan reached the ${MAX_SKILL_SCAN_DEPTH}-level depth limit under "${dir}"`,
        { code: 'depth_limit', path: dir, limit: MAX_SKILL_SCAN_DEPTH },
      )
    }
    return
  }
  for (const { entry } of childDirs) {
    if (state.entriesSeen >= MAX_SKILL_ENTRIES_PER_ROOT) {
      if (!state.limitWarned) {
        state.limitWarned = true
        state.logger.warn(
          `[skills] skill scan reached the ${MAX_SKILL_ENTRIES_PER_ROOT}-entry limit under "${dir}"`,
          { code: 'entry_limit', path: dir, limit: MAX_SKILL_ENTRIES_PER_ROOT },
        )
      }
      break
    }
    await collectSkillFiles(join(dir, entry.name), depth + 1, true, out, state)
  }
}
