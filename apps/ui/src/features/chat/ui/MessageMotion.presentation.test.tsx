import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

import { TextBubble } from './MessageBubbles'

const cardSource = readFileSync(new URL('./MessageCard.tsx', import.meta.url), 'utf8')

test('virtualized message rows do not replay decorative entrance motion', () => {
  const user = renderToStaticMarkup(<TextBubble content="Hello" isUser />)
  const assistant = renderToStaticMarkup(<TextBubble content="Hello" isUser={false} />)

  expect(user).not.toContain('animate-fade-up')
  expect(assistant).not.toContain('animate-fade-up')
  expect(cardSource).not.toContain('animate-fade-up')
  expect(cardSource).not.toContain('const entering')
})
