// Deterministic local page for the AppKit smoke check, not a product screenshot fixture.
export function fixtureScript(baseUrl, stage, expected) {
  return `(${run.toString()})(${JSON.stringify(baseUrl)},${JSON.stringify(stage)},${JSON.stringify(expected)}).catch(error => fetch(${JSON.stringify(baseUrl + '/result')}, {method:'POST',body:JSON.stringify({ok:false,error:String(error)})}))`
}

async function run(baseUrl, stage, expected) {
  void fetch(baseUrl + '/trace', { method: 'POST', body: 'fixture loaded' })
  const invoke = window.__TAURI__.core.invoke
  const id = window.__LOCALIX_WORKSPACE.id
  const nativeEvents = window.__TAURI__.event
  const events = {
    emitTo: nativeEvents.emitTo,
    listen: (name, handler) =>
      nativeEvents.listen(name, handler, { target: { kind: 'Webview', label: id } }),
  }
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100))
  const assert = (value, message) => {
    if (!value) throw new Error(message)
  }
  const probe = async () => {
    const state = await invoke('workspace_probe')
    assert(
      state.windows.every((w) => w.fullFrameMaterial && w.frameMaterialCount === 1),
      'Native glass geometry drifted or stacked after a window operation',
    )
    return state
  }
  const { verifyChrome: readChrome } = await import(baseUrl + '/native-window-fixture.js')
  const verifyChrome = () => readChrome({ probe, id, pause })
  const wait = async (predicate, message) => {
    let state
    for (let attempt = 0; attempt < 100; attempt++) {
      state = await probe()
      if (attempt === 0)
        void fetch(baseUrl + '/trace', {
          method: 'POST',
          body:
            'checkpoint: ' +
            message +
            ' (' +
            state.windows.length +
            ' windows, ' +
            state.session.groups.length +
            ' groups)',
        })
      if (predicate(state)) return state
      await pause()
    }
    const groups = state.session.groups.map((g) => [g.hidden, g.selected, g.tabs.length])
    const windows = state.windows.map((w) => [w.label.slice(-4), w.visible, w.key, w.minimized])
    throw new Error(`${message} ${JSON.stringify({ groups, windows })}`)
  }
  await events.listen('localix://before-quit', ({ payload }) => {
    void invoke('quit_ready', { requestId: payload.requestId })
  })
  await events.listen('probe:action', ({ payload }) => {
    void invoke('workspace_probe', { action: payload.action })
  })
  void fetch(baseUrl + '/trace', { method: 'POST', body: 'bridge listeners ready' })
  await events.listen('probe:finish', () => {
    void (async () => {
      try {
        const state = await wait(
          (s) => s.windows.length === 1 && s.windows[0].label === id,
          'Closing main removed the surviving workspace',
        )
        assert(state.windows[0].children.length === 2, 'Surviving browser child was lost')
        await invoke('browser_reload', { tabId: 'smoke-browser-12345678' })
        await fetch(baseUrl + '/result', {
          method: 'POST',
          body: JSON.stringify({ ok: true, second: id }),
        })
        await invoke('workspace_probe', { action: 'quit' })
      } catch (error) {
        await fetch(baseUrl + '/result', {
          method: 'POST',
          body: JSON.stringify({ ok: false, error: String(error) }),
        })
      }
    })()
  })
  await invoke('set_title', { title: `Smoke ${id}` })
  await invoke('workspace_location', { route: `/project/${id}` })
  await invoke('deep_link_ready')
  void fetch(baseUrl + '/trace', { method: 'POST', body: 'workspace ready ' + id })
  if (stage === 'restore') {
    if (id !== expected && window.__LOCALIX_WORKSPACE.route === null) return
    assert(id === expected, 'Restart changed the surviving workspace identity')
    assert(
      window.__LOCALIX_WORKSPACE.route === '/project/' + expected,
      'Restart lost the saved route',
    )
    await wait(
      (state) => state.windows.length === 1 && state.windows[0].key,
      'Restart created an extra main workspace or lost selection',
    )
    await invoke('workspace_open', { asTab: true })
    await wait(
      (state) => state.windows.length === 2 && state.session.groups.length === 1,
      'A restored workspace could not create another native tab',
    )
    const thirdTab = await invoke('workspace_open', { asTab: true })
    await wait(
      (state) => state.windows.length === 3 && state.session.groups[0].tabs.length === 3,
      'A third workspace did not join the restored group',
    )
    const state = await wait(
      (state) =>
        state.session.groups[0].tabs[state.session.groups[0].selected].label === thirdTab &&
        state.session.active === thirdTab,
      'The third workspace was not selected before saving',
    )
    await fetch(baseUrl + '/result', {
      method: 'POST',
      body: JSON.stringify({ ok: true, group: state.session.groups[0] }),
    })
    await invoke('workspace_probe', { action: 'quit' })
    return
  }
  if (stage === 'grouped-restore' || stage === 'hidden-restore') {
    const primary = expected.tabs[0].label
    if (id !== primary) return
    const state = await wait(
      (s) =>
        s.windows.length === expected.tabs.length &&
        s.session.groups.length === 1 &&
        s.session.groups[0].tabs.length === expected.tabs.length,
      'The saved native group was not restored',
    )
    let group = state.session.groups[0]
    assert(
      JSON.stringify(group.tabs.map((tab) => tab.label)) ===
        JSON.stringify(expected.tabs.map((tab) => tab.label)),
      'Restart changed tab order',
    )
    assert(group.selected === expected.selected, 'Restart lost the selected native tab')
    assert(
      JSON.stringify(group.tabs.map((tab) => tab.route)) ===
        JSON.stringify(expected.tabs.map((tab) => tab.route)),
      'Restart lost workspace project/session routes',
    )
    await verifyChrome()
    assert(
      Math.abs(group.frame[2] - expected.frame[2]) < 0.5 &&
        Math.abs(group.frame[3] - expected.frame[3]) < 0.5,
      'Restart shrank the native window by the tab bar height',
    )
    if (stage === 'grouped-restore') {
      await invoke('workspace_probe', { action: 'activate' })
      await wait(
        (state) => state.windows.find((w) => w.label === id)?.key,
        'Lifecycle fixture could not select its workspace',
      )
      const { verifyWindowLifecycle } = await import(baseUrl + '/native-window-fixture.js')
      group = await verifyWindowLifecycle({ invoke, probe, wait, events, id, verifyChrome })
    }
    await fetch(baseUrl + '/result', { method: 'POST', body: JSON.stringify({ ok: true, group }) })
    await invoke('workspace_probe', { action: stage === 'grouped-restore' ? 'hide_quit' : 'quit' })
    return
  }
  if (id !== 'main') return
  try {
    await wait((state) => state.windows.some((w) => w.key), 'Initial window never became key')
    assert(
      (await verifyChrome()).tabbarHeight === 0,
      'Standalone workspace reserved an empty tab row',
    )
    const second = await invoke('workspace_open', { asTab: true })
    let state = await wait(
      (s) => s.session.groups.some((g) => g.tabs.length === 2),
      'Second workspace did not join native group',
    )
    assert(
      state.windows.every((w) => w.overlay),
      'The breadcrumb toolbar no longer shares the native button row',
    )
    assert(
      state.windows.every((w) => w.transparentTitlebar && w.fullFrameMaterial),
      'The native glass header has no full-frame material backing',
    )
    assert(state.windows.find((w) => w.label === second)?.key, 'New native tab was not selected')
    const chrome = state.windows.find((w) => w.label === id).chromeGeometry
    void fetch(baseUrl + '/trace', {
      method: 'POST',
      body: 'chrome geometry: ' + JSON.stringify(chrome),
    })
    assert(
      chrome.titlebarHeight >= 28 && chrome.titlebarHeight <= 40,
      'Native titlebar was not measured',
    )
    assert(chrome.tabbarHeight > 0, 'Visible native tabs did not reserve a band')
    await verifyChrome()
    await invoke('workspace_probe', { action: 'native_toggle_tab_bar' })
    await pause()
    await verifyChrome()
    await invoke('workspace_probe', { action: 'native_toggle_tab_bar' })
    await pause()
    assert((await verifyChrome()).tabbarHeight > 0, 'Visible native tabs overlapped the workspace')
    const { readNativeHeaderTint } = await import(baseUrl + '/native-header-tint.js')
    document.documentElement.dataset.desktop = 'true'
    document.documentElement.dataset.os = 'mac'
    for (const [theme, material] of [
      ['light', 21],
      ['dark', 13],
    ]) {
      document.documentElement.dataset.theme = theme
      const headerTint = readNativeHeaderTint()
      assert(
        headerTint?.length === 4 && headerTint[3] > 0.6 && headerTint[3] < 0.9,
        'WKWebView could not resolve the translucent sidebar token',
      )
      assert(
        theme === 'dark' ? headerTint[0] < 0.2 : headerTint[0] > 0.8,
        'Native header colour did not follow the shared dark/light palette',
      )
      await invoke('set_theme', { theme, materialTheme: theme, headerTint })
      state = await probe()
      const current = state.windows.find((w) => w.label === id)
      const expectedTint = [...headerTint]
      assert(
        JSON.stringify(current.headerTint) === JSON.stringify(expectedTint),
        'Native header coat disagrees with the UI token',
      )
      assert(
        current.nativeBackdrop[0] && current.nativeBackdrop[1],
        'AppKit retained its separate titlebar backdrop on Tahoe: ' +
          JSON.stringify(current.nativeTitlebarViews),
      )
      assert(
        current?.fullFrameMaterial &&
          current.frameMaterial === material &&
          current.frameMaterialCount === 1,
        'A theme flip lost or stacked the shared native glass material',
      )
      await verifyChrome()
    }
    // Same browser tab ID in two windows must resolve to two different child webviews.
    await invoke('browser_open', { tabId: 'smoke-browser-12345678', url: baseUrl + '/browser' })
    await events.emitTo(second, 'probe:action', { action: 'browser' })
    state = await wait(
      (s) => s.windows.every((w) => w.children.length === 2),
      'Browser children were not isolated per workspace',
    )
    assert(
      new Set(state.windows.flatMap((w) => w.children)).size === 4,
      'Browser child labels collided',
    )
    await invoke('set_title', { title: 'Smoke main retained' })
    state = await probe()
    assert(
      state.windows.find((w) => w.label === 'main')?.title === 'Smoke main retained',
      'Caller title changed another window',
    )
    assert(
      state.windows.find((w) => w.label === second)?.title === 'Smoke ' + second,
      'Background title was overwritten',
    )
    await events.emitTo(second, 'probe:action', { action: 'native_detach_tab' })
    await wait((s) => s.session.groups.length === 2, 'Native detach did not separate windows')
    await verifyChrome()
    await events.emitTo(second, 'probe:action', { action: 'native_merge_windows' })
    await wait(
      (s) => s.session.groups.some((g) => g.tabs.length === 2),
      'Native merge did not rejoin windows',
    )
    await verifyChrome()
    // Exercise the responder selector used by the native tab bar's + button.
    await invoke('workspace_probe', { action: 'plus' })
    state = await wait(
      (s) => s.windows.length === 3 && s.session.groups.some((g) => g.tabs.length === 3),
      'The native + action did not create a workspace tab',
    )
    const third = state.windows.find((w) => w.label !== 'main' && w.label !== second).label
    await events.emitTo(third, 'probe:action', { action: 'close' })
    await wait((s) => s.windows.length === 2, 'The extra native tab did not close')
    // Closing the original main must leave the other workspace and browser operational.
    await events.emitTo(second, 'probe:finish', {})
    await invoke('workspace_probe', { action: 'close' })
  } catch (error) {
    await fetch(baseUrl + '/result', {
      method: 'POST',
      body: JSON.stringify({ ok: false, error: String(error) }),
    })
  }
}
