import { expect, test } from 'bun:test'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import type { PluginCatalog, PluginCatalogEntry } from './catalog'
import { loadManifest } from './manifest-load'
import { readCatalogPluginSkills } from './plugin-skills'

// skills.md: a command file "supports the same frontmatter" as a skill and is invoked the same way
// — by you as `/plugin:name`, and by Claude through the Skill tool unless
// `disable-model-invocation` is set. A plugin's `commands/*.md` therefore reach the model's skill
// roster and run through the skill path, with `context`, `agent`, `effort`, `hooks` and
// `user-invocable` honoured.
const root = tempDirPerTest('plugin-command-skills-')

async function catalog(): Promise<{ catalog: PluginCatalog; dir: string }> {
  const dir = join(root(), 'kit')
  writeTree(dir, {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'kit', description: 'kit plugin' }),
    'commands/review.md':
      '---\ndescription: Review the diff\ncontext: fork\nagent: Explore\neffort: high\n---\nReview $ARGUMENTS.',
    'commands/db/migrate.md': 'Migrate the database.',
    'commands/ship.md': '---\ndescription: Ship\ndisable-model-invocation: true\n---\nShip it.',
  })
  const entry: PluginCatalogEntry = {
    plugin: await loadManifest(dir, 'global', ''),
    state: undefined,
    enabled: true,
    awaitingConsent: false,
  }
  return {
    dir,
    catalog: { all: [entry], enabled: [entry], awaitingConsent: [], find: () => entry },
  }
}

test('a plugin command file is a plugin skill with its skill frontmatter', async () => {
  const { catalog: cat, dir } = await catalog()
  const skills = await readCatalogPluginSkills(cat, {
    projectId: '',
    projectDir: root(),
    homeDir: root(),
  })
  const byName = new Map(skills.map((s) => [s.fullName, s.skill]))
  expect([...byName.keys()].sort()).toEqual(['kit:db:migrate', 'kit:review', 'kit:ship'])
  expect(byName.get('kit:review')).toMatchObject({
    contextFork: true,
    forkAgent: 'Explore',
    preferredEffort: 'high',
    path: join(await realpath(dir), 'commands', 'review.md'),
  })
  expect(byName.get('kit:db:migrate')?.description).toBe('Migrate the database.')
  expect(byName.get('kit:ship')?.disableModelInvocation).toBe(true)
})
