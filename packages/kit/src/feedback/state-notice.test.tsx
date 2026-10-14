import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '../controls/button'
import { StateNotice } from './state-notice'

describe('StateNotice', () => {
  test('supports a wrapping, named group of heterogeneous actions', () => {
    const html = renderToStaticMarkup(
      <StateNotice
        role="alert"
        ariaLive="assertive"
        title="Preview did not load"
        actionsLabel="Preview recovery actions"
        actions={
          <>
            <Button variant="mono" size="sm">
              Reload
            </Button>
            <Button variant="outline" size="sm">
              Open in browser
            </Button>
          </>
        }
      />,
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-live="assertive"')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Preview recovery actions"')
    expect(html).toContain('flex-wrap')
    expect(html).toContain('data-variant="mono"')
    expect(html).toContain('data-variant="outline"')
  })

  test('does not render an empty action group', () => {
    const html = renderToStaticMarkup(<StateNotice title="No problems" />)
    expect(html).not.toContain('role="group"')
  })
})
