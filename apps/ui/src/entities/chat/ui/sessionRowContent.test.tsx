import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UiSession } from '@/shared/api/contracts'
import { SessionRowContent, SessionRowMeta } from './SessionRowContent'

function row(session: Partial<UiSession>) {
  const data = { id: 's1', updatedAt: 0, isRunning: false, ...session } as UiSession
  return renderToStaticMarkup(
    <>
      <SessionRowContent session={data} title="Fix the parser" isActive={false} />
      <SessionRowMeta session={data} />
    </>,
  )
}

describe('the compact session row', () => {
  test('shows the external agent mark before the session title', () => {
    for (const [provider, label] of [
      ['codex', 'Codex'],
      ['claude-code', 'Claude Code'],
      ['gemini-cli', 'Gemini CLI'],
      ['github-copilot', 'GitHub Copilot'],
      ['opencode', 'OpenCode'],
      ['hermes', 'Hermes'],
    ]) {
      const html = row({ externalAgentProvider: provider })
      expect(html).toContain(`aria-label="${label}"`)
      expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('Fix the parser'))
    }
  })

  test('uses a generic agent icon for unknown providers', () => {
    expect(row({ externalAgentProvider: 'custom-agent' })).toContain('lucide-bot')
    expect(row({ externalAgentProvider: 'custom-agent' })).toContain('aria-label="custom-agent"')
  })

  test('shows the Localix bird before the title of ordinary chats', () => {
    const html = row({})
    expect(html).toContain('aria-label="Localix"')
    expect(html.indexOf('aria-label="Localix"')).toBeLessThan(html.indexOf('Fix the parser'))
    expect(html).not.toContain('lucide-bot')
  })

  test('shows the title and time but never previews the last message', () => {
    const html = row({
      lastMessage: { from: 'user', text: 'private preview text', at: 0 },
    })
    expect(html).toContain('Fix the parser')
    expect(html).toContain('Updated')
    expect(html).not.toContain('private preview text')
  })

  test('keeps unread and pinned statuses in one slot after the timestamp', () => {
    const unread = row({ isUnread: true, isPinned: true })
    expect(unread.indexOf('Unread conversation')).toBeGreaterThan(unread.indexOf('Updated'))
    expect(unread).not.toContain('lucide-pin')
    expect(row({ isPinned: true })).toContain('lucide-pin')
  })

  test('uses the same metadata layout for nested sessions', () => {
    const html = renderToStaticMarkup(
      <SessionRowMeta session={{ id: 'child', updatedAt: 0, isUnread: true } as UiSession} />,
    )
    expect(html).toContain('Updated')
    expect(html).toContain('Unread conversation')
  })
})
