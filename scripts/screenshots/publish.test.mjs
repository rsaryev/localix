import { afterEach, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { publishCaptures } from './publish.mjs'

const roots = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})
async function fixture(
  record = { key: 'agents/context-and-limits', date: '2026-10-08', passed: true },
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-publish-test-'))
  roots.push(root)
  const repository = path.join(root, 'repo')
  const run = path.join(root, 'run')
  await fs.mkdir(path.join(repository, 'docs/features'), { recursive: true })
  await fs.mkdir(path.join(run, 'agents'), { recursive: true })
  await fs.writeFile(
    path.join(repository, 'docs/public-nav.json'),
    JSON.stringify({ sections: [{ pages: ['features/agents.md'] }] }),
  )
  const guide = path.join(repository, 'docs/features/agents.md')
  await fs.writeFile(
    guide,
    '![Agent](../assets/screenshots/agents/context-and-limits--2026-10-06.png)\n\n![Other](../assets/screenshots/workspace/hero--2026-10-07.png)\n',
  )
  const image = path.join(run, 'agents/context-and-limits--2026-10-08.png')
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(4800, 16)
  bytes.writeUInt32BE(3000, 20)
  await fs.writeFile(image, bytes)
  await fs.writeFile(`${image}.json`, JSON.stringify(record))
  return { repository, run, guide, bytes, image }
}

test('publishes unchanged pixels under the stable semantic key and updates only its references', async () => {
  const { repository, run, guide, bytes } = await fixture()
  expect(await publishCaptures(run, { repository })).toEqual([
    { key: 'agents/context-and-limits', date: '2026-10-08' },
  ])
  expect(
    await fs.readFile(
      path.join(repository, 'docs/assets/screenshots/agents/context-and-limits--2026-10-08.png'),
    ),
  ).toEqual(bytes)
  const content = await fs.readFile(guide, 'utf8')
  expect(content).toContain('context-and-limits--2026-10-08.png')
  expect(content).toContain('workspace/hero--2026-10-07.png')
})

test('rejects mismatched keys and failed evidence before changing documentation', async () => {
  for (const record of [
    { key: '../escape', date: '2026-10-08', passed: true },
    { key: 'agents/context-and-limits', date: '2026-10-08', passed: false },
    { key: 'agents/context-and-limits', date: '2026-10-09', passed: true },
  ]) {
    const { run, repository, guide } = await fixture(record)
    await expect(publishCaptures(run, { repository })).rejects.toThrow('Invalid capture evidence')
    expect(await fs.readFile(guide, 'utf8')).toContain('context-and-limits--2026-10-06.png')
  }
})

test('refuses an undersized capture even when the behavior test passed', async () => {
  const { run, repository, bytes, image } = await fixture()
  bytes.writeUInt32BE(1600, 16)
  bytes.writeUInt32BE(1000, 20)
  await fs.writeFile(image, bytes)
  await expect(publishCaptures(run, { repository })).rejects.toThrow('native 4800×3000')
})
