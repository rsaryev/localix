import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolLine } from './ToolLine'
import { ToolGateContext } from './toolGateContext'

const SESSION_GRANT = { decision: 'session-grant' } as const

test('permission provenance uses the managed tooltip contract', () => {
  const html = renderToStaticMarkup(
    <ToolGateContext.Provider value={SESSION_GRANT}>
      <ToolLine title="Read file">Details</ToolLine>
    </ToolGateContext.Provider>,
  )

  expect(html).toContain('aria-label="Auto-approved — you allowed this tool for the whole session"')
  expect(html).toContain('data-tooltip-trigger="true"')
  expect(html).not.toContain('title=')
})
