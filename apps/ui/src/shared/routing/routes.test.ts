import { describe, expect, test } from 'bun:test'

import { scopePath, isSectionId, parseSettingsTab } from './routes'

describe('scopePath (hierarchical scope→session)', () => {
  test('every scope is a project — there is no project-less spelling', () => {
    expect(scopePath('p1')).toBe('/project/p1')
    expect(scopePath('p1', 's1')).toBe('/project/p1/s1')
    expect(scopePath('p1', 's1', 'jobs')).toBe('/project/p1/s1/jobs')
    expect(scopePath('p1', 's1', null)).toBe('/project/p1/s1')
    expect(scopePath('p1', null)).toBe('/project/p1')
  })
})

describe('isSectionId', () => {
  test('recognizes every core sidebar section', () => {
    expect(isSectionId('files')).toBe(true)
    expect(isSectionId('jobs')).toBe(true)
    expect(isSectionId('plugins')).toBe(false)
    expect(isSectionId('plan')).toBe(false)
    expect(isSectionId(undefined)).toBe(false)
  })
})

describe('parseSettingsTab', () => {
  test('projectId always wins as a project view', () => {
    expect(parseSettingsTab('permissions', 'p1')).toEqual({ kind: 'project', id: 'p1' })
  })
  test('valid string tab passes through, invalid/undefined → preferences', () => {
    expect(parseSettingsTab('preferences', undefined)).toBe('preferences')
    expect(parseSettingsTab('local-models', undefined)).toBe('preferences')
    expect(parseSettingsTab('bogus', undefined)).toBe('preferences')
    // Items are managed in the Store; Settings has no page of them to land on.
    for (const moved of ['agents', 'tools', 'skills', 'mcp', 'plugins', 'mini-apps'])
      expect(parseSettingsTab(moved, undefined)).toBe('preferences')
    expect(parseSettingsTab('rules', undefined)).toBe('permissions')
    expect(parseSettingsTab(undefined, undefined)).toBe('preferences')
  })
})
