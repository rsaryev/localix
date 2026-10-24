import { storeApi } from '@/shared/api/store-client'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import type { StoreTarget } from '@/shared/lib/openStore'
import { useStoreInstallExtras } from '@/shared/lib/storeInstallExtra'
import { navigateUi } from '@/shared/lib/uiNavigation'
import { StoreView } from './StoreView'

/**
 * The Store's tab: the Store over `/rpc/store`, with the install extras other features
 * provide, and Configure going to the provider's settings through the app's navigation.
 */
export function StorePage({ target }: { target?: StoreTarget }) {
  const extras = useStoreInstallExtras()
  const navigation = useUiNavigation({ sessionId: null })
  return (
    <div className="h-full min-h-0">
      <StoreView
        client={storeApi}
        target={target}
        extras={extras}
        onConfigure={(uri) => void navigateUi(uri, navigation)}
      />
    </div>
  )
}
