import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createResumeService } from './service'
import { emptyDocument } from '../shared/schema'

const dirs: string[] = []
async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'resume-core-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('canonical workspace file survives a new service, and ordinary file edits invalidate a stale revision', async () => {
  const root = await workspace()
  const service = createResumeService(root)
  const created = await service.create('user', emptyDocument('CV'))
  const file = join(root, service.path(created.id))
  const content = JSON.parse(await readFile(file, 'utf8'))
  content.document.header.name = 'Test Candidate'
  await writeFile(file, JSON.stringify(content))
  const current = await createResumeService(root).get('user', created.id)
  expect(current.document.header.name).toBe('Test Candidate')
  expect(current.revision).not.toBe(created.revision)
  await expect(
    service.update('user', created.id, created.revision, [
      { op: 'metadata', value: { title: 'Old draft' } },
    ]),
  ).rejects.toMatchObject({ code: 'conflict' })
  expect((await service.get('user', created.id)).document.title).toBe('CV')
})

test('concurrent UI and agent edits have one winner, and history restoration creates a new revision', async () => {
  const root = await workspace()
  const service = createResumeService(root)
  const created = await service.create('user', emptyDocument('Initial'))
  const results = await Promise.allSettled([
    service.update(
      'user',
      created.id,
      created.revision,
      [{ op: 'metadata', value: { title: 'User edit' } }],
      'user',
    ),
    createResumeService(root).update(
      'user',
      created.id,
      created.revision,
      [{ op: 'metadata', value: { title: 'Agent edit' } }],
      'agent',
    ),
  ])
  expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1)
  const saved = await service.get('user', created.id)
  const history = await service.history('user', created.id)
  expect(history.find((record) => record.revision === created.revision)?.actor).toBe('user')
  const restored = await service.restore('user', created.id, saved.revision, created.revision)
  expect(restored.document.title).toBe('Initial')
  expect(restored.revision).not.toBe(created.revision)
  expect(
    (await service.history('user', created.id)).some(
      (record) => record.revision === saved.revision,
    ),
  ).toBe(true)
})

test('invalid hand-edited files are reported and never replaced by an empty resume', async () => {
  const root = await workspace()
  const service = createResumeService(root)
  const created = await service.create('user', emptyDocument())
  const file = join(root, service.path(created.id))
  await writeFile(file, '{broken')
  expect((await service.scan('user')).issues).toHaveLength(1)
  await expect(
    service.update('user', created.id, created.revision, [
      { op: 'metadata', value: { title: 'Overwrite' } },
    ]),
  ).rejects.toThrow()
  expect(await readFile(file, 'utf8')).toBe('{broken')
})

test('two workspaces remain separate and a symlink cannot move resume storage outside a workspace', async () => {
  const first = await workspace()
  const second = await workspace()
  const created = await createResumeService(first).create('user', emptyDocument())
  await expect(createResumeService(second).get('user', created.id)).rejects.toMatchObject({
    code: 'not_found',
  })
  await mkdir(join(second, '.localix'))
  await symlink(join(first, '.localix', 'resumes'), join(second, '.localix', 'resumes'))
  await expect(createResumeService(second).create('user', emptyDocument())).rejects.toThrow(
    'inside the workspace',
  )
})
