import { describe, expect, test } from 'bun:test'

import { marketplaceProblems } from './validate'

const marketplace = (apps: unknown[], extra: Record<string, unknown> = {}) => ({
  $schema: 'https://localix.ai/schemas/mini-app-marketplace/v3.json',
  schema: 3,
  name: 'ada',
  owner: { name: 'Ada Lovelace', email: 'ada@example.com' },
  metadata: { description: "Ada's mini apps." },
  apps,
  ...extra,
})

const link = {
  name: 'habits',
  source: { source: 'github', repo: 'grace/habits' },
  description: 'Track daily habits with the agent beside you.',
  category: 'utilities',
  homepage: 'https://github.com/grace/habits',
}

const curating = { curation: true }
const listing = { curation: false }

describe('a marketplace as its keeper writes it, checked before it is published', () => {
  test('folders of this repository and links to other marketplaces pass', () => {
    expect(
      marketplaceProblems(marketplace([link, { name: 'notes', source: './apps/notes' }]), listing),
    ).toEqual([])
  })

  test("the Localix marketplace's curation passes where curation is allowed", () => {
    expect(
      marketplaceProblems(
        marketplace(
          [
            {
              name: 'database',
              source: './mini-apps/database',
              featured: true,
              installByDefault: true,
              suggestFor: { files: ['*.sql'], dependencies: ['pg'] },
            },
          ],
          {
            collections: [
              { id: 'data', title: 'Data', style: 'row', items: ['database', 'plugin:neon@x'] },
            ],
            blockedArchives: [{ sha256: 'a'.repeat(64), reason: 'Malware.' }],
          },
        ),
        curating,
      ),
    ).toEqual([])
  })

  test('a field Localix does not know is an error, so a typo is found before it ships', () => {
    expect(
      marketplaceProblems(
        marketplace([{ name: 'notes', source: './apps/notes', featurd: true }], { onwer: {} }),
        curating,
      ),
    ).toEqual(['onwer: not a field of a marketplace', 'apps[0].featurd: not a field of an app'])
  })

  test('what the build writes is not written by hand', () => {
    expect(
      marketplaceProblems(
        marketplace([], { published: '2026-10-30T12:00:00Z', signingKeys: [] }),
        listing,
      ),
    ).toEqual([
      'published: written by `mini-app marketplace build`, not by hand',
      'signingKeys: written by `mini-app marketplace build`, not by hand',
    ])
  })

  test('the format version, name and owner', () => {
    expect(
      marketplaceProblems({ ...marketplace([]), schema: 2, name: 'Ada', owner: {} }, listing),
    ).toEqual([
      'schema: 3, the format this Localix writes',
      'name: lower-case words joined by dashes, 2 to 64 characters',
      'owner.name: who keeps the marketplace',
    ])
  })

  test('apps are each listed once, sorted by name', () => {
    expect(
      marketplaceProblems(
        marketplace([
          { name: 'notes', source: './apps/notes' },
          { name: 'calendar', source: './apps/calendar' },
          { name: 'notes', source: './apps/notes2' },
        ]),
        listing,
      ),
    ).toEqual([
      'apps: not sorted by name, calendar comes after notes',
      'apps[2].name: notes is listed twice',
    ])
  })

  test("a folder's app says what it is in its own manifest", () => {
    expect(
      marketplaceProblems(
        marketplace([
          { name: 'notes', source: './apps/notes', description: 'Notes beside every chat.' },
        ]),
        listing,
      ),
    ).toEqual(["apps[0].description: a folder's app says it in its own manifest"])
  })

  test('a linked app says what it is, in 10 to 2000 characters', () => {
    expect(
      marketplaceProblems(
        marketplace([
          { ...link, description: 'Habits' },
          { name: 'timer', source: { source: 'url', url: 'https://grace.example/m.json' } },
        ]),
        listing,
      ),
    ).toEqual([
      'apps[0].description: a linked app says what it is, in 10 to 2000 characters',
      'apps[1].description: a linked app says what it is, in 10 to 2000 characters',
    ])
  })

  test('a source is a folder inside the repository, a GitHub repository or an https address', () => {
    expect(
      marketplaceProblems(
        marketplace([
          { name: 'a', source: '../outside' },
          { ...link, name: 'b', source: { source: 'github', repo: 'not a repo' } },
          { ...link, name: 'c', source: { source: 'url', url: 'http://plain.example/m.json' } },
          {
            name: 'd',
            source: { source: 'archive', url: 'd.tar.gz', bytes: 1, sha256: 'a'.repeat(64) },
          },
          { name: 'e' },
        ]),
        listing,
      ),
    ).toEqual([
      'apps[0].source: a folder of this repository, starting with ./',
      'apps[1].source.repo: owner/name of a GitHub repository',
      'apps[2].source.url: an https:// address',
      'apps[3].source: an archive is written by the build, not by hand',
      'apps[4].source: where the app is (only an app revoked as a whole has none)',
    ])
  })

  test('an app is revoked with a reason, as a whole or by version', () => {
    expect(
      marketplaceProblems(
        marketplace([
          { name: 'gone', revoked: { reason: 'Sends notes away.' } },
          { name: 'notes', source: './apps/notes', revoked: { reason: '', versions: [] } },
        ]),
        listing,
      ),
    ).toEqual([
      'apps[1].revoked.reason: why it is revoked, in 1 to 500 characters',
      'apps[1].revoked.versions: the versions revoked; leave it out to revoke every one',
    ])
  })

  test('a list that is not the Localix marketplace curates nothing', () => {
    expect(
      marketplaceProblems(
        marketplace([{ ...link, featured: true, suggestFor: { files: ['*.md'] } }], {
          collections: [],
          blockedArchives: [],
        }),
        listing,
      ),
    ).toEqual([
      'collections: only the Localix marketplace curates',
      'blockedArchives: only the Localix marketplace curates',
      'apps[0].featured: only the Localix marketplace curates',
      'apps[0].suggestFor: only the Localix marketplace curates',
    ])
  })

  test('curation that does not read, and rows that name an app it does not list', () => {
    expect(
      marketplaceProblems(
        marketplace(
          [{ name: 'notes', source: './apps/notes', featured: 'yes', suggestFor: { file: [] } }],
          {
            collections: [
              { id: 'x', title: 'X', style: 'carousel', items: ['notes', 'ghost', 'plugin:'] },
            ],
            blockedArchives: [{ sha256: 'nope', reason: 'x' }],
          },
        ),
        curating,
      ),
    ).toEqual([
      'collections[0].style: row or grid',
      'collections[0].items[1]: ghost is not an app of this marketplace',
      'collections[0].items[2]: an app of this marketplace, or <kind>:<id>',
      'blockedArchives[0].sha256: the sha256 of the archive, in hex',
      'apps[0].featured: true or false',
      'apps[0].suggestFor.file: not a field of suggestFor',
    ])
  })

  test('names and descriptions hold no invisible characters', () => {
    expect(
      marketplaceProblems(
        marketplace([{ ...link, description: 'Track habits​ with the agent beside you.' }]),
        listing,
      ),
    ).toEqual(['apps[0].description: holds an invisible character'])
  })

  test('a file that is not an object says so', () => {
    expect(marketplaceProblems([], listing)).toEqual(['the file: a JSON object'])
  })
})
