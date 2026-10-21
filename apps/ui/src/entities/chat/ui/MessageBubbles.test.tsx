import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { detectCommand, TextBubble } from './MessageBubbles'

describe('TextBubble author', () => {
  test('marks who wrote the text, which the reply-title rule in markdown.css keys on', () => {
    // Only an agent's reply centres a leading `#` title; a person's message must not.
    const agent = renderToStaticMarkup(<TextBubble content="# Coffee guide" isUser={false} />)
    const person = renderToStaticMarkup(<TextBubble content="# My notes" isUser />)
    expect(agent).toContain('data-author="agent"')
    expect(person).toContain('data-author="user"')
  })
})

describe('TextBubble command presentation', () => {
  test('uses the command glyph without nesting another surface chip', () => {
    const html = renderToStaticMarkup(<TextBubble content="/plugin install owner/review" isUser />)

    expect(html).toContain('lucide-square-terminal')
    expect(html).toContain('/plugin install')
    expect(html).toContain('owner/review')
    expect(html).not.toContain('bg-surface-hover')
    expect(html).not.toContain('ring-border')
  })

  test('groups structural choices and keeps the remaining argument as prose', () => {
    expect(detectCommand('/plugin install owner/repo')).toEqual({
      label: '/plugin install',
      arg: 'owner/repo',
    })
    expect(detectCommand('/plugin marketplace add owner/repo')).toEqual({
      label: '/plugin marketplace add',
      arg: 'owner/repo',
    })
  })
})
