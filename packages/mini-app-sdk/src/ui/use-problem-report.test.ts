import { beforeEach, describe, expect, test } from 'bun:test'

import { bindPluginUiToast, type PluginToast } from './notifications'
import type { ProblemReport } from './problems'
import { createProblemPublisher } from './use-problem-report'

/**
 * The publisher is what `useProblemReport` runs on every content change. Driven directly, because
 * the defect lives in what it remembers between calls, not in React's scheduling.
 */

let said: string[] = []
beforeEach(() => {
  said = []
  const unused = () => 0
  bindPluginUiToast(
    Object.assign(unused, {
      success: unused,
      error: unused,
      info: unused,
      warning: unused,
      message: unused,
      problems: (report: ProblemReport, options: { scope: string }) => {
        said.push(`publish ${options.scope}:${report.subject.label}`)
        return `row-${report.subject.label}`
      },
      problemsCleared: (subject: Pick<ProblemReport, 'subject'>, scope: string) => {
        said.push(`clear ${scope}:${subject.subject.label}`)
      },
    }) as PluginToast,
  )
})

const report = (label: string, message = 'broken'): ProblemReport => ({
  subject: { label },
  problems: [{ message }],
})

describe('owning a standing problem', () => {
  test('settles the old subject when the report moves to another broken subject', () => {
    const publish = createProblemPublisher()
    expect(publish(report('alpha'), { scope: 'db' })).toBe('row-alpha')
    expect(publish(report('beta'), { scope: 'db' })).toBe('row-beta')
    // Before the fix the second call only published beta: alpha's row was never settled.
    expect(said).toEqual(['publish db:alpha', 'clear db:alpha', 'publish db:beta'])
  })

  test('republishing the same subject does not settle it first', () => {
    const publish = createProblemPublisher()
    publish(report('alpha'), { scope: 'db' })
    publish(report('alpha', 'still broken, differently'), { scope: 'db' })
    expect(said).toEqual(['publish db:alpha', 'publish db:alpha'])
  })

  test('settles on null, and never clears what it never said', () => {
    const publish = createProblemPublisher()
    expect(publish(null, { scope: 'db' })).toBeUndefined()
    publish(report('alpha'), { scope: 'db' })
    expect(publish(null, { scope: 'db' })).toBeUndefined()
    publish(null, { scope: 'db' })
    expect(said).toEqual(['publish db:alpha', 'clear db:alpha'])
  })
})
