import { describe, expect, test } from 'bun:test'
import { parseNameWithOwner, parsePullRequest, parsePullRequests, rollupChecks } from './parse'

describe('rollupChecks', () => {
  test('empty / absent → none', () => {
    expect(rollupChecks(undefined)).toBe('none')
    expect(rollupChecks(null)).toBe('none')
    expect(rollupChecks([])).toBe('none')
  })

  test('all successful CheckRuns → passing', () => {
    expect(
      rollupChecks([
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'NEUTRAL' },
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
      ]),
    ).toBe('passing')
  })

  test('any failure dominates over pending/passing', () => {
    expect(
      rollupChecks([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'IN_PROGRESS' },
        { status: 'COMPLETED', conclusion: 'FAILURE' },
      ]),
    ).toBe('failing')
  })

  test('a not-yet-completed CheckRun → pending when nothing failed', () => {
    expect(
      rollupChecks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'QUEUED' }]),
    ).toBe('pending')
  })

  test('legacy StatusContext state is honoured', () => {
    expect(rollupChecks([{ state: 'SUCCESS' }])).toBe('passing')
    expect(rollupChecks([{ state: 'PENDING' }])).toBe('pending')
    expect(rollupChecks([{ state: 'ERROR' }])).toBe('failing')
    expect(rollupChecks([{ state: 'FAILURE' }])).toBe('failing')
  })

  test('failure conclusions beyond FAILURE also fail (timeout/cancelled/action_required)', () => {
    expect(rollupChecks([{ status: 'COMPLETED', conclusion: 'TIMED_OUT' }])).toBe('failing')
    expect(rollupChecks([{ status: 'COMPLETED', conclusion: 'CANCELLED' }])).toBe('failing')
    expect(rollupChecks([{ status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' }])).toBe('failing')
  })
})

describe('parsePullRequest', () => {
  test('maps a full record and flattens author.login', () => {
    const pr = parsePullRequest({
      number: 42,
      title: 'Add widgets',
      state: 'OPEN',
      headRefName: 'feature/widgets',
      url: 'https://github.com/o/r/pull/42',
      isDraft: false,
      author: { login: 'octocat' },
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    })
    expect(pr).toEqual({
      number: 42,
      title: 'Add widgets',
      state: 'OPEN',
      headRefName: 'feature/widgets',
      url: 'https://github.com/o/r/pull/42',
      isDraft: false,
      author: 'octocat',
      checks: 'passing',
    })
  })

  test('null author + missing rollup are tolerated', () => {
    const pr = parsePullRequest({ number: 7, title: 't', headRefName: 'b', url: 'u', author: null })
    expect(pr?.author).toBeNull()
    expect(pr?.checks).toBe('none')
    expect(pr?.isDraft).toBe(false)
    expect(pr?.state).toBe('OPEN')
  })

  test('a record with no number is dropped', () => {
    expect(parsePullRequest({ title: 'x' })).toBeNull()
  })

  test('unknown state normalizes to OPEN; MERGED/CLOSED preserved', () => {
    expect(parsePullRequest({ number: 1, state: 'weird' })?.state).toBe('OPEN')
    expect(parsePullRequest({ number: 1, state: 'MERGED' })?.state).toBe('MERGED')
    expect(parsePullRequest({ number: 1, state: 'CLOSED' })?.state).toBe('CLOSED')
  })
})

describe('parsePullRequests', () => {
  test('parses an array payload, dropping junk records', () => {
    const json = JSON.stringify([
      { number: 1, title: 'a', headRefName: 'x', url: 'u1', author: { login: 'me' } },
      { title: 'no number' },
      {
        number: 2,
        title: 'b',
        headRefName: 'y',
        url: 'u2',
        isDraft: true,
        author: { login: 'you' },
      },
    ])
    const prs = parsePullRequests(json)
    expect(prs.map((p) => p.number)).toEqual([1, 2])
    expect(prs[1]?.isDraft).toBe(true)
  })

  test('invalid JSON or non-array → empty', () => {
    expect(parsePullRequests('not json')).toEqual([])
    expect(parsePullRequests('{"prs":[]}')).toEqual([])
    expect(parsePullRequests('')).toEqual([])
  })
})

describe('parseNameWithOwner', () => {
  test('extracts nameWithOwner', () => {
    expect(parseNameWithOwner('{"nameWithOwner":"octo/repo"}')).toBe('octo/repo')
  })
  test('junk → null', () => {
    expect(parseNameWithOwner('nope')).toBeNull()
    expect(parseNameWithOwner('{}')).toBeNull()
  })
})
