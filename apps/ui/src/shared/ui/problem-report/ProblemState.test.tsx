import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ProblemReport } from '@localixai/mini-app-sdk/ui/problems'

import { ProblemState } from './ProblemState'

/**
 * The pane-level problem, pinned.
 *
 * Seven mini apps hand-built this as a `flex-1` wrapper around a line, and in a block-level scroll
 * container `flex-1` does nothing — a mini app's "centred" error sat at the top of an empty sidebar.
 * The geometry is the kit `StateNotice`'s, which fills block and flex parents alike; this test keeps
 * that the shell, and keeps the expected next step a real button rather than one more quiet link.
 */

const report: ProblemReport = {
  subject: { label: 'Docker' },
  consequence: 'blocked',
  problems: [
    {
      message: 'Docker is not running',
      hint: 'Start Docker with `open -a Docker`, then try again.',
      detail: 'dial unix /Users/me/.docker/run/docker.sock: connect: no such file or directory',
    },
  ],
}

describe('ProblemState', () => {
  it('centres in its pane through the kit shell, whatever the parent layout', () => {
    const html = renderToStaticMarkup(<ProblemState report={report} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('h-full')
    expect(html).toContain('justify-center')
  })

  it('states the problem and what to do, never the raw engine text', () => {
    const html = renderToStaticMarkup(<ProblemState report={report} />)
    expect(html).toContain('Docker is not running')
    expect(html).toContain('open -a Docker')
    expect(html).not.toContain('dial unix')
  })

  it('draws the primary recovery as the recommended button and the rest as links', () => {
    const html = renderToStaticMarkup(
      <ProblemState
        report={report}
        actions={[
          { id: 'retry', label: 'Retry', run: () => {} },
          { id: 'start', label: 'Start Docker', run: () => {}, primary: true },
        ]}
      />,
    )
    const button = html.indexOf('>Start Docker<')
    expect(button).toBeGreaterThan(-1)
    // The primary step comes first, before the quiet Retry and Details links.
    expect(button).toBeLessThan(html.indexOf('>Retry<'))
    expect(button).toBeLessThan(html.indexOf('>Details<'))
    // Drawn once, as the button — not again among the links.
    expect(html.match(/>Start Docker</g)).toHaveLength(1)
  })

  it('renders nothing for an empty report', () => {
    expect(renderToStaticMarkup(<ProblemState report={{ ...report, problems: [] }} />)).toBe('')
  })
})
