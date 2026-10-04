import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { mapLimit } from '../../lib/map-limit'
import { isPathWithin } from '../../lib/path-containment'
import { readDirentsLimit } from '../../lib/read-dir-limit'
import {
  readSkillMarkdownFile,
  readSkillMarkdownFileSync,
  SkillFileReadError,
  skillFileErrorDetail,
} from './skill-file'
import {
  type DiscoveredSkill,
  makeSkill,
  parseMarkdownFrontmatter,
  parseSkillFrontmatter,
  type SkillFrontmatter,
} from './skill-frontmatter'

/**
 * SKILL SCANNING — how a Localix skills tree is read from disk:
 *
 *   `<base>/.localix/skills/<name>/SKILL.md`
 *
 * Each skill remains a directory so it can carry scripts and assets beside the
 * prompt. Foreign skill and command homes are deliberately not enumerated here.
 * `skill-discovery.ts` owns scope precedence and the write/delete side.
 */

export type SkillScanScope = 'project' | 'global'

export interface SkillScanLogger {
  warn: (message: string, meta?: unknown) => void
}

const quietSkillScanLogger: SkillScanLogger = { warn: () => {} }

/** Cap work per root so one pathological tree cannot fan out across the entire filesystem. */
export const MAX_SKILL_ENTRIES_PER_ROOT = 2000

/** Allow nested portable skill categories while preventing unbounded recursion. */
export const MAX_SKILL_SCAN_DEPTH = 6

/** Bound independent stats/reads so discovery does not exhaust the fs worker pool. */
const MAX_CONCURRENT_SKILL_READS = 32

/** The single Localix skills root visible under a base directory. */
export function skillRoot(baseDir: string): string {
  return join(baseDir, '.localix/skills')
}

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

