import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isPathWithin } from '../../lib/path-containment'
import { type DiscoveredSkill, renderSkillFile } from './skill-frontmatter'
import { scanScope, skillRoot, type SkillScanLogger, type SkillScanScope } from './skill-scan'
import { assertSkillMarkdownSize, readSkillMarkdownFile } from './skill-file'
import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'
import { recordSkillAuthored } from './skill-usage-recorder'
import { skillSourceLock } from './skill-source-policy'

/**
 * Filesystem skill store — the portable `SKILL.md` format used by the open
 * agent-skills ecosystem (agentskills.io, Claude Code). Skills are
 * directories so they can carry scripts and other assets alongside the prompt:
 *
 *   <root>/.claude/skills/<name>/SKILL.md    (+ optional scripts, templates, …)
 *   <project>/.agents/skills/<name>/SKILL.md (portable read source)
 *
 * This module owns the RESOLUTION policy and the write side. Resolution is
 * exact-scope: sessions without a project read PERSONAL (home) skills; project
 * sessions read the exact project working directory, then personal skills. Writes and deletes
 * go to `.claude/skills`; portable skills can be shadowed by a native copy. Nothing is stored in
 * a DB — skills are just files the agent (or the user) can create/edit/ship.
 *
 * How a base dir is READ (the SKILL.md directory format, symlinks, archives)
 * lives in `skill-scan.ts`; the pure parsing
 * layer (frontmatter → DiscoveredSkill) in `skill-frontmatter.ts`. The skill type and
 * the scan entry points are re-exported here; frontmatter readers are imported from
 * the modules that define them.
 */
export type { DiscoveredSkill } from './skill-frontmatter'
export { skillRoot, readSkillsFromRoot } from './skill-scan'

/** Minimal warning sink shared with the API's existing feature-level logger contracts. */
export type SkillDiscoveryLogger = SkillScanLogger

const quietSkillDiscoveryLogger: SkillDiscoveryLogger = { warn: () => {} }

function claimSkill(
  byName: Map<string, DiscoveredSkill>,
  skill: DiscoveredSkill,
  logger: SkillDiscoveryLogger,
  layer: number,
  layers: Map<string, number>,
): void {
  const winner = byName.get(skill.name)
  if (!winner) {
    byName.set(skill.name, skill)
    layers.set(skill.name, layer)
    return
  }
  // A nearer or higher-precedence definition winning is the DECLARED order, not a collision;
  // only two skills of one name read from the same place are worth a warning.
  if (layers.get(skill.name) !== layer) return
  logger.warn(
    `[skills] duplicate name "${skill.name}": keeping "${winner.path}", ignoring "${skill.path}"`,
    { skillName: skill.name, winnerPath: winner.path, loserPath: skill.path },
  )
}

async function isGitRoot(dir: string): Promise<boolean> {
  return fs.stat(join(dir, '.git')).then(
    () => true,
    () => false,
  )
}

