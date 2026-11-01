/** Native WebView bridge entry: installs the bridge once per page (see `native-bridge.ts`). */
import { installNativeBridge } from './native-bridge'

if (!window.__localixBrowser) installNativeBridge()
