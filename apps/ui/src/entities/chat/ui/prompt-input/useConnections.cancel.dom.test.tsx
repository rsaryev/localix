import { expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

test('declining provider sign-in clears OAuth state, releases the form, and allows retry', async () => {
  const teardown = registerDom()
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const { useChatStore } = await import('@/entities/chat/model/store')
  const { useConnections } = await import('./useConnections')
  const { AddConnectionForm } = await import('./model-select/AddConnectionForm')
  const { ActionConfirm } = await import('@/shared/ui/ActionConfirm')
  const { resetConfirmationsForTests } = await import('@/shared/lib/confirmAction')
  const { configurePlatformCapabilities } = await import('@/shared/lib/platformCapabilities')
  const { confirmExternalHandoff } = await import('@/shared/lib/externalLink')
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  resetConfirmationsForTests()
  const previousStore = useChatStore.getState()
  const restorePlatform = configurePlatformCapabilities({
    external: { requestOpen: confirmExternalHandoff },
  })
  const initiate = spyOn(backendClient, 'initiateOAuth').mockResolvedValue({
    state: 'cancel-sign-in',
    mode: 'local-server',
    redirectUrl: 'https://auth.example.test/',
  })
  const update = spyOn(backendClient, 'updateSession')
  const refresh = spyOn(backendClient, 'listConnections').mockResolvedValue([])
  // The form reads the model catalog on mount; answer it here instead of the network.
  const catalog = spyOn(backendClient, 'getCatalog').mockResolvedValue({} as never)
  const added = mock(() => {})
  useChatStore.setState({ connections: [] })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  function Harness() {
    const connections = useConnections('desktop-current')
    return (
      <>
        <AddConnectionForm
          provider={
            { id: 'openai', name: 'OpenAI' } as Parameters<typeof AddConnectionForm>[0]['provider']
          }
          isOAuth
          onAdded={added}
          onAddApiKey={() => {}}
          onAddOAuth={(label) => connections.addOAuthConnection('openai', 'OpenAI', label)}
        />
        <ActionConfirm />
      </>
    )
  }
  const button = (text: string) =>
    Array.from(document.querySelectorAll('button')).find((element) => element.textContent === text)!
  try {
    await act(async () => root.render(<Harness />))
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => button('Connect via OAuth').click())
      expect(button('Connecting').disabled).toBe(true)
      expect(document.querySelector('[role="alertdialog"]') !== null).toBe(true)
      await act(async () => button('Stay here').click())
      expect(button('Connect via OAuth').disabled).toBe(false)
      expect(document.querySelector('[role="alertdialog"]')).toBeNull()
      expect(sessionStorage.getItem('localix_oauth_state')).toBeNull()
      expect(sessionStorage.getItem('localix_oauth_session_id')).toBeNull()
    }
    expect(initiate).toHaveBeenCalledTimes(2)
    expect(refresh).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(added).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    resetConfirmationsForTests()
    initiate.mockRestore()
    update.mockRestore()
    catalog.mockRestore()
    restorePlatform()
    useChatStore.setState(previousStore, true)
    await teardown()
  }
})
