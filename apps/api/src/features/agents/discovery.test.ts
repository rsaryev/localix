import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverAgents, listAgentFiles, projectAgentsDir } from './discovery'
import { builtinAgentRecord } from './builtin'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'localix-native-agents-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const definition = (id: string, handle = 'reviewer') => ({
  id,
  handle,
  instructions: 'Review.',
  description: 'Reviews changes.',
})
const put = (root: string, file: string, value: unknown) =>
  writeFile(join(root, file), JSON.stringify(value))

describe('native agent discovery', () => {
  test('parses strict JSON, refuses foreign fields and ignores foreign markdown', async () => {
    const root = await fixture()
    await put(root, 'valid.json', definition('id-1'))
    await put(root, 'foreign.json', { ...definition('id-2'), tools: ['Bash'] })
    await writeFile(join(root, 'foreign.md'), '---\nname: foreign\n---\nForeign instructions.')
    expect((await listAgentFiles(root)).map((file) => file.record.id)).toEqual(['id-1'])
  })
  test('symlinks and malformed files cannot contribute definitions', async () => {
    const root = await fixture()
    const outside = await fixture()
    await put(outside, 'valid.json', definition('outside'))
    await symlink(join(outside, 'valid.json'), join(root, 'link.json'))
    await writeFile(join(root, 'broken.json'), '{')
    expect(await listAgentFiles(root)).toEqual([])
  })
  test('same handles in project and installation remain different identities', async () => {
    const globalDir = await fixture()
    const cwd = await fixture()
    const projectDir = projectAgentsDir(cwd)
    await mkdir(projectDir, { recursive: true })
    await put(globalDir, 'reviewer.json', definition('native:global:reviewer'))
    await put(projectDir, 'reviewer.json', definition('native:project:p:reviewer'))
    const global = await discoverAgents({ cwd: null, projectId: '', globalDir })
    const project = await discoverAgents({ cwd, projectId: 'p', globalDir })
    expect(global.find((agent) => agent.record.handle === 'reviewer')?.record.id).toBe(
      'native:global:reviewer',
    )
    expect(project.find((agent) => agent.record.handle === 'reviewer')?.record.id).toBe(
      'native:project:p:reviewer',
    )
    expect(project.some((agent) => agent.record.id === 'native:global:reviewer')).toBe(false)
  })
  test('installation agents join every project under their own scope', async () => {
    const globalDir = await fixture()
    const cwd = await fixture()
    await mkdir(projectAgentsDir(cwd), { recursive: true })
    await put(globalDir, 'qa.json', definition('native:global:qa', 'qa'))
    const project = await discoverAgents({ cwd, projectId: 'p', globalDir })
    expect(project.find((agent) => agent.record.handle === 'qa')).toMatchObject({
      projectId: '',
      scope: 'global',
      builtin: false,
      record: { id: 'native:global:qa' },
    })
  })
  test('project shadowing never steals a builtin identity or editing privilege', async () => {
    const cwd = await fixture()
    const dir = projectAgentsDir(cwd)
    await mkdir(dir, { recursive: true })
    await put(dir, 'localix.json', definition('native:project:p:localix', 'localix'))
    const entries = await discoverAgents({ cwd, projectId: 'p' })
    expect(entries.find((agent) => agent.record.handle === 'localix')).toMatchObject({
      builtin: false,
      record: { id: 'native:project:p:localix' },
    })
    await put(dir, 'localix.json', builtinAgentRecord('localix'))
    const refused = await discoverAgents({ cwd, projectId: 'p' })
    expect(refused.find((agent) => agent.record.handle === 'localix')?.path).toBe('')
  })
  test('a global builtin override preserves its stable ID', async () => {
    const globalDir = await fixture()
    await put(globalDir, 'localix.json', {
      ...builtinAgentRecord('localix'),
      instructions: 'Edited.',
    })
    const entries = await discoverAgents({ cwd: null, projectId: '', globalDir })
    expect(entries.filter((agent) => agent.record.handle === 'localix')).toHaveLength(1)
    expect(entries.find((agent) => agent.record.handle === 'localix')).toMatchObject({
      builtin: true,
      record: { id: 'builtin:localix', instructions: 'Edited.' },
    })
  })
  test('copying a definition file across scopes cannot copy its authority', async () => {
    const cwd = await fixture()
    const dir = projectAgentsDir(cwd)
    await mkdir(dir, { recursive: true })
    await put(dir, 'reviewer.json', definition('native:global:reviewer'))
    const entries = await discoverAgents({ cwd, projectId: 'p' })
    expect(entries.some((agent) => agent.record.id === 'native:global:reviewer')).toBe(false)
  })
  test('missing project resolution does not fall back to the installation', async () => {
    const globalDir = await fixture()
    await put(globalDir, 'reviewer.json', definition('native:global:reviewer'))
    expect(await discoverAgents({ cwd: null, projectId: 'unresolved', globalDir })).toEqual([])
  })
})
