import { describe, it, expect } from 'bun:test'

import {
  marketplaceEntrySchema,
  marketplaceSchema,
  resolveEntryName,
  validateMarketplace,
} from './marketplace'
import { buildMarketplaceManifest } from './marketplace-build'

describe('validateMarketplace', () => {
  it('accepts a well-formed catalog', () => {
    const { errors, warnings } = validateMarketplace({
      name: 'localix',
      owner: { name: 'Localix' },
      plugins: [{ name: 'web', source: './web', description: 'web tools' }],
    })
    expect(errors).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })

  it('accepts the Claude Code shape (object author/owner + object git-subdir source)', () => {
    const { errors } = validateMarketplace({
      $schema: 'https://anthropic.com/claude-code/marketplace.schema.json',
      name: 'official-plugins',
      owner: { name: 'Anthropic', email: 'support@anthropic.com' },
      plugins: [
        {
          name: 'a',
          author: { name: 'X' },
          category: 'security',
          source: {
            source: 'git-subdir',
            url: 'https://x/y.git',
            path: 'plugins/a',
            ref: 'v1',
            sha: 'abc',
          },
        },
        { name: 'b', source: './plugins/b', category: 'development' },
      ],
    })
    expect(errors).toHaveLength(0)
  })

  it('accepts an npm entry source without warnings or errors (npm is supported)', () => {
    const { errors, warnings } = validateMarketplace({
      name: 'm',
      owner: 'x',
      plugins: [{ name: 'pkg', source: { source: 'npm', package: '@scope/pkg' } }],
    })
    expect(errors).toHaveLength(0)
    expect(warnings.some((w) => w.includes('npm'))).toBe(false)
  })

  it('preserves CC entry component overrides (passthrough, not stripped)', () => {
    const raw = {
      name: 'm',
      owner: 'x',
      plugins: [{ name: 'p', source: './p', commands: ['./extra.md'], hooks: './hooks.json' }],
    }
    const { errors } = validateMarketplace(raw)
    expect(errors).toHaveLength(0)
  })

  it('errors on a missing name', () => {
    const { errors } = validateMarketplace({ plugins: [] })
    expect(errors.some((e) => e.includes('name'))).toBe(true)
  })

  it('errors on a duplicate plugin name', () => {
    const { errors } = validateMarketplace({
      name: 'm',
      owner: 'x',
      plugins: [
        { name: 'dup', source: './a' },
        { name: 'dup', source: './b' },
      ],
    })
    expect(errors.some((e) => e.includes('duplicate plugin name "dup"'))).toBe(true)
  })

  it('errors on path traversal in a string source and an object source.path', () => {
    const strRes = validateMarketplace({
      name: 'm',
      owner: 'x',
      plugins: [{ name: 'a', source: '../escape' }],
    })
    expect(strRes.errors.some((e) => e.includes('..') && e.includes('plugins[0].source'))).toBe(
      true,
    )
    const objRes = validateMarketplace({
      name: 'm',
      owner: 'x',
      plugins: [{ name: 'a', source: { source: 'git-subdir', path: '../escape' } }],
    })
    expect(
      objRes.errors.some((e) => e.includes('..') && e.includes('plugins[0].source.path')),
    ).toBe(true)
  })

  it('warns on an empty catalog and a missing owner', () => {
    const { warnings } = validateMarketplace({ name: 'm', plugins: [] })
    expect(warnings.some((w) => w.includes('no plugins'))).toBe(true)
    expect(warnings.some((w) => w.includes('owner'))).toBe(true)
  })

  it('rejects a non-object manifest', () => {
    expect(validateMarketplace('nope').errors).toHaveLength(1)
  })

  it('accepts a renames map (old→new and old→null) without errors', () => {
    const { errors, warnings } = validateMarketplace({
      name: 'm',
      owner: 'x',
      plugins: [{ name: 'new-name', source: './new-name' }],
      renames: { 'old-name': 'new-name', 'removed-plugin': null },
    })
    expect(errors).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })

  it('warns on a dangling rename target and a shadowed old name', () => {
    const { errors, warnings } = validateMarketplace({
      name: 'm',
      owner: 'x',
      plugins: [{ name: 'still-here', source: './still-here' }],
      renames: { ghost: 'nowhere', 'still-here': 'elsewhere' },
    })
    expect(errors).toHaveLength(0)
    expect(warnings.some((w) => w.includes('renames.ghost') && w.includes('nowhere'))).toBe(true)
    expect(warnings.some((w) => w.includes('renames.still-here') && w.includes('shadows'))).toBe(
      true,
    )
  })

  it('rejects a non-string rename value that is not null', () => {
    const { errors } = validateMarketplace({
      name: 'm',
      owner: 'x',
      plugins: [],
      renames: { old: 42 },
    })
    expect(errors.some((e) => e.includes('renames'))).toBe(true)
  })
})

