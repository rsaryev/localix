import { describe, expect, test } from 'bun:test'

import { readMarketplace } from './read'

const SHA = 'a'.repeat(64)
const KEY = Buffer.alloc(32, 7).toString('base64')

const archive = (name: string, version = '1.0.0') => ({
  source: 'archive' as const,
  url: `${name}-${version}.tar.gz`,
  bytes: 1200,
  sha256: SHA,
})

const released = (apps: unknown[], extra: Record<string, unknown> = {}) => ({
  schema: 3,
  name: 'ada',
  owner: { name: 'Ada Lovelace', email: 'ada@example.com' },
  metadata: { description: "Ada's mini apps." },
  published: '2026-10-30T12:00:00.000Z',
  signingKeys: [KEY],
  apps,
  ...extra,
})

const read = (raw: unknown) => {
  const result = readMarketplace(raw)
  if (result.kind !== 'marketplace') throw new Error(`not read: ${JSON.stringify(result)}`)
  return result.marketplace
}

describe('a released marketplace, as Localix reads it', () => {
  test('says who keeps it, when it was made, the keys of its next release, and its apps', () => {
    const marketplace = read(
      released([
        {
          name: 'notes',
          displayName: 'Notes',
          description: 'Notes beside every chat.',
          category: 'utilities',
          version: '1.2.0',
          apiVersion: 2,
          source: archive('notes', '1.2.0'),
          icon: { url: 'notes-icon.svg', bytes: 700, sha256: SHA, type: 'image/svg+xml' },
          screenshots: [
            { url: 's1.png', bytes: 9, sha256: SHA, type: 'image/png', caption: 'A note' },
          ],
          readme: { url: 'notes-readme.md', bytes: 40, sha256: SHA },
          tags: ['notes', 'writing'],
          homepage: 'https://github.com/ada/notes',
          license: 'MIT',
          author: { name: 'Ada Lovelace' },
          surfaces: ['agent', 'workbench'],
          commands: ['new'],
          fileAssociations: [
            { ext: ['note'], name: 'Note', role: 'Editor' },
            { ext: ['md'], name: 'Markdown', rank: 'None' },
          ],
        },
      ]),
    )
    expect(marketplace).toEqual({
      schema: 3,
      name: 'ada',
      owner: { name: 'Ada Lovelace', email: 'ada@example.com' },
      description: "Ada's mini apps.",
      published: '2026-10-30T12:00:00.000Z',
      signingKeys: [KEY],
      apps: [
        {
          name: 'notes',
          displayName: 'Notes',
          description: 'Notes beside every chat.',
          category: 'utilities',
          version: '1.2.0',
          apiVersion: 2,
          source: archive('notes', '1.2.0'),
          icon: { url: 'notes-icon.svg', bytes: 700, sha256: SHA, type: 'image/svg+xml' },
          screenshots: [
            { url: 's1.png', bytes: 9, sha256: SHA, type: 'image/png', caption: 'A note' },
          ],
          readme: { url: 'notes-readme.md', bytes: 40, sha256: SHA },
          tags: ['notes', 'writing'],
          homepage: 'https://github.com/ada/notes',
          license: 'MIT',
          author: 'Ada Lovelace',
          surfaces: ['agent', 'workbench'],
          commands: ['new'],
          // What it opens, without a kind it asks not to be offered for.
          opens: ['note'],
          curation: {},
        },
      ],
      collections: [],
      blockedArchives: [],
    })
  })

  test('a linked app is where it lives, with what the list says about it', () => {
    const { apps } = read(
      released([
        {
          name: 'habits',
          source: { source: 'github', repo: 'grace/habits' },
          description: 'Track daily habits with the agent.',
          category: 'utilities',
          homepage: 'https://github.com/grace/habits',
        },
        { name: 'timer', source: { source: 'url', url: 'https://grace.example/m.json' } },
      ]),
    )
    expect(apps).toEqual([
      {
        name: 'habits',
        source: { source: 'github', repo: 'grace/habits' },
        description: 'Track daily habits with the agent.',
        category: 'utilities',
        homepage: 'https://github.com/grace/habits',
        curation: {},
      },
      {
        name: 'timer',
        source: { source: 'url', url: 'https://grace.example/m.json' },
        curation: {},
      },
    ])
  })

  test("the keeper's curation stays on each app, and rows name apps by identity", () => {
    const marketplace = read(
      released(
        [
          {
            name: 'database',
            source: archive('database'),
            version: '1.0.0',
            featured: true,
            installByDefault: true,
            suggestFor: { files: ['*.sql'], dependencies: ['pg'] },
          },
        ],
        {
          collections: [{ id: 'data', title: 'Data', items: ['database', 'plugin:neon@official'] }],
        },
      ),
    )
    expect(marketplace.apps[0]!.curation).toEqual({
      featured: true,
      installByDefault: true,
      suggestFor: { files: ['*.sql'], dependencies: ['pg'] },
    })
    expect(marketplace.collections).toEqual([
      {
        id: 'data',
        title: 'Data',
        style: 'row',
        items: [
          { kind: 'mini-app', id: 'database@ada' },
          { kind: 'plugin', id: 'neon@official' },
        ],
      },
    ])
  })

  test('a revoked app says why and which versions; revoked whole, it needs no source', () => {
    const { apps } = read(
      released([
        { name: 'gone', revoked: { reason: 'Sends notes away.' } },
        {
          name: 'notes',
          version: '1.3.0',
          source: archive('notes', '1.3.0'),
          revoked: { reason: 'A broken migration.', versions: ['1.2.0'] },
        },
        { name: 'nowhere' },
      ]),
    )
    expect(apps.map(({ name, revoked, source }) => ({ name, revoked, has: !!source }))).toEqual([
      { name: 'gone', revoked: { reason: 'Sends notes away.' }, has: false },
      { name: 'notes', revoked: { reason: 'A broken migration.', versions: ['1.2.0'] }, has: true },
    ])
  })

  test('archives blocked whatever marketplace they came from', () => {
    const { blockedArchives } = read(
      released([], {
        blockedArchives: [
          { sha256: SHA, reason: 'Malware.' },
          { sha256: 'not-a-hash', reason: 'x' },
          { sha256: 'b'.repeat(64) },
        ],
      }),
    )
    expect(blockedArchives).toEqual([{ sha256: SHA, reason: 'Malware.' }])
  })
})

