import { beforeEach, describe, expect, test } from 'bun:test'
import { personActionLines, usePersonActions } from './personActions'

const tab = { previewId: 't2', url: 'https://example.com/a', title: 'Example', version: 0 }

beforeEach(() => usePersonActions.setState({ bySession: {} }))

describe('what the person did in the Browser, as the agent reads it', () => {
  test('says a closed tab and that the agent opened it', () => {
    usePersonActions.getState().closed('s1', { ...tab, originSessionId: 's1' })
    expect(personActionLines(usePersonActions.getState().bySession['s1'])).toEqual([
      'The person closed tab t2 (Example, https://example.com/a), which you opened.',
    ])
  })

  test('says a closed tab the person opened without claiming it was the agent', () => {
    usePersonActions.getState().closed('s1', { ...tab, userOpened: true })
    expect(personActionLines(usePersonActions.getState().bySession['s1'])).toEqual([
      'The person closed tab t2 (Example, https://example.com/a).',
    ])
  })

  test('keeps only the latest address of a tab the person navigated', () => {
    const { navigated } = usePersonActions.getState()
    navigated('s1', tab, 'https://example.com/b')
    navigated('s1', { ...tab, url: 'https://example.com/b' }, 'https://example.com/c')
    expect(personActionLines(usePersonActions.getState().bySession['s1'])).toEqual([
      'The person navigated tab t2 to https://example.com/c.',
    ])
  })

  test('a navigation of a tab the person then closed is not told twice', () => {
    const { navigated, closed } = usePersonActions.getState()
    navigated('s1', tab, 'https://example.com/b')
    closed('s1', tab)
    expect(personActionLines(usePersonActions.getState().bySession['s1'])).toHaveLength(1)
  })

  test('remembers only the last few actions, per chat', () => {
    const { closed } = usePersonActions.getState()
    for (let i = 0; i < 8; i += 1) closed('s1', { ...tab, previewId: `t${i}` })
    closed('s2', tab)
    expect(usePersonActions.getState().bySession['s1']).toHaveLength(5)
    expect(personActionLines(usePersonActions.getState().bySession['s1']).at(-1)).toContain('t7')
    expect(usePersonActions.getState().bySession['s2']).toHaveLength(1)
  })
})
