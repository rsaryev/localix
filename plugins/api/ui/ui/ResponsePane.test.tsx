import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SendResponse } from '../../backend/contracts'
import { ResponsePane } from './ResponsePane'

const response: SendResponse = {
  status: 200,
  statusText: 'OK',
  url: 'https://api.example.dev/users',
  headers: { 'content-type': 'application/json' },
  body: '{"items":[]}',
  bytes: 12,
  truncated: false,
  elapsedMs: 42,
  hops: [],
}

function render(sending: boolean, value: SendResponse | null, label?: string) {
  return renderToStaticMarkup(
    <ResponsePane
      name="users"
      response={value}
      responseSource="user"
      history={[]}
      historyId={null}
      onPickHistory={() => {}}
      onClearHistory={() => {}}
      sending={sending}
      sendingLabel={label}
      sendError={null}
    />,
  )
}

describe('response pending states', () => {
  test('first send announces standard activity instead of an empty hint beneath a dark cover', () => {
    const html = render(true, null)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('role="status"')
    expect(html).toContain('lx-activity-orb')
    expect(html).toContain('Sending')
    expect(html).not.toContain('Send to view the response.')
    expect(html).not.toContain('bg-background')
    expect(html).not.toContain('backdrop-blur')
  })

  test('resend retains the response and puts a named activity indicator in its chrome', () => {
    const html = render(true, response, 'Agent is sending…')
    expect(html).toContain('200 OK')
    expect(html).toContain('aria-label="Response body"')
    expect(html).toContain('aria-label="Agent is sending…"')
    expect(html).not.toContain('bg-background')
  })

  test('idle panes offer the next action without an activity indicator', () => {
    const html = render(false, null)
    expect(html).toContain('Send to view the response.')
    expect(html).toContain('aria-busy="false"')
    expect(html).not.toContain('lx-activity-orb')
  })
})
