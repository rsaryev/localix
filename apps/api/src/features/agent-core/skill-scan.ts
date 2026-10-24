import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { mapLimit } from '../../lib/map-limit'
import { isPathWithin } from '../../lib/path-containment'
import { readSkillMarkdownFile, SkillFileReadError, skillFileErrorDetail } from './skill-file'
import { type DiscoveredSkill, parseSkillFrontmatter } from './skill-frontmatter'

/**
 * SKILL SCANNING — how a Localix skills tree is read from disk:
 *
 *   `<base>/.localix/skills/<name>/SKILL.md`
 *
 * Each skill remains a directory so it can carry scripts and assets beside the
 * prompt. Claude Code's `.claude/skills` and `.claude/commands` (and a project's portable
 * `.agents/skills`) are read sources beside it; native Localix skills win by name.
 * `skill-discovery.ts` owns scope precedence and the write/delete side.
 */

import {
  MAX_CONCURRENT_SKILL_READS,
  type SkillScanScope,
  type SkillScanLogger,
} from './skill-scan-contracts'
import { canonicalPathWithin, collectSkillFiles, type SkillFileCandidate } from './skill-scan-tree'
import { makeLazySkill } from './skill-lazy'
import { readCommandFilesAsSkills } from './skill-scan-commands'

export {
  MAX_SKILL_SCAN_DEPTH,
  type SkillScanScope,
  type SkillScanLogger,
} from './skill-scan-contracts'

const quietSkillScanLogger: SkillScanLogger = { warn: () => {} }

/** The single Localix skills root visible under a base directory. */
export function skillRoot(baseDir: string): string {
  return join(baseDir, '.localix/skills')
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
  // In precedence order, first name wins: Localix's own skills, Claude Code's `.claude/skills`,
  // the portable `.agents/skills` (a project's only), then `.claude/commands` — "A skill and a
  // file in `.claude/commands/`: the skill".
  const layers = [
    await scanSkillDir(baseDir, scope, logger, safetyRoot),
    await readSkillsInContainer(join(baseDir, '.claude', 'skills'), scope, logger, safetyRoot),
    scope === 'project'
      ? await readSkillsInContainer(join(baseDir, '.agents', 'skills'), scope, logger, safetyRoot)
      : [],
    await readCommandFilesAsSkills(join(baseDir, '.claude', 'commands'), scope, logger, safetyRoot),
  ]
  const taken = new Set<string>()
  const out: DiscoveredSkill[] = []
  for (const layer of layers) {
    const fresh = layer.filter((skill) => !taken.has(skill.name))
    for (const skill of fresh) taken.add(skill.name)
    out.push(...fresh)
  }
  return out
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
      // A folder holding SKILL.md directly IS one skill (Claude Code's either/or): its own
      // subfolders are its files, not more skills.
      return skills
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      warnReadFailure(logger, join(root, 'SKILL.md'), error)
    // no SKILL.md directly at the root — fall through to the subdir scan below
  }

  skills.push(...(await readSkillsInContainer(root, scope, logger, safetyRoot, transformContent)))
  return skills
}
