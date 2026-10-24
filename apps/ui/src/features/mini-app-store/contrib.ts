import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import { provideStoreAppExtra } from '@/shared/lib/storeAppExtra'
import { useDesktopExtra } from './desktopExtra'

/**
 * What mini apps add to the Store's UI: the desktop app beside Install. The Store itself is
 * `features/store`; this slice's surfaces keep the mini app store's old addresses working.
 */
export function registerUi(_host: MiniAppUiHost): void {
  provideStoreAppExtra(useDesktopExtra)
}
