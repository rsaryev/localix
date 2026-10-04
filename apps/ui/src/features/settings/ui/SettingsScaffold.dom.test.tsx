import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('native settings rows', () => {
  test('uses a compact IDE page hierarchy instead of landing-page scale', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { SettingsPage } = await import('./SettingsScaffold')

    const html = renderToStaticMarkup(
      <SettingsPage title="General" description="Configure the workspace">
        Settings
      </SettingsPage>,
    )

    expect(html).toContain('space-y-6')
    expect(html).toContain('text-2xl')
    expect(html).toContain('sm:text-3xl')
    expect(html).toContain('text-balance')
  })

  test('uses transparent bounded surfaces instead of permanent card backgrounds', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { SettingsRow, SettingsRows, SettingsSurface } = await import('./SettingsScaffold')

    const html = renderToStaticMarkup(
      <>
        <SettingsSurface>Profile form</SettingsSurface>
        <SettingsRows>
          <SettingsRow>First setting</SettingsRow>
          <SettingsRow>Second setting</SettingsRow>
        </SettingsRows>
      </>,
    )

    expect(html).toContain('border-y')
    expect(html).toContain('divide-y')
    expect(html).not.toContain('rounded-xl')
    expect(html).not.toContain('bg-muted/10')
  })

  test('shows shell-command installation with the shared in-row activity signal', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { shellCommandApi } = await import('@/shared/api/shell-command-client')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')
    const { GeneralSettings } = await import('./GeneralSettings')
    const installedStatus = {
      state: 'installed' as const,
      targetPath: '/workspace/bin/localix',
      binDir: '/workspace/bin',
      onPath: true,
      available: true,
    }
    const status = spyOn(shellCommandApi, 'status').mockResolvedValue(installedStatus)
    let finishInstall: (() => void) | undefined
    const install = spyOn(shellCommandApi, 'install').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishInstall = () => resolve(installedStatus)
        }),
    )

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <WorkItemVisibilityProvider visible>
          <GeneralSettings />
        </WorkItemVisibilityProvider>,
      )
      await settle()
    })

    const reinstall = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reinstall',
    )
    expect(reinstall).toBeDefined()

    await act(async () => {
      reinstall?.click()
      await Promise.resolve()
    })

    expect(install).toHaveBeenCalledTimes(1)
    expect(reinstall?.getAttribute('aria-busy')).toBe('true')
    expect(reinstall?.innerHTML).toContain('lx-activity-orb')
    expect(reinstall?.textContent).toContain('Installing')
    expect(container.textContent).not.toContain('Working…')

    await act(async () => {
      finishInstall?.()
      await Promise.resolve()
    })
    expect(reinstall?.hasAttribute('aria-busy')).toBe(false)

    await act(async () => root.unmount())
    status.mockRestore()
    install.mockRestore()
  })
})
