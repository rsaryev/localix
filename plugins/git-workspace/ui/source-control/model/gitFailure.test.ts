import { describe, expect, test } from 'bun:test'
import { gitReadProblem } from './gitFailure'

describe('gitReadProblem', () => {
  test('names the fix for a repository git refuses to read', () => {
    const problem = gitReadProblem("fatal: detected dubious ownership in repository at '/w'")
    expect(problem.message).toContain('belongs to another user')
    expect(problem.hint).toContain('safe.directory')
  })

  test('an unknown failure keeps the caller’s sentence, never the raw stderr', () => {
    expect(gitReadProblem('fatal: something new', 'Could not read the commit log')).toEqual({
      message: 'Could not read the commit log',
    })
  })
})
