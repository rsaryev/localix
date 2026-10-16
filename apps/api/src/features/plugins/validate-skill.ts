import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import type { DiscoveredPlugin } from './discovery'
import { pathExists } from './discovery'
import type { PluginValidation } from './contracts'
import { validateSkillFile } from '../agent-core/skill-validate'

/**
 * Plugin-scoped SKILL.md validation. The pure per-file validator lives in
 * agent-core (`skill-validate.ts`); this module folds it over the skills a plugin bundles.
 */
/**
 * Validate every bundled skill a plugin declares (`<skillDir>/<name>/SKILL.md` for
 * each subdir of each resolved skill root), merging the per-skill outcomes.
 */
export async function validatePluginSkills(plugin: DiscoveredPlugin): Promise<PluginValidation> {
  // Process all skill dirs in parallel — independent validation.
  const allResults = await Promise.all(
    plugin.entrypoints.skillDirs.map(async (root) => {
      const rootSkillMd = join(root, 'SKILL.md')
      let subdirs: string[] = []
      try {
        subdirs = (await fs.readdir(root, { withFileTypes: true })).flatMap((e) =>
          e.isDirectory() ? [e.name] : [],
        )
      } catch {
        /* missing root — no subdirs */
      }
      // Check all SKILL.md paths in parallel (root + subdirs).
      const checks = await Promise.all([
        pathExists(rootSkillMd).then((ok) => (ok ? rootSkillMd : null)),
        ...subdirs.map((sub) => {
          const p = join(root, sub, 'SKILL.md')
          return pathExists(p).then((ok) => (ok ? p : null))
        }),
      ])
      return Promise.all(checks.filter((p): p is string => p !== null).map(validateSkillFile))
    }),
  )
  const results = allResults.flat()
  return {
    errors: results.flatMap((r) => r.errors),
    warnings: results.flatMap((r) => r.warnings),
  }
}
