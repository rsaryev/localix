import { describe, expect, test } from 'bun:test'

import { humanizeMiniAppId, miniAppLabel } from './label'

describe('the name a person reads for a plugin', () => {
  test('a declared name is used verbatim', () => {
    expect(miniAppLabel({ name: 'learning', displayName: 'Learning Studio' })).toBe(
      'Learning Studio',
    )
  })

  test('a missing name is TRANSLATED from the id, never printed raw', () => {
    // The whole point: `name` is a kebab id by contract, so a bare `||` fallback puts an
    // identifier in a list of names — which reads as a failed load, not as a plugin.
    expect(miniAppLabel({ name: 'webhook-notifier' })).toBe('Webhook Notifier')
    expect(miniAppLabel({ name: 'database' })).toBe('Database')
  })

  test('an empty or blank displayName counts as missing, not as an empty name', () => {
    expect(miniAppLabel({ name: 'office', displayName: '' })).toBe('Office')
    expect(miniAppLabel({ name: 'office', displayName: '   ' })).toBe('Office')
    expect(miniAppLabel({ name: 'office', displayName: null })).toBe('Office')
  })

  test('acronyms keep their own casing instead of becoming Title Case words', () => {
    expect(humanizeMiniAppId('api')).toBe('API')
    expect(humanizeMiniAppId('devops')).toBe('DevOps')
    expect(humanizeMiniAppId('mcp-bridge')).toBe('MCP Bridge')
    expect(humanizeMiniAppId('sql_runner')).toBe('SQL Runner')
  })

  test('separators collapse instead of producing empty words', () => {
    expect(humanizeMiniAppId('a--b__c')).toBe('A B C')
  })
})
