import { expect, test } from 'bun:test'

import { runMiniAppBuild } from './build-port'
import type { CreatedUserMiniApp, MiniAppAuthoring } from './service'

function authoringStub(taken: readonly string[]) {
  const calls: { built: string[]; created: { name: string; displayName?: string }[] } = {
    built: [],
    created: [],
  }
  const authoring = {
    freeName: async (_userId: string, base: string) => {
      for (let n = 1; ; n++) {
        const name = n === 1 ? base : `${base}-${n}`
        if (!taken.includes(name)) return name
      }
    },
    create: async (_userId: string, input: { name: string; displayName?: string }) => {
      calls.created.push(input)
      return {
        name: input.name,
        displayName: input.displayName ?? input.name,
        description: 'd',
        dir: `/tmp/plugins/${input.name}`,
        report: {
          ok: false,
          published: true,
          steps: [
            { title: 'template residue', ok: false, problems: ['a', 'b', 'c'] },
            { title: 'types', ok: true, problems: [] },
          ],
        },
        instruction: `Build ${input.name} out.`,
      } as unknown as CreatedUserMiniApp
    },
    build: async (name: string) => {
      calls.built.push(name)
      throw new Error('should not build')
    },
  } as unknown as MiniAppAuthoring
  return { authoring, calls }
}

// A description used to CONTINUE a generated copy of the same name, so an agent asked for a new
// plugin that picked a name the user already had rebuilt the user's old plugin.
test('a described taken name creates the next free name and never touches the existing one', async () => {
  const { authoring, calls } = authoringStub(['gpu-monitor'])
  const result = await runMiniAppBuild(authoring, 'user', {
    name: 'gpu-monitor',
    title: 'GPU Monitor',
    description: 'Show GPU temperatures',
  })
  expect(result.ok).toBe(true)
  expect(calls.built).toEqual([])
  expect(calls.created).toEqual([
    { name: 'gpu-monitor-2', description: 'Show GPU temperatures', displayName: 'GPU Monitor' },
  ] as never)
  expect(result.text).toContain('was taken, so it is "gpu-monitor-2"')
  expect(result.text).toContain('Build gpu-monitor-2 out.')
})

test('a name that is not lower-kebab is normalized instead of refused', async () => {
  const { authoring, calls } = authoringStub([])
  const result = await runMiniAppBuild(authoring, 'user', {
    name: 'GPU Monitor',
    description: 'Show GPU temperatures',
  })
  expect(result.ok).toBe(true)
  expect(calls.created[0]?.name).toBe('gpu-monitor')
  expect(result.text).toContain('not lower-kebab-case, so it is "gpu-monitor"')
})

test('a fresh copy reports its residue as a count, not the domain list again', async () => {
  const { authoring } = authoringStub([])
  const result = await runMiniAppBuild(authoring, 'user', {
    name: 'gpu-monitor',
    description: 'Show GPU temperatures',
  })
  expect(result.text).toContain('built, tested and enabled; only the template domain remains')
  expect(result.text).toContain('- template residue: 3 leftovers')
  expect(result.text).not.toMatch(/^ {4}a$/mu)
  expect(result.text).toContain('- types: ok')
})
