import { afterEach, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { seedKanban } from './kanban-workbenches.mjs'

const roots = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function setup(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-kanban-capture-'))
  roots.push(root)
  const fixture = { root, projectId: 'fixture-project', sessionId: 'fixture-chat' }
  const requests = []
  return {
    fixture,
    requests,
    dependencies: {
      verifyRuntime: async () => {},
      request: async (route, body) => {
        requests.push({ route, body })
        if (route.startsWith('/sessions/'))
          return { projectId: overrides.projectId ?? fixture.projectId }
        if (route.startsWith('/projects/')) return { workingDir: overrides.workingDir ?? root }
        return { tasks: overrides.tasks ?? [] }
      },
    },
  }
}

test('refuses a runtime identity failure before reading or writing fixture data', async () => {
  const { fixture, dependencies, requests } = await setup()
  dependencies.verifyRuntime = async () => {
    throw new Error('Wrong runtime identity')
  }
  await expect(seedKanban(fixture, dependencies)).rejects.toThrow('Wrong runtime identity')
  expect(requests).toHaveLength(0)
})

test('refuses a chat in another project before reading its board', async () => {
  const { fixture, dependencies, requests } = await setup({ projectId: 'another-project' })
  await expect(seedKanban(fixture, dependencies)).rejects.toThrow('dedicated fixture project')
  expect(requests.every(({ body, route }) => !body && !route.startsWith('/kanban'))).toBe(true)
})

test('refuses a project outside the canonical fixture root before reading its board', async () => {
  const { fixture, dependencies, requests } = await setup({ workingDir: os.tmpdir() })
  await expect(seedKanban(fixture, dependencies)).rejects.toThrow('dedicated fixture project')
  expect(requests.every(({ body, route }) => !body && !route.startsWith('/kanban'))).toBe(true)
})

test('leaves a board with an unrelated card untouched', async () => {
  const { fixture, dependencies, requests } = await setup({ tasks: [{ title: 'Private work' }] })
  await expect(seedKanban(fixture, dependencies)).rejects.toThrow('unrelated cards')
  expect(requests.every(({ body }) => !body)).toBe(true)
  expect(requests.filter(({ route }) => route.startsWith('/kanban'))).toHaveLength(1)
})
