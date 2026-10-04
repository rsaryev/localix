import { describe, expect, test } from 'bun:test'
import { capabilityResourceUri } from '@localixai/plugin-sdk/navigation'
import type { ContextRef } from '@/shared/api/contracts'
import { refIcon, refOpenAction } from './refKindPresentation'
import { Blocks } from 'lucide-react'

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
