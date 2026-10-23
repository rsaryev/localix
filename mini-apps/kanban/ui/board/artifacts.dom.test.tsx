import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing'
import {
  bindMiniAppUiRuntime,
  type MiniAppOpenFileRequest,
  type MiniAppUiRuntime,
} from '@localixai/mini-app-sdk/ui/runtime'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'

import type { KanbanArtifact } from '../../shared/contracts'
import { ArtifactList } from './artifacts'

let teardown: () => Promise<void>
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const priorActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => {
  teardown = registerDom()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  if (priorActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment
})

/**
 * A card's file and command act in the chat whose board the card is on — the tab's own. They used
 * to act in whichever chat was in front: a card of chat A opened its file in chat B's workspace and
 * pasted its command into B's shell. Outside a chat's tab nothing is offered, because there is no
 * workspace or shell to act in and guessing one is the defect.
 */
const artifacts: KanbanArtifact[] = [
  { kind: 'file', value: '/repo/CHANGELOG.md' },
  { kind: 'command', value: 'bun test' },
]

async function render(sessionId: string | null) {
  const files: MiniAppOpenFileRequest[] = []
  const pastes: { sessionId: string; command: string }[] = []
  const unbind = bindMiniAppUiRuntime({
    workspace: { openFile: (request: MiniAppOpenFileRequest) => files.push(request) },
    terminal: { paste: (request: { sessionId: string; command: string }) => pastes.push(request) },
  } as unknown as MiniAppUiRuntime)
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <WorkItemSessionProvider sessionId={sessionId}>
        <ArtifactList artifacts={artifacts} />
      </WorkItemSessionProvider>,
    ),
  )
  const cleanup = async () => {
    await act(async () => root.unmount())
    host.remove()
    unbind()
  }
  return { host, files, pastes, cleanup }
}

test('a file opens, and a command is pasted, in the chat the board belongs to', async () => {
  const { host, files, pastes, cleanup } = await render('chat-a')
  try {
    const buttons = [...host.querySelectorAll('button')]
    expect(buttons).toHaveLength(2)
    await act(async () => buttons.forEach((button) => button.click()))
    expect(files).toEqual([{ sessionId: 'chat-a', path: '/repo/CHANGELOG.md' }])
    expect(pastes).toEqual([{ sessionId: 'chat-a', command: 'bun test' }])
  } finally {
    await cleanup()
  }
})

test('outside a chat the payloads are text, not actions', async () => {
  const { host, cleanup } = await render(null)
  try {
    expect(host.querySelectorAll('button')).toHaveLength(0)
    expect(host.textContent).toContain('/repo/CHANGELOG.md')
    expect(host.textContent).toContain('bun test')
  } finally {
    await cleanup()
  }
})
