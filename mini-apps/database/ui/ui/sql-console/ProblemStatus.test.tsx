import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { NO_PROBLEMS } from '../sqlDiagnostics'
import { ProblemStatus } from './ProblemStatus'

describe('ProblemStatus (the verdict before Run)', () => {
  test('says nothing when the text is clean and no check is running', () => {
    expect(renderToStaticMarkup(<ProblemStatus problems={NO_PROBLEMS} />)).toBe('')
  })

  test('shows the count and the first reason, as an error when any problem is one', () => {
    const html = renderToStaticMarkup(
      <ProblemStatus
        problems={{
          errors: 1,
          warnings: 1,
          first: { message: 'Table "userz" does not exist.', line: 3 },
          checking: false,
        }}
      />,
    )
    expect(html).toContain('2 problems')
    expect(html).toContain('line 3: Table &quot;userz&quot; does not exist.')
    expect(html).toContain('text-status-error')
  })

  test('an in-flight engine check with nothing found yet reads as checking', () => {
    const html = renderToStaticMarkup(
      <ProblemStatus problems={{ ...NO_PROBLEMS, checking: true }} />,
    )
    expect(html).toContain('Checking…')
  })
})
