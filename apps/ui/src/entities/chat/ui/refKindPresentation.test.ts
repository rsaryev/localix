import { describe, expect, test } from 'bun:test'
import { capabilityResourceUri } from '@localixai/mini-app-sdk/navigation'
import type { ContextRef } from '@/shared/api/contracts'
import { refIcon, refOpenAction } from './refKindPresentation'
import { Blocks } from 'lucide-react'
import { useChatStore } from '../model/store'
import { useMessageSearchStore } from '@/shared/lib/messageSearchBus'

describe('capability context-ref presentation', () => {
  test('uses a capability icon and routes the pill to the exact scoped setting', () => {
    const uri = capabilityResourceUri({
      kind: 'agent',
      id: 'reviewer',
      scope: 'PRJ-4',
      label: 'Reviewer',
      enabled: true,
    })
    const ref = {
      raw: `@resource:${uri}`,
      kind: 'resource',
      uri,
    } satisfies ContextRef
    let navigated = ''
    const open = refOpenAction(ref, {
      sessionId: null,
      navigate: () => {},
      navigateUi: (target) => {
        navigated = target
      },
    })

    expect(refIcon(ref)).toBe(Blocks)
    open?.()
    expect(navigated).toBe('localix://ui/settings/agents/agent-reviewer?scope=PRJ-4')
  })
})

describe('message context-ref navigation', () => {
  test('a cross-chat link navigates and leaves a focus request instead of a timed ring', () => {
    useChatStore.setState({
      allSessions: [{ id: 'S-2', projectId: 'PRJ-1' } as never],
      focusMessageId: null,
      focusMessageSessionId: null,
    })
    useMessageSearchStore.getState().setActiveId(null)
    let navigated = ''
    const open = refOpenAction(
      { raw: '@message:S-2/M-9', kind: 'message', sessionId: 'S-2', messageId: 'M-9' },
      { sessionId: 'S-1', navigate: (path) => (navigated = path) },
    )
    open?.()
    expect(navigated).toContain('S-2')
    expect(useChatStore.getState().focusMessageId).toBe('M-9')
    expect(useChatStore.getState().focusMessageSessionId).toBe('S-2')
    expect(useMessageSearchStore.getState().activeId).toBeNull()
    useChatStore.getState().clearMessageFocus()
  })

  test('a link inside its own chat rings the message directly', () => {
    useChatStore.getState().clearMessageFocus()
    const open = refOpenAction(
      { raw: '@message:S-1/M-3', kind: 'message', sessionId: 'S-1', messageId: 'M-3' },
      { sessionId: 'S-1', navigate: () => {} },
    )
    open?.()
    expect(useMessageSearchStore.getState().activeId).toBe('M-3')
    expect(useChatStore.getState().focusMessageId).toBeNull()
    useMessageSearchStore.getState().setActiveId(null)
  })
})
