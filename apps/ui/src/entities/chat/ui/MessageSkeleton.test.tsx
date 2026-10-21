import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { MessageSkeleton } from './MessageSkeleton'
import { avatarHue } from '@localixai/kit/avatar'

const author = { handle: 'researcher', name: 'Researcher', scope: '' }

const render = (node: React.ReactElement) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)

describe('MessageSkeleton', () => {
  test('names the agent before its first character arrives', () => {
    // The whole reason the author line is here and not only on settled rows: while a party
    // is in the session, "someone is thinking" tells the reader nothing they can act on.
    const html = render(<MessageSkeleton label="Working" author={author} />)
    expect(html).toContain('Researcher')
    expect(html).toContain(`--avatar-hue:${avatarHue('researcher')}`)
  })

  test('shows no clock: the row is not persisted, so it has no time to tell', () => {
    expect(render(<MessageSkeleton label="Working" author={author} />)).not.toContain(
      'tabular-nums',
    )
  })

  test('an unauthored row still renders its status', () => {
    const html = render(<MessageSkeleton label="Generating title" />)
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('monogram-avatar')
  })

  test('pre-token activity stays in place without skeleton or entrance chrome', () => {
    const html = render(<MessageSkeleton label="Working…" author={author} />)

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('lx-activity-orb')
    expect(html).not.toContain('animate-fade-up')
    expect(html).not.toContain('skeleton')
    expect(html).not.toContain('bg-surface')
  })
})
