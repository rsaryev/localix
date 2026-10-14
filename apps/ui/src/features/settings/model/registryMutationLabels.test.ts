import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

test('extension registries announce exact mutation actions', () => {
  const plugins = read('./usePlugins.ts')
  const agents = read('./useAgents.ts')
  const sources = [plugins, agents].join('\n')

  expect(sources).toContain("'Disabling'")
  expect(sources).toContain("'Enabling'")
  expect(sources).toContain('Removing')
  expect(sources).toContain('Saving settings for')
  expect(agents).toContain('Creating')
})
