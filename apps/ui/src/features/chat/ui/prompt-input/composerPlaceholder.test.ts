import { describe, expect, it } from 'bun:test'

import { composerPlaceholder } from './composerPlaceholder'

const ready = { hasConnection: true, hasModel: true, readOnlyReason: null, isGenerating: false }

describe('composerPlaceholder', () => {
  it('names the first missing prerequisite', () => {
    expect(composerPlaceholder({ ...ready, hasConnection: false, hasModel: false })).toBe(
      'Connect a provider in the app to start…',
    )
    expect(composerPlaceholder({ ...ready, hasModel: false })).toBe('Select a model to start…')
    expect(composerPlaceholder({ ...ready, readOnlyReason: 'Archived' })).toBe('Archived')
  })

  it('says what typing does when ready', () => {
    expect(composerPlaceholder(ready)).toBe('Describe the outcome you want…')
    expect(composerPlaceholder({ ...ready, isGenerating: true })).toBe('Type a message to queue…')
  })
})
