import { describe, expect, it } from 'bun:test'

import { parseMarketplace } from './catalog'
import { entryFetchPlan, entryFolder } from './entry-source'

const owner = { name: 'o' }
const entry = (source: unknown, metadata?: Record<string, unknown>) =>
  parseMarketplace({
    name: 'shop',
    owner,
    ...(metadata ? { metadata } : {}),
    plugins: [{ name: 'p', source }],
  }).plugins[0]!

describe('entryFolder', () => {
  it('is the folder a relative source names, under metadata.pluginRoot for a bare name', () => {
    expect(entryFolder('/m', entry('./plugins/p'))).toBe('/m/plugins/p')
    expect(entryFolder('/m', entry('p', { pluginRoot: './plugins' }))).toBe('/m/plugins/p')
  })

  it('is null for a source that is fetched', () => {
    expect(entryFolder('/m', entry({ source: 'github', repo: 'o/r' }))).toBeNull()
  })

  it('refuses a folder that leaves the marketplace', () => {
    const escaping = { ...entry('./p'), source: { kind: 'relative', path: '../../etc' } } as never
    expect(() => entryFolder('/m', escaping)).toThrow('outside the marketplace')
  })
})

describe('entryFetchPlan', () => {
  it("is the kit's plan, a pinned commit kept beside its ref", () => {
    const sha = 'a'.repeat(40)
    expect(entryFetchPlan(entry({ source: 'github', repo: 'o/r', ref: 'v1', sha }))).toMatchObject({
      kind: 'git',
      ref: 'v1',
      sha,
      checkout: 'sha',
    })
  })

  it('refuses a command source, which Localix does not run', () => {
    expect(() =>
      entryFetchPlan(entry({ source: 'command', command: 'echo ./p', mode: 'copy' })),
    ).toThrow('does not run')
  })
})
