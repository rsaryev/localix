// Tauri's single beforeDevCommand. The CLI owns this process and kills its
// descendants on exit; this module only adds tauri-build's staging prerequisites
// before delegating to the shared API+Vite supervisor in the same process.
import { stageSidecarBun, stageGateResourcesMarker } from './tauri-staging.mjs'
import { runDevServers } from '../../../scripts/dev-servers.mjs'

stageSidecarBun()
stageGateResourcesMarker()
process.exitCode = await runDevServers()
