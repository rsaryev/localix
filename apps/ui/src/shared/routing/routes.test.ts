import { describe, expect, test } from 'bun:test'

import { scopePath, isCapabilityTab, isSectionId, parseSettingsTab } from './routes'

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
    expect(isSectionId('plugins')).toBe(true)
    expect(isSectionId('plan')).toBe(false)
    expect(isSectionId(undefined)).toBe(false)
  })
})

describe('isCapabilityTab', () => {
  test('capability tabs true; other string tabs and project object false', () => {
    expect(isCapabilityTab('tools')).toBe(true)
    expect(isCapabilityTab('plugins')).toBe(true)
    expect(isCapabilityTab('preferences')).toBe(false)
    expect(isCapabilityTab('preferences')).toBe(false)
    expect(isCapabilityTab({ kind: 'project', id: 'p' })).toBe(false)
  })
})

describe('parseSettingsTab', () => {
  test('projectId always wins as a project view', () => {
    expect(parseSettingsTab('tools', 'p1')).toEqual({ kind: 'project', id: 'p1' })
  })
  test('valid string tab passes through, invalid/undefined → preferences', () => {
    expect(parseSettingsTab('preferences', undefined)).toBe('preferences')
    expect(parseSettingsTab('models', undefined)).toBe('preferences')
    expect(parseSettingsTab('bogus', undefined)).toBe('preferences')
    expect(parseSettingsTab(undefined, undefined)).toBe('preferences')
  })
})
