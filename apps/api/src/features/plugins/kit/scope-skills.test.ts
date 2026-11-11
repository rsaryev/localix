import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { scopeSkills } from './scope-skills'
import { diskPluginHost, writeTestPlugin } from './testing'

const dir = tempDirPerTest('kit-scope-skills')

async function read(plugins: Awaited<ReturnType<typeof writeTestPlugin>>[] = []) {
  const managed = join(dir(), 'managed')
  writeTree(managed, { 'managed-settings.json': '{}' })
  const home = join(dir(), 'home')
  return scopeSkills(diskPluginHost(home, { managedDirectory: managed }), {
    cwd: join(dir(), 'work'),
    homeDir: home,
    plugins,
    managed: { dir: managed },
  })
}

describe('scopeSkills', () => {
  test("lists the person's, the project's and the plugins' skills, and reads one's body", async () => {
    writeTree(join(dir(), 'home', '.claude', 'skills'), {
      'mine/SKILL.md': '---\ndescription: Mine\n---\nMy body\n',
    })
    writeTree(join(dir(), 'work'), {
      '.git/HEAD': '',
      '.claude/skills/ours/SKILL.md':
        '---\ndescription: Ours\nuser-invocable: maybe\n---\nOur body\n',
    })
    const kit = await writeTestPlugin(join(dir(), 'plugins', 'kit'), 'kit', {
      'skills/lint/SKILL.md': '---\ndescription: Lint\n---\nLint body\n',
    })
    const listed = await read([kit])
    const rows = Object.fromEntries(listed.skills.map((one) => [one.name, one]))
    expect(rows.mine?.scope).toBe('global')
    expect(rows.ours?.scope).toBe('project')
    expect(rows['kit:lint']?.plugin?.name).toBe('kit')
    expect(await listed.content('ours')).toContain('Our body')
    expect(await listed.content('nothing')).toBeUndefined()
    // A field Claude Code drops is the file's issue.
    expect(listed.issues.some((issue) => issue.path === rows.ours?.path)).toBe(true)
  })
})
