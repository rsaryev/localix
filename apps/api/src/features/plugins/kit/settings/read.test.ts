import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readClaudeSettings, readClaudeSettingsSync } from './read'

let dirs: string[] = []
const temp = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kit-settings-')))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})
const write = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
}

function fixture() {
  const homeDir = temp()
  const cwd = temp()
  const managedDir = temp()
  return {
    homeDir,
    cwd,
    managedDir,
    input: { homeDir, cwd, env: {}, managed: { dir: managedDir } },
  }
}

describe('readClaudeSettingsSync', () => {
  test('the user, project, local and managed files, lowest first, with their anchors', () => {
    const { homeDir, cwd, managedDir, input } = fixture()
    write(join(homeDir, '.claude', 'settings.json'), { model: 'opus' })
    write(join(cwd, '.claude', 'settings.json'), { outputStyle: 'Explanatory' })
    write(join(cwd, '.claude', 'settings.local.json'), { agent: 'helper' })
    write(join(managedDir, 'managed-settings.json'), { disableAllHooks: true })
    const settings = readClaudeSettingsSync(input)
    expect(settings.files.map((one) => [one.scope, one.anchorDir])).toEqual([
      ['user', join(homeDir, '.claude')],
      ['project', cwd],
      ['local', cwd],
      ['managed', cwd],
    ])
    expect(settings.view.merged()).toMatchObject({
      model: 'opus',
      outputStyle: 'Explanatory',
      agent: 'helper',
      disableAllHooks: true,
    })
    expect(settings.layers.map((layer) => layer.scope)).toEqual([
      'managed',
      'local',
      'project',
      'user',
    ])
  })

  test('trust is read from the state file under the repository root', () => {
    const { homeDir, cwd, input } = fixture()
    mkdirSync(join(cwd, '.git'))
    write(join(homeDir, '.claude.json'), { projects: { [cwd]: { hasTrustDialogAccepted: true } } })
    expect(readClaudeSettingsSync({ ...input, cwd: join(cwd, 'src') }).trusted).toBe(true)
    expect(readClaudeSettingsSync({ ...input, cwd: temp() }).trusted).toBe(false)
  })
})

describe('readClaudeSettings', () => {
  test('the MDM profile wins first-wins over the file policy', async () => {
    const { managedDir, input } = fixture()
    write(join(managedDir, 'managed-settings.json'), { agent: 'file' })
    const readMdm = async () => ({ model: 'sonnet' })
    const settings = await readClaudeSettings({ ...input, managed: { dir: managedDir, readMdm } })
    const managed = settings.files.find((one) => one.scope === 'managed')
    expect(managed?.settings).toEqual({ model: 'sonnet' })
  })

  test('no managed source reads none', async () => {
    const { input } = fixture()
    const settings = await readClaudeSettings({ ...input, managed: null })
    expect(settings.managed).toBeUndefined()
  })
})
