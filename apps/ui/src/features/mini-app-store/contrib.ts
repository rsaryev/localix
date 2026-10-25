import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import { provideStoreInstallExtra, provideStoreOpener } from '@/shared/lib/storeInstallExtra'
import { useDesktopExtra } from './desktopExtra'
import { openInstalledMiniApp } from './openInstalled'

let withdraw = () => {}

/**
 * What mini apps add to the Store's UI: the desktop app, an install extra beside Get, and where
 * an installed mini app opens, so its Get button says Open. The Store itself is
 * `features/store`; this slice's surfaces keep the mini app store's old addresses working.
 */
export function registerUi(_host: MiniAppUiHost): void {
  const extra = provideStoreInstallExtra(useDesktopExtra)
  const opener = provideStoreOpener(openInstalledMiniApp)
  withdraw = () => {
    extra()
    opener()
  }
}

/** Take the extra and the opener back, as a test that registered them does. */
export function withdrawUi(): void {
  withdraw()
  withdraw = () => {}
}