describe('resolveEntryName (renames)', () => {
  const market = marketplaceSchema.parse({
    name: 'm',
    plugins: [{ name: 'new-name', source: './new-name' }],
    renames: { 'old-name': 'new-name', 'removed-plugin': null },
  })

  it('passes an unmapped name through unchanged', () => {
    expect(resolveEntryName(market, 'new-name')).toEqual({ name: 'new-name' })
  })

  it('maps an old name to the new one with renamedFrom', () => {
    expect(resolveEntryName(market, 'old-name')).toEqual({
      name: 'new-name',
      renamedFrom: 'old-name',
    })
  })

  it('throws "removed from marketplace" for a null-mapped name', () => {
    expect(() => resolveEntryName(market, 'removed-plugin')).toThrow('removed from marketplace "m"')
  })

  it('is a no-op when the catalog has no renames', () => {
    expect(resolveEntryName({ name: 'm' }, 'anything')).toEqual({ name: 'anything' })
  })
})

describe('marketplace entry relevance (typed)', () => {
  it('parses filePatterns/directoryNames/keywords typed (not just passthrough)', () => {
    const entry = marketplaceEntrySchema.parse({
      name: 'infra',
      source: './infra',
      relevance: {
        filePatterns: ['**/*.tf'],
        directoryNames: ['terraform'],
        keywords: ['infra', 'iac'],
      },
    })
    // Typed access — no casts through unknown.
    expect(entry.relevance?.filePatterns).toEqual(['**/*.tf'])
    expect(entry.relevance?.directoryNames).toEqual(['terraform'])
    expect(entry.relevance?.keywords).toEqual(['infra', 'iac'])
  })

  it('rejects a malformed relevance block (non-array filePatterns)', () => {
    const res = marketplaceEntrySchema.safeParse({
      name: 'x',
      source: './x',
      relevance: { filePatterns: 'not-an-array' },
    })
    expect(res.success).toBe(false)
  })
})

describe('buildMarketplaceManifest', () => {
  it('emits ./<name> sources and validates clean', () => {
    const market = buildMarketplaceManifest({
      name: 'localix',
      description: 'Bundled plugins',
      owner: { name: 'Localix' },
      renames: { 'old-ops': 'new-ops' },
      plugins: [
        { name: 'new-ops', description: 'operations' },
        { name: 'browser', description: 'browser', version: '1.0.0', author: 'localix' },
        { name: 'git-checkpoint', description: 'checkpoints' },
      ],
    })
    expect(market.$schema).toBe('https://json.schemastore.org/claude-code-marketplace.json')
    expect(market.renames).toEqual({ 'old-ops': 'new-ops' })
    expect(market.plugins[1]).toMatchObject({
      name: 'browser',
      source: './browser',
      version: '1.0.0',
    })
    expect(market.plugins[2].source).toBe('./git-checkpoint')
    const { errors, warnings } = validateMarketplace(market)
    expect(errors).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })
})
