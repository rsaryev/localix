import { describe, expect, test } from 'bun:test'

import { normalizeDevOpsArea } from './devopsView'

describe('DevOps Workspace view persistence', () => {
  test('accepts every supported area', () => {
    expect(normalizeDevOpsArea('overview')).toBe('overview')
    expect(normalizeDevOpsArea('containers')).toBe('containers')
    expect(normalizeDevOpsArea('kubernetes')).toBe('kubernetes')
  })

  test('falls back safely for corrupt or future values', () => {
    expect(normalizeDevOpsArea('terraform')).toBe('overview')
    expect(normalizeDevOpsArea(null)).toBe('overview')
    expect(normalizeDevOpsArea({ area: 'containers' })).toBe('overview')
  })
})
