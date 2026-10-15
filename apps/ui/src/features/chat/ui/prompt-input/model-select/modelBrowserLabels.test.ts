import { describe, expect, it } from 'bun:test'

import { isDetailCurrent, workloadLabelFor } from './modelBrowserLabels'

describe('isDetailCurrent', () => {
  const slot = { providerConnectionId: 'c1', modelId: 'm1' }

  it('matches only the same model on the same connection', () => {
    expect(isDetailCurrent('m1', 'c1', slot)).toBe(true)
    expect(isDetailCurrent('m1', 'c2', slot)).toBe(false)
    expect(isDetailCurrent('m2', 'c1', slot)).toBe(false)
  })

  it('is false without a detail model or a current slot', () => {
    expect(isDetailCurrent(undefined, 'c1', slot)).toBe(false)
    expect(isDetailCurrent('m1', 'c1', null)).toBe(false)
  })
})

describe('workloadLabelFor', () => {
  it('prefers the participant label, then handle, then task, then the default', () => {
    expect(workloadLabelFor({ label: 'Ada', handle: 'ada' }, 'Chat')).toBe('Ada')
    expect(workloadLabelFor({ handle: 'ada' }, 'Chat')).toBe('ada')
    expect(workloadLabelFor(undefined, 'Titles')).toBe('Titles')
    expect(workloadLabelFor(undefined, undefined)).toBe('Chat sessions')
  })
})
