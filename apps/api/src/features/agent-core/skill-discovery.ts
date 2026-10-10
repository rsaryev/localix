import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isPathWithin } from '../../lib/path-containment'
import { type DiscoveredSkill, renderSkillFile } from './skill-frontmatter'
import { scanScope, skillRoot, type SkillScanLogger, type SkillScanScope } from './skill-scan'
import { assertSkillMarkdownSize, readSkillMarkdownFile } from './skill-file'
import { atomicWriteFile } from './tools/file/file-io'

/**
 * Filesystem skill store — the portable `SKILL.md` format used by the open
 * agent-skills ecosystem (agentskills.io, Claude Code). Skills are
 * directories so they can carry scripts and other assets alongside the prompt:
 *
 *   <root>/.localix/skills/<name>/SKILL.md   (+ optional scripts, templates, …)
 *   <project>/.agents/skills/<name>/SKILL.md (portable read source)
 *
 * This module owns the RESOLUTION policy and the write side. Resolution is
 * exact-scope: sessions without a project read PERSONAL (home) skills; project
 * sessions read the exact project working directory, then personal Localix skills. Writes
 * and deletes remain in `.localix/skills`; portable skills can be shadowed by a native copy.
 * Nothing is stored in
 * a DB — skills are just files the agent (or the user) can create/edit/ship.
 *
 * How a base dir is READ (the SKILL.md directory format, symlinks, archives)
 * lives in `skill-scan.ts`; the pure parsing
 * layer (frontmatter → DiscoveredSkill) in `skill-frontmatter.ts`. Both re-export
 * their public surface here, so callers keep one import path.
 */
export type { DiscoveredSkill } from './skill-frontmatter'
export { parseMarkdownFrontmatter, scalarField, splitTokenList } from './skill-frontmatter'
export { skillRoot, readSkillsFromRoot } from './skill-scan'

/** Minimal warning sink shared with the API's existing feature-level logger contracts. */
export type SkillDiscoveryLogger = SkillScanLogger

const quietSkillDiscoveryLogger: SkillDiscoveryLogger = { warn: () => {} }

/** Bound pathological working-directory ancestry while preserving normal monorepo walks. */
function claimSkill(
  byName: Map<string, DiscoveredSkill>,
  skill: DiscoveredSkill,
  logger: SkillDiscoveryLogger,
): void {
  const winner = byName.get(skill.name)
  if (!winner) {
    byName.set(skill.name, skill)
    return
  }
  // A project skill shadowing a personal one of the same name is the DECLARED precedence,
  // not a collision: the nearer definition wins, which is the point of being able to keep a
  // repository's own version. Warning about it would fire on every session in such a project
  // and train the reader to ignore the one warning that does mean something — two skills of
  // the same name in the same place.
  if (winner.scope !== skill.scope) return
  logger.warn(
    `[skills] duplicate name "${skill.name}": keeping "${winner.path}", ignoring "${skill.path}"`,
    { skillName: skill.name, winnerPath: winner.path, loserPath: skill.path },
  )
}

/**
 * Every skill visible from here: the working directory's own, then the personal ones.
 *
 * Both, project first — a repository's own skill shadows a personal one of the same name. It
 * used to be a CHOICE between the two, so opening a project hid every skill you had written
 * for yourself and nothing said why.
 */
export async function discoverFilesystemSkills(
  workingDir?: string | null,
  homeDir?: string, // injectable for tests; defaults to the OS home dir
  // Libraries must not claim the host terminal. Production composition injects
  // its structured logger; tests/standalone consumers stay quiet by default.
  logger: SkillDiscoveryLogger = quietSkillDiscoveryLogger,
): Promise<DiscoveredSkill[]> {
  const byName = new Map<string, DiscoveredSkill>()
  const home = homeDir ?? homedir()

  // BOTH, project first so a repository's own skill shadows a personal one of the same name.
  //
  // It used to be a choice — a project saw only its own skills, a project-less session only
  // the personal ones — which meant a skill you wrote for yourself vanished the moment you
  // opened a project, with nothing on screen saying why. Where a skill LIVES decides who it
  // travels with (a repository's skills ship with the repository); it should not decide
  // whether you can use your own.
  const absWorking = workingDir && workingDir !== '/' ? resolve(workingDir) : null
  if (absWorking && absWorking !== home) {
    for (const s of await scanScope(absWorking, 'project', logger)) {
      claimSkill(byName, s, logger)
    }
  }
  for (const s of await scanScope(home, 'global', logger)) {
    claimSkill(byName, s, logger)
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
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
 * `skill` tool both funnel through it — so both get the same two guarantees:
 *
 *  - It EDITS IN PLACE inside the Localix-owned `.localix/skills` tree.
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
  return join(base, '.localix/skills', name, 'SKILL.md')
}

export async function writeSkillFile(
  base: string,
  input: { name: string; description: string; content: string },
  _scope: SkillScanScope,
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
