/**
 * A `SKILL.md` at a plugin's root (plugins/manifest-reference, "Standard layout"): it loads as the
 * plugin's one skill only when there is no `skills/` folder and no `skills` key, and a folder that
 * holds `SKILL.md` directly is one skill, not a folder of skills.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { readSkillsFromRoot } from '../agent-core/skill-scan'
import { resolveEntrypoints } from './discovery-entrypoints'
import type { PluginManifest } from './contracts'

const dir = tempDirPerTest('root-skill-')
const skill = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\nDo ${name}.\n`

function plugin(files: Record<string, string>): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir(), path)), { recursive: true })
    writeFileSync(join(dir(), path), text)
  }
  return dir()
}

async function skillNames(root: string, manifest: Partial<PluginManifest> = {}) {
  const { skillDirs } = await resolveEntrypoints(root, { name: 'p', ...manifest } as PluginManifest)
  const skills = await Promise.all(
    skillDirs.map((skillDir) => readSkillsFromRoot(skillDir, 'global')),
  )
  return skills
    .flat()
    .map((found) => found.name)
    .sort()
}

describe("a plugin's root SKILL.md", () => {
  test('is the plugin’s one skill when nothing else declares skills', async () => {
    expect(await skillNames(plugin({ 'SKILL.md': skill('solo') }))).toEqual(['solo'])
  })

  test('is not loaded beside a skills/ folder', async () => {
    const root = plugin({
      'SKILL.md': skill('readme-ish'),
      'skills/review/SKILL.md': skill('review'),
    })
    expect(await skillNames(root)).toEqual(['review'])
  })

  test('is not loaded when the manifest lists skills', async () => {
    const root = plugin({
      'SKILL.md': skill('readme-ish'),
      'extra/deploy/SKILL.md': skill('deploy'),
    })
    expect(await skillNames(root, { skills: ['./extra'] })).toEqual(['deploy'])
  })

  test('a listed folder holding SKILL.md directly is one skill, its subfolders not scanned', async () => {
    const root = plugin({ 'SKILL.md': skill('root'), 'examples/demo/SKILL.md': skill('demo') })
    expect(await skillNames(root, { skills: ['./'] })).toEqual(['root'])
  })
})
