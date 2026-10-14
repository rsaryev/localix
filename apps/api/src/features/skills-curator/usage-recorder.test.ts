import { afterEach, describe, expect, test } from 'bun:test'
import { setSkillUsageRecorder, recordSkillUse } from './usage-recorder'

afterEach(() => setSkillUsageRecorder(null)) // reset the singleton sink

describe('skill usage recorder', () => {
  test('records to a registered sink with name, scope and exact project', () => {
    const calls: Array<[string, string, string]> = []
    setSkillUsageRecorder((name, scope, projectId) => {
      calls.push([name, scope, projectId])
    })
    recordSkillUse('deploy', 'project', 'project-a')
    expect(calls).toEqual([['deploy', 'project', 'project-a']])
  })

  test('is a no-op when no sink is registered (tests / ad-hoc use)', () => {
    expect(() => recordSkillUse('x', 'global')).not.toThrow()
    setSkillUsageRecorder(null)
    expect(() => recordSkillUse('x', 'global')).not.toThrow()
  })

  test('a synchronously-throwing sink never breaks the caller', () => {
    setSkillUsageRecorder(() => {
      throw new Error('boom')
    })
    expect(() => recordSkillUse('x', 'project')).not.toThrow()
  })

  test('an async-rejecting sink is swallowed (telemetry must never break a skill get)', async () => {
    setSkillUsageRecorder(async () => {
      throw new Error('async boom')
    })
    expect(() => recordSkillUse('x', 'global')).not.toThrow()
    await Promise.resolve() // let the microtask + .catch settle
  })
})