describe('what Localix does with a marketplace it cannot fully read', () => {
  test('a field that does not read is dropped alone: a bad icon keeps its app', () => {
    const { apps } = read(
      released([
        {
          name: 'notes',
          version: '1.0.0',
          source: archive('notes'),
          icon: { url: 'x.svg', bytes: -1, sha256: SHA, type: 'image/svg+xml' },
          tags: ['ok', 'Not A Tag', 3],
          homepage: 'http://insecure.example',
          featured: 'yes',
        },
      ]),
    )
    expect(apps).toEqual([
      { name: 'notes', version: '1.0.0', source: archive('notes'), tags: ['ok'], curation: {} },
    ])
  })

  test('an app that does not read is left out and the rest load; a folder is not installable', () => {
    const { apps } = read(
      released([
        { name: 'bad name!', source: archive('x') },
        { name: 'source-form', source: './apps/source-form' },
        { name: 'unpinned', source: { source: 'archive', url: 'u.tar.gz' } },
        { name: 'ok', version: '1.0.0', source: archive('ok') },
      ]),
    )
    expect(apps.map((app) => app.name)).toEqual(['ok'])
  })

  test('a field it does not know is passed over, at any depth', () => {
    const marketplace = read(
      released([{ name: 'ok', version: '1.0.0', source: archive('ok'), localized: { ru: {} } }], {
        sharding: { next: 'page-2.json' },
      }),
    )
    expect(marketplace.apps.map((app) => app.name)).toEqual(['ok'])
  })

  test('a published time or signing key that does not read is left out', () => {
    const marketplace = read(
      released([], { published: 'yesterday', signingKeys: ['short', KEY, 42] }),
    )
    expect(marketplace.published).toBeUndefined()
    expect(marketplace.signingKeys).toEqual([KEY])
  })

  test('a marketplace of a newer schema asks for a newer Localix rather than a guess', () => {
    expect(readMarketplace({ ...released([]), schema: 4 })).toEqual({ kind: 'newer', schema: 4 })
  })

  test('anything else is not a marketplace, and says what is missing', () => {
    expect(readMarketplace({ schema: 2, apps: [] })).toMatchObject({ kind: 'invalid' })
    expect(readMarketplace({ ...released([]), owner: {} })).toMatchObject({ kind: 'invalid' })
    expect(readMarketplace({ ...released([]), name: 'Not A Name' })).toMatchObject({
      kind: 'invalid',
    })
    expect(readMarketplace([])).toMatchObject({ kind: 'invalid' })
    const { problem } = readMarketplace({ schema: 3, name: 'ada', owner: { name: 'Ada' } }) as {
      problem: string
    }
    expect(problem).toContain('apps')
  })
})
