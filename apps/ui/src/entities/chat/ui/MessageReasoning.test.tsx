import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MessageReasoning } from './MessageReasoning'

test('reasoning stays a quiet line while the shared run status owns motion', () => {
  const html = renderToStaticMarkup(
    <MessageReasoning text="Inspecting the workspace" isStreaming />,
  )

  expect(html).toContain('Reasoning…')
  expect(html).not.toContain('animate-fade-up')
  expect(html).not.toContain('animate-pulse')
  expect(html).not.toContain('bg-surface')
})
