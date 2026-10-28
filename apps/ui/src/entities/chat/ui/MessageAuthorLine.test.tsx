import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { AUTHOR_BODY_INDENT, MessageAuthorLine } from './MessageAuthorLine'
import { agentProfileUri } from '@/shared/contrib/useAgentIdentity'
import { avatarHue } from '@localixai/kit/avatar'

const author = { name: 'code-reviewer', scope: '' }

const render = (clock: string, triggerLabel?: string) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <MessageAuthorLine author={author} clock={clock} triggerLabel={triggerLabel} />
    </MemoryRouter>,
  )

describe('MessageAuthorLine', () => {
  test('explains a background turn beside its author', () => {
    expect(render('10:36', 'Loop')).toContain('via Loop')
    expect(render('10:36')).not.toContain('via ')
  })
  test('the name wears the same hue as the tile', () => {
    // The pairing is the whole point: it is what lets a reader follow one speaker down a
    // transcript. Two independent colours for one identity would read as two speakers.
    const html = render('10:36')
    expect(html.match(new RegExp(`--avatar-hue:${avatarHue('code-reviewer')}`, 'g'))).toHaveLength(
      2,
    )
    expect(html).toContain('code-reviewer')
    expect(html).toContain('10:36')
  })

  test('tile and name are ONE control to the agent profile', () => {
    // Two adjacent buttons for one identity would be two tab stops saying the same thing.
    const html = render('')
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).toContain('profile')
  })

  test('no timestamp leaves no empty slot', () => {
    expect(render('')).not.toContain('tabular-nums')
  })

  test('the body indent matches the gutter the line occupies', () => {
    // 26px tile + the line's own 0.5rem gap. A drift here is a hanging indent nobody chose.
    expect(AUTHOR_BODY_INDENT).toBe('pl-[2.125rem]')
    expect(render('')).toContain('width:26px')
  })
})

describe('agentProfileUri', () => {
  test('addresses the agent by its id, on its Store page', () => {
    // An agent id is unique across scopes, so the id alone finds a project agent too.
    expect(agentProfileUri(author)).toContain('kind=agent')
    expect(agentProfileUri(author)).toContain('id=code-reviewer')
    expect(agentProfileUri({ ...author, scope: 'proj-7' })).toBe(agentProfileUri(author))
  })
})
