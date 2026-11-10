import { describe, expect, test } from 'bun:test'

import { triggeringKeywords } from './prompt-skill-triggers'

const skill = (name: string, keywords?: string[]) => ({ name, ...(keywords ? { keywords } : {}) })

describe('keyword-triggered skills', () => {
  test('a keyword in the message forces the skill in', () => {
    const out = triggeringKeywords([skill('deploy-guide', ['deploy'])], 'please deploy the app')
    expect(out.map((s) => s.name)).toEqual(['deploy-guide'])
    expect(out[0]!.keyword).toBe('deploy')
  })

  test('a skill without keywords is never triggered', () => {
    expect(triggeringKeywords([skill('quiet')], 'deploy deploy deploy')).toEqual([])
  })

  test('matching is case-insensitive', () => {
    expect(triggeringKeywords([skill('s', ['Rollback'])], 'time to ROLLBACK')).toHaveLength(1)
  })

  test('word boundaries, so a short keyword cannot fire from inside a longer word', () => {
    // The surprise an author cannot see coming. Someone who wants the longer forms lists them.
    expect(triggeringKeywords([skill('s', ['cat'])], 'concatenate the files')).toEqual([])
    expect(triggeringKeywords([skill('s', ['cat'])], 'the cat sat')).toHaveLength(1)
  })

  test('a phrase matches across any run of whitespace', () => {
    // A line break in the user's message must not decide whether their procedure applies.
    const skills = [skill('s', ['deploy to prod'])]
    expect(triggeringKeywords(skills, 'we should deploy to prod today')).toHaveLength(1)
    expect(triggeringKeywords(skills, 'we should deploy\n  to   prod today')).toHaveLength(1)
    expect(triggeringKeywords(skills, 'deploy to staging')).toEqual([])
  })

  test('a keyword ending in punctuation still matches', () => {
    // `\b` would never fire here, which would be a silently dead keyword.
    expect(triggeringKeywords([skill('s', ['c++'])], 'rewrite it in c++ please')).toHaveLength(1)
  })

  test('one skill fires once, on its first matching keyword', () => {
    const out = triggeringKeywords([skill('s', ['deploy', 'ship'])], 'deploy and ship')
    expect(out).toHaveLength(1)
    expect(out[0]!.keyword).toBe('deploy')
  })

  test('an empty or missing message triggers nothing', () => {
    const skills = [skill('s', ['deploy'])]
    expect(triggeringKeywords(skills, '   ')).toEqual([])
    expect(triggeringKeywords(skills, undefined)).toEqual([])
  })

  test('a keyword made of regex metacharacters is matched literally', () => {
    // Author-supplied prose, so it must not be able to compile into a pattern.
    expect(triggeringKeywords([skill('s', ['a.b'])], 'axb')).toEqual([])
    expect(triggeringKeywords([skill('s', ['a.b'])], 'a.b')).toHaveLength(1)
  })
})
