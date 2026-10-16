// Window-level close/reopen operations against actual native buttons and AppKit tab groups.
export async function verifyWindowLifecycle({ invoke, probe, wait, events, id, verifyChrome }) {
  await wait(
    (state) =>
      state.windows.some((window) =>
        window.nativeTabButtons.some(
          ([name, , bordered]) => name === 'NSTabBarNewTabButton' && !bordered,
        ),
      ),
    'The native new-tab button retained its raised bezel',
  )
  const original = (await probe()).session.groups[0]
  const assert = (value, message) => {
    if (!value) throw new Error(message)
  }
  const sameGroup = (state) => {
    const group = state.session.groups.find((g) => g.tabs.some((tab) => tab.label === id))
    assert(group, 'The hidden workspace group disappeared')
    assert(
      JSON.stringify(group.tabs) === JSON.stringify(original.tabs),
      'Window close/reopen changed workspace identities, order or routes',
    )
    assert(group.selected === original.selected, 'Window close/reopen changed the selected tab')
  }

  const hidden = await invoke('workspace_probe', { action: 'red_close_reopen' })
  assert(hidden.lifecycleComplete, 'The native red button did not hide the entire group')
  assert(hidden.windows.length === 3, 'The native red button destroyed workspaces')
  sameGroup(hidden)
  await wait(
    (state) => state.windows.some((w) => w.key && w.visible),
    'Native close could not reopen',
  )

  // New Workspace Window stays an explicit fresh-window action after reopening a retained group.
  const fresh = await invoke('workspace_open', { asTab: false })
  const freshState = await wait(
    (state) => state.windows.length === 4 && state.windows.find((w) => w.label === fresh)?.key,
    'New Workspace Window did not create a fresh window',
  )
  assert(freshState.session.groups.length === 2, 'New Workspace Window reused the existing group')
  await events.emitTo(fresh, 'probe:action', { action: 'close' })
  await wait(
    (state) => state.windows.length === 3,
    'Explicit tab close retained the fresh workspace',
  )

  // This is the common path used by Dock reopen, tray Show and external launch/deep links.
  await invoke('workspace_probe', { action: 'reopen' })
  const reopened = await wait(
    (state) => state.windows.some((w) => w.key && w.visible),
    'Dock/tray reopen did not reveal the hidden workspace group',
  )
  sameGroup(reopened)
  await verifyChrome()

  // Window > Close Window uses the same bounded flush + hide as the native button.
  const menuHidden = await invoke('workspace_probe', { action: 'hide_window_reopen' })
  assert(menuHidden.lifecycleComplete, 'Close Window did not preserve and hide the group')
  sameGroup(menuHidden)
  await invoke('workspace_probe', { action: 'reopen' })
  await wait(
    (state) => state.windows.some((w) => w.key && w.visible),
    'Menu close could not reopen',
  )

  const minimized = await invoke('workspace_probe', { action: 'minimize_reopen' })
  assert(minimized.lifecycleComplete, 'Native minimize failed')
  const unminimized = await wait(
    (state) =>
      state.windows.some((w) => w.key && w.visible) && state.windows.every((w) => !w.minimized),
    'Dock/tray reopen left the workspace group minimized',
  )
  sameGroup(unminimized)
  await verifyChrome()

  return original
}

export async function verifyChrome({ probe, id, pause }) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await probe()
    const geometry = state.windows.find((w) => w.label === id).chromeGeometry
    const toolbar = document.querySelector('.app-titlebar')
    const bodyTop = document.querySelector('main').getBoundingClientRect().top
    if (
      Math.abs(toolbar.getBoundingClientRect().height - geometry.titlebarHeight) < 0.5 &&
      Math.abs(bodyTop - geometry.titlebarHeight - geometry.tabbarHeight) < 0.5 &&
      Math.abs(Number.parseFloat(getComputedStyle(toolbar).paddingLeft) - geometry.buttonGap) < 0.5
    )
      return geometry
    await pause()
  }
  throw new Error('UI chrome did not follow AppKit button and native-tab geometry')
}