async function canonicalPathWithin(
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

function warnReadFailure(logger: SkillScanLogger, path: string, error: unknown): void {
  logger.warn(`[skills] ignoring skill "${path}": ${skillFileErrorDetail(error)}`, {
    code: 'read_failed',
    errorCode:
      error instanceof SkillFileReadError
        ? error.code
        : ((error as NodeJS.ErrnoException | undefined)?.code ?? 'unknown'),
    kind: 'skill',
    path,
  })
}

function warnEmptyBody(logger: SkillScanLogger, path: string): void {
  logger.warn(`[skills] ignoring skill "${path}": markdown body is empty`, {
    code: 'empty_body',
    kind: 'skill',
    path,
  })
}

interface SkillFileCandidate {
  fallbackName: string
  skillDir: string
  path: string
  readPath: string
}

/**
 * Read Codex's optional `agents/openai.yaml` implicit-invocation policy.
 *
 * Localix already has the same runtime split under the CC-compatible
 * `disable-model-invocation` field: hidden from the model-selectable roster, but
 * still available to an explicit slash command or session pin. Map only that
 * executable policy here. `interface` and `dependencies` intentionally remain
 * unmodelled until there is a UI / dependency-install consumer for them.
 *
 * Optional product metadata must never make a valid SKILL.md disappear. Missing,
 * malformed, oversized, non-UTF-8, or escaping metadata therefore fails open with
 * a diagnostic; only a successfully parsed explicit `false` changes the policy.
 */
async function disablesImplicitInvocationFromOpenAiMetadata(
  skillReadPath: string,
  safetyRoot: string | null,
  logger: SkillScanLogger,
): Promise<boolean> {
  const metadataPath = join(dirname(skillReadPath), 'agents', 'openai.yaml')
  let readPath: string
  try {
    readPath = await fs.realpath(metadataPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    logger.warn(`[skills] ignoring metadata "${metadataPath}": ${skillFileErrorDetail(error)}`, {
      code: 'metadata_read_failed',
      path: metadataPath,
    })
    return false
  }
  if (safetyRoot && !isPathWithin(safetyRoot, readPath)) {
    logger.warn(`[skills] ignoring metadata symlink escape "${metadataPath}" -> "${readPath}"`, {
      code: 'metadata_symlink_escape',
      path: metadataPath,
      target: readPath,
      safetyRoot,
    })
    return false
  }

  try {
    const parsed: unknown = parseYaml(await readSkillMarkdownFile(readPath))
    if (!isPlainRecord(parsed)) return false
    const policy = parsed.policy
    if (!isPlainRecord(policy)) return false
    return policy.allow_implicit_invocation === false
  } catch (error) {
    logger.warn(`[skills] ignoring metadata "${metadataPath}": ${skillFileErrorDetail(error)}`, {
      code: 'metadata_read_failed',
      path: metadataPath,
    })
    return false
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Keep discovery metadata-only after parsing. The prompt needs only each skill's name and
 * description, so retaining every body (up to 1 MiB each) on every turn wastes memory. A lazy,
 * memoized string accessor preserves the public shape while retaining full content only for
 * skills that are actually pinned, invoked, or read.
 */
function makeLazySkill(
  fm: SkillFrontmatter,
  fallbackName: string,
  scope: 'project' | 'global',
  path: string,
  dir: string,
  readPath: string,
  transformContent?: (content: string) => string,
): DiscoveredSkill {
  const skill = makeSkill(fm, fallbackName, scope, path, dir)
  let loaded = false
  let content = ''
  Object.defineProperty(skill, 'content', {
    configurable: false,
    enumerable: true,
    get(): string {
      if (!loaded) {
        const body = parseMarkdownFrontmatter(readSkillMarkdownFileSync(readPath)).body
        content = transformContent ? transformContent(body) : body
        loaded = true
      }
      return content
    },
  })
  return skill
}

async function collectSkillFiles(
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

/**
 * Recursively read portable skills under a container. A directory containing
 * SKILL.md is a skill root and is not traversed further. Discovery is bounded by
 * depth and aggregate entries, follows safe symlinks, and deduplicates canonical
 * directory/file identities. Shared by filesystem and plugin skill roots.
 */
async function readSkillsInContainer(
  container: string,
  scope: 'project' | 'global',
  logger: SkillScanLogger,
  safetyRoot: string | null,
  transformContent?: (content: string) => string,
): Promise<DiscoveredSkill[]> {
  const candidates: SkillFileCandidate[] = []
  await collectSkillFiles(container, 0, false, candidates, {
    logger,
    safetyRoot,
    seenDirs: new Set(),
    seenFiles: new Set(),
    entriesSeen: 0,
    limitWarned: false,
    depthWarned: false,
  })

  const parsed = await mapLimit(candidates, MAX_CONCURRENT_SKILL_READS, async (candidate) => {
    const { fallbackName, skillDir, path, readPath } = candidate
    try {
      // Keep the enclosing mapLimit's 32-read ceiling honest: an optional
      // metadata probe must not silently double the number of live file reads.
      const raw = await readSkillMarkdownFile(readPath)
      const metadataDisablesImplicitInvocation = await disablesImplicitInvocationFromOpenAiMetadata(
        readPath,
        safetyRoot,
        logger,
      )
      const fm = parseSkillFrontmatter(raw)
      if (metadataDisablesImplicitInvocation) fm.disableModelInvocation = true
      if (!fm.body) {
        warnEmptyBody(logger, path)
        return null
      }
      return makeLazySkill(fm, fallbackName, scope, path, skillDir, readPath, transformContent)
    } catch (error) {
      warnReadFailure(logger, path, error)
      return null
    }
  })
  // BY NAME, not by `readdir`. The FS hands entries back in inode order, which differs
  // across machines and can change under you — and this order is not cosmetic. It reaches
  // the model twice over: `buildSkillsContext` emits the "# Skills" section in it and
  // TRUNCATES at a char budget, so the order decides WHICH plugin skills the model can see
  // at all; and that section sits above the runtime-context marker, i.e. inside the
  // deploy-stable cached prefix, so a reshuffle re-prefills the whole thing. The `skill`
  // tool's own list already sorts (tools/skill.ts) — it copied this path's precedence and
  // added the sort this path never had.
  return parsed
    .filter((s): s is DiscoveredSkill => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function scanSkillDir(
  baseDir: string,
  scope: SkillScanScope,
  logger: SkillScanLogger,
  safetyRoot: string | null,
): Promise<DiscoveredSkill[]> {
  return readSkillsInContainer(skillRoot(baseDir), scope, logger, safetyRoot)
}

/** Everything discoverable directly under one Localix base directory. */
export async function scanScope(
  baseDir: string,
  scope: SkillScanScope,
  logger: SkillScanLogger = quietSkillScanLogger,
): Promise<DiscoveredSkill[]> {
  // Project files may come from an untrusted checkout, so canonical targets stay
  // under that project/ancestor scope. Global files are user-controlled and retain
  // external symlink support.
  let safetyRoot: string | null = null
  if (scope === 'project') {
    try {
      safetyRoot = await fs.realpath(baseDir)
    } catch (error) {
      logger.warn(
        `[skills] cannot resolve project skill root "${baseDir}": ${skillFileErrorDetail(error)}`,
        { code: 'root_unreadable', path: baseDir },
      )
      return []
    }
  }
  return scanSkillDir(baseDir, scope, logger, safetyRoot)
}

/**
 * Reads skills from a single root directory whose immediate children are skill
 * folders (`<root>/<name>/SKILL.md`). Unlike scanSkillDir, `root` IS the skills
 * container (no `.localix/skills` suffix is appended). Used to fold plugin-bundled
 * skill directories into the same skill list the agent sees.
 */
export async function readSkillsFromRoot(
  root: string,
  scope: 'project' | 'global',
  logger: SkillScanLogger = quietSkillScanLogger,
  transformContent?: (content: string) => string,
): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = []
  let safetyRoot: string
  try {
    safetyRoot = await fs.realpath(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`[skills] cannot resolve skill root "${root}": ${skillFileErrorDetail(error)}`, {
        code: 'root_unreadable',
        path: root,
      })
    }
    return []
  }

  // A skills path may point DIRECTLY at a skill dir (SKILL.md inside it), not a
  // parent of `<name>/SKILL.md` subdirs — Claude Code's `skills: ["./path/to/skill"]`
  // / `["./"]` form. Load that as one skill (name from frontmatter, else the dir name).
  try {
    const rootSkillPath = join(root, 'SKILL.md')
    await fs.access(rootSkillPath)
    const canonical = await canonicalPathWithin(rootSkillPath, safetyRoot, logger)
    if (canonical) {
      const raw = await readSkillMarkdownFile(canonical)
      const metadataDisablesImplicitInvocation = await disablesImplicitInvocationFromOpenAiMetadata(
        canonical,
        safetyRoot,
        logger,
      )
      const fm = parseSkillFrontmatter(raw)
      if (metadataDisablesImplicitInvocation) fm.disableModelInvocation = true
      if (fm.body)
        skills.push(
          makeLazySkill(
            fm,
            basename(root),
            scope,
            rootSkillPath,
            root,
            canonical,
            transformContent,
          ),
        )
      else warnEmptyBody(logger, rootSkillPath)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      warnReadFailure(logger, join(root, 'SKILL.md'), error)
    // no SKILL.md directly at the root — fall through to the subdir scan below
  }

  skills.push(...(await readSkillsInContainer(root, scope, logger, safetyRoot, transformContent)))
  return skills
}
