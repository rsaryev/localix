import { describe, expect, test } from 'bun:test'

import { systemNotices, systemNoticeMessage } from './systemNotices'
import type { SystemNotice } from './types'

describe('systemNoticeMessage', () => {
  const notice = { kind: 'model_change', tone: 'info', text: 'x' } as SystemNotice

  test('wraps the notice as a system-role message', () => {
    const msg = systemNoticeMessage(notice)
    expect(msg.role).toBe('system')
    expect(msg.systemNotice).toBe(notice)
  })

  test('embeds the notice kind in the id', () => {
    expect(systemNoticeMessage(notice).id.startsWith('sys-model_change-')).toBe(true)
  })

  test('gives each notice a UNIQUE id so repeats stack (no React-key collision)', () => {
    expect(systemNoticeMessage(notice).id).not.toBe(systemNoticeMessage(notice).id)
  })
})

describe('systemNotices', () => {
  test('connectionChange names the connection', () => {
    expect(systemNotices.connectionChange('My Key').systemNotice).toMatchObject({
      kind: 'connection_change',
      tone: 'info',
      text: 'Connection switched to My Key',
    })
  })

  test('the events the AGENTS have to read are not drawn here', () => {
    // A model change and a reasoning change are written by the server as ordinary, model-visible
    // rows that name the agent (`runtime/session-notice.ts`). A client-only copy would
    // print the same event twice and disagree with it about whose change it was — so the
    // builders for them must not come back. This is the positive control for that.
    expect(Object.keys(systemNotices)).toEqual(['connectionChange'])
  })

  test('every builder produces a system-role message with a notice attached', () => {
    for (const build of Object.values(systemNotices)) {
      const msg = build('x')
      expect(msg.role).toBe('system')
      expect(msg.systemNotice).toBeDefined()
      expect(msg.id).toStartWith('sys-')
    }
  })
})
