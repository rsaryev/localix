import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  test('does not put activity beside the title or timestamp', () => {
    const html = row({ isRunning: true })
    expect(html).not.toContain('lx-activity-orb')
    expect(html).not.toContain('lx-spinner')
  })
})

describe('the row geometry', () => {
  test('uses one leading icon slot for root and nested running sessions', () => {
    const source = readFileSync(resolve(import.meta.dir, 'SessionItem.tsx'), 'utf8')
    expect(source).toContain('data-slot="session-row-icon"')
    expect(source).toContain('session.isRunning ? (')
    expect(source).toContain('aria-label="Working"')
    expect(source).not.toContain('showActivity=')
    expect(source.indexOf('data-slot="session-row-icon"')).toBeLessThan(
      source.indexOf('{isRenaming ? ('),
    )
  })
  test('keeps its actions reachable even while running', () => {
    const source = readFileSync(resolve(import.meta.dir, 'SessionItem.tsx'), 'utf8')
    expect(source).not.toMatch(/!isGenerating\s*&&/)
    expect(source).toContain('<SessionItemActions')
  })

  test('keeps actions in the row flow so they cannot overlap metadata', () => {
    const source = readFileSync(resolve(import.meta.dir, 'SessionItem.tsx'), 'utf8')
    const actions = readFileSync(resolve(import.meta.dir, 'SessionItemActions.tsx'), 'utf8')
    expect(source).toContain('SESSION_ROW_HEIGHT_CLASS,')
    expect(actions).toContain('shrink-0')
    expect(actions).not.toContain('absolute')
  })
})
