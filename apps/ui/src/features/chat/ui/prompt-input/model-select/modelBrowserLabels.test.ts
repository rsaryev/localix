import { describe, expect, it } from 'bun:test'

import { workloadLabelFor } from './modelBrowserLabels'

describe('workloadLabelFor', () => {
  it('prefers the participant label, then handle, then task, then the default', () => {
    expect(workloadLabelFor({ label: 'Ada', handle: 'ada' }, 'Chat')).toBe('Ada')
    expect(workloadLabelFor({ handle: 'ada' }, 'Chat')).toBe('ada')
    expect(workloadLabelFor(undefined, 'Titles')).toBe('Titles')
    expect(workloadLabelFor(undefined, undefined)).toBe('Chat sessions')
  })
})
