import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { recordingPluginUiHost } from '@localixai/plugin-sdk/ui/testing'
import type { StatusItemContribution, WorkItemKindContribution } from '@localixai/plugin-sdk/ui'

import { registerUi } from './register'

/**
 * What this plugin puts into the workbench, through the SDK's recording host.
 *
 * The recording host rather than a hand-built literal: the contract owns which registries exist,
 * so a seam added to it can never break a plugin that does not use that seam. Four plugins whose
 * tests DID build the literal broke at once when status items landed.
 */
test('contributes the roster tab and ONE titlebar surface for the launchers', () => {
  const { host, registrations } = recordingPluginUiHost()

  registerUi(host)

  const workItems = registrations.workItems as WorkItemKindContribution[]
  const items = registrations.statusItems as StatusItemContribution[]

  expect(workItems.map((item) => item.kind)).toEqual(['external-agents:workspace'])
  // The roster opens transcripts into ITS chat, so it is a session kind; registered 'global' it
  // had no chat to name for them.
  expect(workItems[0]?.scope).not.toBe('global')
  // Outside a host provider there is no chat (`useWorkItemSessionId()` is null): nothing to open.
  const html = renderToStaticMarkup(
    createElement(workItems[0]!.Component, {
      item: { id: 'external-agents:workspace', kind: 'external-agents:workspace', title: 'x' },
    }),
  )
  expect(html).toContain('from a chat')

  // NO ui locations. The launchers had a second home behind the terminal tab strip's chevron, and
  // it was broken in a way nothing could see: the adapter that resolved those URIs dropped the
  // command, so all six opened a plain shell. One surface is the property worth freezing — a
  // re-registration here would resurrect a menu that only appears while a terminal tab is active.
  expect(registrations.locations ?? []).toEqual([])

  expect(items.map(({ id, placement }) => ({ id, placement }))).toEqual([
    { id: 'external-agents:agents', placement: 'titlebar' },
  ])
  expect(typeof items[0]?.useItem).toBe('function')
})
