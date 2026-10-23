import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'
import type {
  FileEditorContribution,
  StatusItemContribution,
  WorkItemKindContribution,
} from '@localixai/mini-app-sdk/ui'

import { __resetApiUiRegistration, registerUi, requestNameFromFilePath } from './register'

/**
 * Registration goes through the SDK's recording host, not a hand-built literal.
 *
 * The literal this replaced named the five seams the mini app used and cast past the rest, so the
 * day the contract grew one more, `registerUi` died on `undefined.register` — inside the tests
 * whose job is to prove registration works. The completeness check belongs in the package that
 * owns the contract, and does.
 */
function register() {
  __resetApiUiRegistration()
  const { host, registrations } = recordingMiniAppUiHost()
  registerUi(host)
  return registrations
}

describe('API request file integration', () => {
  test('claims only the typed compound extension', () => {
    const editors = register().fileEditors as FileEditorContribution[]

    expect(editors).toHaveLength(1)
    expect(editors[0]?.id).toBe('api:request-file')
    expect(editors[0]?.match('/workspace/.localix/api/users/list.request.json')).toBe(true)
    expect(editors[0]?.match('/workspace/.localix/api/users/list.json')).toBe(false)
  })

  test('ambient workspace guidance tells the agent to batch multiple API operations', () => {
    const workItems = register().workItems as WorkItemKindContribution[]

    const workspace = workItems.find((item) => item.kind === 'api:workspace')
    expect(workspace?.agentContext).toMatchObject({ tools: ['api_client'] })
    expect(JSON.stringify(workspace?.agentContext)).toContain('action=batch')
    expect(JSON.stringify(workspace?.agentContext)).toContain('never call it once per request')
  })

  test('both tab kinds belong to a chat, and render nothing of a collection without one', () => {
    // The collection lives in a chat's project. Registered 'global', the workspace followed the
    // active chat and sent or saved against whichever project was on screen.
    const workItems = register().workItems as WorkItemKindContribution[]
    const kinds = workItems.filter((item) => item.kind.startsWith('api:'))
    expect(kinds.map((item) => item.kind).sort()).toEqual(['api:request', 'api:workspace'])
    for (const kind of kinds) {
      expect(kind.scope).not.toBe('global')
      // Outside a host provider `useWorkItemSessionId()` is null: an app-level placement.
      const html = renderToStaticMarkup(
        createElement(kind.Component, {
          item: { id: kind.kind, kind: kind.kind, title: 'x', payload: { name: 'x' } },
          publishMessageContext: () => {},
        }),
      )
      expect(html).toContain('from a chat')
    }
  })

  test('contributes a declared titlebar item, not a drawn one', () => {
    const items = register().statusItems as StatusItemContribution[]

    expect(items.map(({ id, placement }) => ({ id, placement }))).toEqual([
      { id: 'api:environment', placement: 'titlebar' },
    ])
  })

  test('maps nested files in the session collection back to request names', () => {
    expect(
      requestNameFromFilePath('/workspace/LOCALIX-849/.localix/api/users/list.request.json'),
    ).toBe('users/list')
    expect(
      requestNameFromFilePath('/workspace/LOCALIX-849/.localix/api/environments/dev.request.json'),
    ).toBeUndefined()
    expect(requestNameFromFilePath('/workspace/LOCALIX-849/other.request.json')).toBeUndefined()
  })

  test('a file that is not a saved request says so as a final state, not a spinner', () => {
    // It rendered through LoadingHint — `role="status"` and an activity orb that never settled.
    const { Component } = (register().fileEditors as FileEditorContribution[])[0]!
    const html = renderToStaticMarkup(
      createElement(Component, { path: '/workspace/other.request.json' } as never),
    )
    expect(html).toContain('Not a saved API request.')
    expect(html).not.toContain('role="status"')
  })
})
