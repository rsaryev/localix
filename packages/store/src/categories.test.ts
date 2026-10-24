import { describe, expect, test } from 'bun:test'

import { STORE_CATEGORIES, storeCategory } from './categories'

const card = (over: Partial<Parameters<typeof storeCategory>[0]> = {}) => ({
  name: 'thing',
  summary: '',
  tags: [] as string[],
  ...over,
})

describe('Store categories', () => {
  test('are the fixed list, Other last', () => {
    expect(STORE_CATEGORIES).toEqual([
      'Development',
      'Data',
      'Content',
      'Productivity',
      'Design',
      'Security',
      'Operations',
      'Learning',
      'Games',
      'Utilities',
      'Other',
    ])
  })

  test('a source category maps through the one table', () => {
    expect(storeCategory(card({ category: 'database' }))).toBe('Data')
    expect(storeCategory(card({ category: 'deployment' }))).toBe('Operations')
    expect(storeCategory(card({ category: 'monitoring' }))).toBe('Operations')
    expect(storeCategory(card({ category: 'testing' }))).toBe('Development')
    expect(storeCategory(card({ category: 'Developer Tools' }))).toBe('Development')
    expect(storeCategory(card({ category: 'Productivity' }))).toBe('Productivity')
    expect(storeCategory(card({ category: 'games' }))).toBe('Games')
  })

  test('without a category, its tags, name and summary place it', () => {
    expect(storeCategory(card({ tags: ['postgres'] }))).toBe('Data')
    expect(storeCategory(card({ summary: 'Deploy to a Kubernetes cluster' }))).toBe('Operations')
    expect(storeCategory(card({ name: 'vuln-scanner', summary: 'Find secrets in code' }))).toBe(
      'Security',
    )
    expect(storeCategory(card({ summary: 'Review pull requests and refactor code' }))).toBe(
      'Development',
    )
  })

  test('a category it does not know is placed by its words, not kept', () => {
    expect(storeCategory(card({ category: 'location', summary: 'Maps and places' }))).toBe('Other')
    expect(storeCategory(card({ category: 'math', summary: 'Chart your data in SQL' }))).toBe(
      'Data',
    )
  })

  test('nothing matches: Other', () => {
    expect(storeCategory(card({ name: 'zz', summary: 'Hmm' }))).toBe('Other')
  })
})
