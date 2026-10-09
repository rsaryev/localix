import { describe, expect, test } from 'bun:test'
import { normalizeSearchText, rankSearchCandidates, scoreSearchFields } from './index'

describe('normalization', () => {
  test('folds accents, case and punctuation through one Unicode-aware path', () => {
    expect(normalizeSearchText('  Créate/Post_ID  ')).toBe('create post id')
  })
})

describe('field scoring', () => {
  test('prefers exact title over a supporting description match', () => {
    const title = scoreSearchFields([{ text: 'Plugin settings', weight: 1 }], 'plugin settings')
    const prose = scoreSearchFields(
      [{ text: 'Open installed plugin settings', weight: 0.55 }],
      'plugin settings',
    )
    expect(title).toBeGreaterThan(prose)
  })

  test('matches intent terms across independently weighted fields', () => {
    expect(
      scoreSearchFields(
        [
          { text: 'Plugins', weight: 1 },
          { text: 'Enable installed extensions', weight: 0.65 },
        ],
        'enable plugins',
      ),
    ).toBeGreaterThan(0.6)
  })

  test('can require complete term coverage for strict global-search providers', () => {
    expect(scoreSearchFields([{ text: 'sample-provider' }], 'sample query')).toBeGreaterThan(0)
    expect(
      scoreSearchFields([{ text: 'sample-provider' }], 'sample query', {
        requireAllTerms: true,
      }),
    ).toBe(0)
  })

  test('supports compact and fuzzy quick-open forms', () => {
    expect(scoreSearchFields([{ text: 'FileTab.tsx' }], 'file tab')).toBeGreaterThan(0.8)
    expect(scoreSearchFields([{ text: 'global search' }], 'gsrch')).toBeGreaterThan(0)
  })

  test('uses MiniSearch fuzzy matching for edit-distance typos', () => {
    expect(scoreSearchFields([{ text: 'Plugin settings' }], 'plugin settimgs')).toBeGreaterThan(0)
  })

  test('uses MiniSearch token matching independently of phrase order', () => {
    expect(scoreSearchFields([{ text: 'Plugin settings' }], 'settings plugin')).toBeGreaterThan(0.7)
  })

  test('accepts small suffix variants without overmatching short word prefixes', () => {
    expect(scoreSearchFields([{ text: 'plugin' }], 'plugins')).toBeGreaterThan(0)
    expect(scoreSearchFields([{ text: 'key' }], 'keybinding')).toBe(0)
  })
})

describe('multi-query ranking', () => {
  const items = ['verified/list-posts', 'verified/get-post', 'verified/create-post', 'settings']
  const candidates = items.map((item) => ({ item, fields: [{ text: item }] }))

  test('merges several intents into one deduplicated ranked result', () => {
    const ranked = rankSearchCandidates(candidates, {
      queries: ['list posts', 'get post', 'create post'],
    })
    expect(ranked.map((result) => result.item)).toEqual([
      'verified/list-posts',
      'verified/get-post',
      'verified/create-post',
    ])
  })

  test('uses a deterministic domain tie-break and limit', () => {
    const ranked = rankSearchCandidates(candidates, {
      queries: '',
      limit: 2,
      compare: (a, b) => a.localeCompare(b),
    })
    expect(ranked.map((result) => result.item)).toEqual(['settings', 'verified/create-post'])
  })

  test('forwards strict coverage policy to a ranking pass', () => {
    const ranked = rankSearchCandidates(candidates, {
      queries: 'create missing',
      scoreOptions: { requireAllTerms: true },
    })
    expect(ranked).toEqual([])
  })

  test('uses the shared MiniSearch corpus for typo ranking', () => {
    const ranked = rankSearchCandidates(
      ['settings', 'sessions', 'projects'].map((item) => ({ item, fields: [{ text: item }] })),
      { queries: 'settimgs' },
    )
    expect(ranked.map((result) => result.item)).toEqual(['settings'])
  })
})

describe('stopword overmatching', () => {
  test('a short function word does not rank an entry for a longer query', () => {
    // `the` + `me` once satisfied the plural rule, so every entry whose prose
    // contained "the" scored 0.74 against a query for "theme".
    expect(scoreSearchFields([{ text: 'Follow the agent edits' }], 'theme')).toBe(0)
    // The rule still covers what it was written for.
    expect(scoreSearchFields([{ text: 'plugin' }], 'plugins')).toBeGreaterThan(0)
    expect(scoreSearchFields([{ text: 'box' }], 'boxes')).toBeGreaterThan(0)
  })
})

test('blank intents are removed before matched-query indexes are assigned', () => {
  expect(
    rankSearchCandidates([{ item: 'needle', fields: [{ text: 'needle' }] }], {
      queries: ['', '###', 'needle'],
    })[0]?.matchedQueryIndexes,
  ).toEqual([0])
})

test('equal candidates keep their input order and repeated items remain separate results', () => {
  const shared = { id: 'same' }
  const ranked = rankSearchCandidates(
    [shared, shared, { id: 'third' }].map((item) => ({ item, fields: [{ text: 'needle' }] })),
    { queries: 'needle', compare: () => 0 },
  )
  expect(ranked).toHaveLength(3)
  expect(ranked[0]?.item).toBe(shared)
  expect(ranked[1]?.item).toBe(shared)
  expect(ranked[2]?.item.id).toBe('third')
})
