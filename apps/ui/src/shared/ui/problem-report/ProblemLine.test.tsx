import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ProblemReport } from '@localixai/mini-app-sdk/ui/problems'

import { ProblemLine } from './ProblemLine'

/**
 * What the surface is allowed to say.
 *
 * Two rules keep being rediscovered from the wrong side. A line that prints the driver's raw text
 * paints a wall across someone's canvas — that text has a home, and it is the Event Center. And a
 * line that draws its own recovery buttons drifts from the durable row that offers different ones,
 * which is how "Retry" ended up on half the panes and none of the records of them.
 */

const report = (problems: ProblemReport['problems']): ProblemReport => ({
  subject: { label: 'db.sqlite' },
  problems,
})

describe('what a surface line prints', () => {
  it('never prints the raw detail — that text belongs to the Event Center', () => {
    const html = renderToStaticMarkup(
      <ProblemLine
        report={report([
          {
            message: 'The database is unreachable.',
            hint: 'Check that the server is running.',
            detail: 'dial unix /Users/x/.local/db.sock: connect: no such file or directory',
          },
        ])}
      />,
    )
    expect(html).toContain('The database is unreachable.')
    expect(html).not.toContain('dial unix')
  })

  it('renders every way out, including the ones the durable row does not get', () => {
    const html = renderToStaticMarkup(
      <ProblemLine
        report={report([{ message: 'The database is unreachable.' }])}
        actions={[
          { id: 'retry', label: 'Retry', run: () => {} },
          // Surface-only: "stop showing me this" means nothing to a record read an hour later, but
          // the person looking at the line still needs it.
          { id: 'dismiss', label: 'Dismiss', run: () => {}, durable: false },
        ]}
      />,
    )
    expect(html).toContain('Retry')
    expect(html).toContain('Dismiss')
    expect(html).toContain('Details')
  })

  it('says a stale surface is behind, and does not narrate an empty one', () => {
    const problems = report([{ message: 'The database is unreachable.' }])
    expect(
      renderToStaticMarkup(<ProblemLine report={{ ...problems, consequence: 'stale' }} />),
    ).toContain('showing the last valid version')
    expect(
      renderToStaticMarkup(<ProblemLine report={{ ...problems, consequence: 'blocked' }} />),
    ).not.toContain('showing')
  })
})
