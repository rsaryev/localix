import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import { provideStoreInstallExtra } from '@/shared/lib/storeInstallExtra'
import { useDesktopExtra } from './desktopExtra'

let withdraw = () => {}

/**
 * What mini apps add to the Store's UI: the desktop app, an install extra beside Install. The
 * Store itself is `features/store`; this slice's surfaces keep the mini app store's old addresses
 * working.
 */
export function registerUi(_host: MiniAppUiHost): void {
  withdraw = provideStoreInstallExtra(useDesktopExtra)
}

/** Take the extra back, as a test that registered it does. */
export function withdrawUi(): void {
  withdraw()
  withdraw = () => {}
}