/** `cwd` and each parent up to the repository root holding it (nearest first); `cwd` alone outside one. */
async function projectChain(start: string, home: string): Promise<string[]> {
  const chain: string[] = []
  let cur = start
  while (true) {
    if (cur === home) break
    chain.push(cur)
    if (await isGitRoot(cur)) return chain
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return [start]
}

/**
 * Every skill visible from here, in Claude Code's precedence (skills.md, "Resolve skills that
 * share a name"): the personal ones first — "personal over project" — then the project's, read
 * from the working directory and every parent up to the repository root, the nearest first.
 * Within one directory `.claude/skills` comes before the portable `.agents/skills` and
 * `.claude/commands` (`skill-scan.ts`).
 */
export async function discoverFilesystemSkills(
  workingDir?: string | null,
  homeDir?: string, // injectable for tests; defaults to the OS home dir
  // Libraries must not claim the host terminal. Production composition injects
  // its structured logger; tests/standalone consumers stay quiet by default.
  logger: SkillDiscoveryLogger = quietSkillDiscoveryLogger,
): Promise<DiscoveredSkill[]> {
  const byName = new Map<string, DiscoveredSkill>()
  const layers = new Map<string, number>()
  const home = homeDir ?? homedir()
  // `strictPluginOnlyCustomization`: the organization may close these folders (see the policy).
  const lock = await skillSourceLock({
    workingDir: workingDir && workingDir !== '/' ? resolve(workingDir) : null,
    homeDir: home,
  })
  if (lock.blockFolders) return []
  let layer = 0
  for (const s of await scanScope(home, 'global', logger))
    claimSkill(byName, s, logger, layer, layers)
  const absWorking = workingDir && workingDir !== '/' ? resolve(workingDir) : null
  if (absWorking && absWorking !== home) {
    for (const dir of await projectChain(absWorking, home)) {
      layer++
      for (const s of await scanScope(dir, 'project', logger)) {
        claimSkill(byName, s, logger, layer, layers)
      }
    }
  }
  return [...byName.values()]
    .map((skill) => (lock.stripHooks ? withoutHooks(skill) : skill))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * A skill whose frontmatter `hooks` may not run: it loses them and, as in Claude Code, its
 * `allowed-tools` pre-approval too, unless it runs forked in a subagent.
 */
function withoutHooks(skill: DiscoveredSkill): DiscoveredSkill {
  if (skill.hooks === undefined) return skill
  const { hooks: _hooks, allowedTools, ...rest } = skill
  return allowedTools && skill.contextFork ? { ...rest, allowedTools } : rest
}

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i

/** The SKILL.md of an already-existing skill of this name under `base`, else null. */
async function findSkillFile(
  base: string,
  name: string,
): Promise<{ file: string; safetyRoot: string } | null> {
  const file = join(skillRoot(base), name, 'SKILL.md')
  try {
    await fs.access(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const [canonicalRoot, canonicalFile] = await Promise.all([fs.realpath(base), fs.realpath(file)])
  if (!isPathWithin(canonicalRoot, canonicalFile)) {
    throw new Error(`Refusing to edit skill through escaping symlink: ${file}`)
  }
  return { file, safetyRoot: canonicalRoot }
}

async function nearestExistingAncestor(path: string): Promise<string> {
  let current = path
  while (true) {
    try {
      return await fs.realpath(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

async function requireSafeSkillWriteDir(safetyRoot: string, skillDir: string): Promise<void> {
  const [canonicalRoot, canonicalAncestor] = await Promise.all([
    fs.realpath(safetyRoot),
    nearestExistingAncestor(skillDir),
  ])
  if (!isPathWithin(canonicalRoot, canonicalAncestor)) {
    throw new Error(`Refusing to write skill through escaping symlink: ${skillDir}`)
  }
  await fs.mkdir(skillDir, { recursive: true })
  const canonicalDir = await fs.realpath(skillDir)
  if (!isPathWithin(canonicalRoot, canonicalDir)) {
    throw new Error(`Refusing to write skill through escaping symlink: ${skillDir}`)
  }
}

/**
 * Writes a skill's SKILL.md under the given base dir. `base` is the project working
 * dir for project skills, or the home dir for global skills. Returns the skill dir.
 *
 * This is the ONE write choke point — the Settings UI (`createSkill`) and the agent's
 * `Skill` tool both funnel through it — so both get the same two guarantees:
 *
 *  - It EDITS IN PLACE inside `.claude/skills`, the tree shared with Claude Code.
 *  - It PRESERVES frontmatter. Callers hand over `name`/`description`/`content` — that
 *    is all a `SkillInput` can express — and it used to render the frontmatter from
 *    exactly those, which silently deleted `argument-hint`, `user-invocable`,
 *    `allowed-tools`, `hooks`, and any key we do not model, on every edit. The file
 *    owns those keys; we merge into it rather than replace it.
 */
/**
 * Where a `skill` save/delete lands by default, given its base dir.
 *
 * Exported because the PERMISSION path needs the same answer the writer uses: without it
 * `extractCallFacts` reported no targets for `skill`, so a `scope:"global"` save — which
 * writes under `homedir()`, outside the workspace — resolved to `outsideWorkspace=false`
 * and the confirmation prompt never saw it. Deriving the path in two places is exactly how
 * `patch-scope` drifted from the patch parser and opened the same kind of hole, so there is
 * one definition and both callers use it. An EXISTING skill file may sit elsewhere (see
 * `findSkillFile`); the gate is pre-execution and cannot await that lookup, so it judges
 * the default location — the one a save creates when there is nothing to update.
 */
export function defaultSkillFilePath(base: string, name: string): string {
  return join(skillRoot(base), name, 'SKILL.md')
}

export async function writeSkillFile(
  base: string,
  input: { name: string; description: string; content: string },
  scope: SkillScanScope,
  /**
   * Where the skill is kept: when given, a NEW skill is recorded as created in Localix (Claude
   * Code shares the folder and Localix cannot see its use, so only these are archived on idle).
   */
  authored?: { projectId: string },
): Promise<string> {
  if (!SKILL_NAME_RE.test(input.name)) throw new Error('Invalid skill name')
  const existing = await findSkillFile(base, input.name)
  const file = existing?.file ?? defaultSkillFilePath(base, input.name)
  const skillDir = dirname(file)
  await requireSafeSkillWriteDir(existing?.safetyRoot ?? base, skillDir)
  const existingRaw = existing ? await readSkillMarkdownFile(existing.file) : ''
  const rendered = renderSkillFile(existingRaw, input)
  assertSkillMarkdownSize(rendered, file)
  // Atomic temp+rename: a crash mid-write must never leave a half-written SKILL.md.
  // This is the ONE skill-write choke point, so the frontmatter-merge it just
  // computed (read-modify-write) lands whole or not at all.
  await atomicWriteFile(file, rendered)
  if (!existing && authored) recordSkillAuthored(input.name, scope, authored.projectId)
  return skillDir
}

/** Deletes a skill directory found by name within the working dir / home scope. */
export async function deleteSkillByName(workingDir: string | null, name: string): Promise<boolean> {
  const all = await discoverFilesystemSkills(workingDir)
  const skill = all.find((s) => s.name === name)
  if (!skill) return false
  const base = skill.scope === 'global' ? homedir() : workingDir
  // Portable project procedures are read sources, not owned by the Localix manager.
  if (!base || !isPathWithin(skillRoot(base), skill.path)) return false
  await fs.rm(skill.dir, { recursive: true, force: true })
  return true
}
