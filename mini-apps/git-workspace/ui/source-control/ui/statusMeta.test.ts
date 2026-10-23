import { describe, expect, test } from 'bun:test'
import type { RepoChangeStatus } from '../../../backend/source-control/contracts'
import { statusMeta } from './statusMeta'

describe('statusMeta', () => {
  test('maps known git change kinds to their badge + label + color', () => {
    expect(statusMeta('modified')).toEqual({
      letter: 'M',
      label: 'Modified',
      color: 'text-status-warning',
    })
    expect(statusMeta('added')).toEqual({
      letter: 'A',
      label: 'Added',
      color: 'text-status-success',
    })
    expect(statusMeta('deleted')).toEqual({
      letter: 'D',
      label: 'Deleted',
      color: 'text-status-error',
    })
    expect(statusMeta('conflicted').letter).toBe('!')
    expect(statusMeta('typechange').label).toBe('Type changed')
  })

  test('falls back to the "unknown" meta for an out-of-union status (crash guard)', () => {
    // A backend status outside RepoChangeStatus must not yield undefined.letter.
    expect(statusMeta('something-new' as unknown as RepoChangeStatus)).toEqual({
      letter: '?',
      label: 'Changed',
      color: 'text-text-faint',
    })
    expect(statusMeta('unknown')).toEqual({
      letter: '?',
      label: 'Changed',
      color: 'text-text-faint',
    })
  })
})
