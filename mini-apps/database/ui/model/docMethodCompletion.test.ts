import { describe, expect, it } from 'bun:test'
import {
  docCompletionItems,
  matchMethods,
  methodCallSnippet,
  methodContextBeforeCaret,
  nameContextBeforeCaret,
} from './docMethodCompletion'

describe('docCompletionItems', () => {
  const methods = ['find', 'findOne', 'aggregate']
  const collections = ['users', 'user-events']

  it('replaces the exact collection prefix and retriggers native method suggestions', () => {
    const items = docCompletionItems('db.us', { line: 0, character: 5 }, methods, collections)

    expect(items[0]).toMatchObject({
      label: 'users',
      insertText: 'users.',
      insertTextFormat: 'plainText',
      range: {
        start: { line: 0, character: 3 },
        end: { line: 0, character: 5 },
      },
      preselect: true,
      command: { id: 'editor.action.triggerSuggest' },
    })
  })

  it('uses an explicit snippet range and preserves the legacy final caret', () => {
    const items = docCompletionItems(
      'db.users.fi',
      { line: 0, character: 11 },
      methods,
      collections,
    )

    expect(items.map((item) => item.label)).toEqual(['find', 'findOne'])
    expect(items[0]).toMatchObject({
      insertText: 'find({ $0 })',
      insertTextFormat: 'snippet',
      range: {
        start: { line: 0, character: 9 },
        end: { line: 0, character: 11 },
      },
      sortText: '0000',
    })
  })

  it('maps an Elasticsearch method range on the current line', () => {
    const text = 'ignored\nproducts.sea'
    const items = docCompletionItems(text, { line: 1, character: 12 }, ['search'], ['products'])

    expect(items[0]).toMatchObject({
      label: 'search',
      insertText: 'search({ $0 })',
      range: {
        start: { line: 1, character: 9 },
        end: { line: 1, character: 12 },
      },
    })
  })
})

describe('methodCallSnippet', () => {
  it('brace template for find-like methods, caret inside', () => {
    const s = methodCallSnippet('find')
    expect(s.body).toBe('({  })')
    expect(s.body.slice(0, s.caret)).toBe('({ ') // caret sits between the two spaces
  })
  it('array template for aggregate', () => {
    expect(methodCallSnippet('aggregate').body).toBe('([  ])')
  })
  it('quote template for distinct/get, caret between quotes', () => {
    expect(methodCallSnippet('get')).toEqual({ body: '("")', caret: 2 })
  })
  it('bare paren for unknown methods', () => {
    expect(methodCallSnippet('weird')).toEqual({ body: '(', caret: 1 })
  })
})

describe('nameContextBeforeCaret', () => {
  it('detects a collection being typed after db.', () => {
    expect(nameContextBeforeCaret('db.us')).toEqual({ partial: 'us', start: 3 })
  })
  it('detects an empty partial right after db.', () => {
    expect(nameContextBeforeCaret('db.')).toEqual({ partial: '', start: 3 })
  })
  it('detects a bare index name (no db. prefix)', () => {
    expect(nameContextBeforeCaret('products')).toEqual({ partial: 'products', start: 0 })
  })
  it('returns null once a method dot / args are present', () => {
    expect(nameContextBeforeCaret('db.users.find')).toBeNull()
    expect(nameContextBeforeCaret('products.search(')).toBeNull()
  })
})

describe('methodContextBeforeCaret', () => {
  it('detects a partial method after db.<collection>.', () => {
    expect(methodContextBeforeCaret('db.users.fi')).toEqual({ partial: 'fi', start: 9 })
  })
  it('detects an empty partial right after the dot', () => {
    expect(methodContextBeforeCaret('orders.')).toEqual({ partial: '', start: 7 })
  })
  it('detects an ES index.method too (no db prefix)', () => {
    expect(methodContextBeforeCaret('products.sea')?.partial).toBe('sea')
  })
  it('returns null inside the argument list or mid-token', () => {
    expect(methodContextBeforeCaret('db.users.find({"a":1}')).toBeNull()
    expect(methodContextBeforeCaret('db.users')).toBeNull() // no dot+partial yet
  })
})

describe('matchMethods', () => {
  const M = ['find', 'findOne', 'aggregate', 'countDocuments', 'count', 'distinct']
  it('prefix-matches case-insensitively', () => {
    expect(matchMethods(M, 'fi')).toEqual(['find', 'findOne'])
    expect(matchMethods(M, 'COUNT')).toEqual(['countDocuments', 'count'])
  })
  it('empty partial returns all (capped)', () => {
    expect(matchMethods(M, '', 3)).toEqual(['find', 'findOne', 'aggregate'])
  })
})
