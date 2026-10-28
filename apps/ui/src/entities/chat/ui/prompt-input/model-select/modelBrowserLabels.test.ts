import { describe, expect, it } from 'bun:test'

import { workloadLabelFor } from './modelBrowserLabels'

describe('workloadLabelFor', () => {
  it('prefers the agent name, then task, then the default', () => {
    expect(workloadLabelFor({ name: 'ada' }, 'Chat')).toBe('ada')
    expect(workloadLabelFor(undefined, 'Titles')).toBe('Titles')
    expect(workloadLabelFor(undefined, undefined)).toBe('Chat sessions')
  })
})
