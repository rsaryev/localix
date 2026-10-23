import { StrictMode } from 'react'
import { installQuitFlush } from '@/shared/lib/quitFlush'
import { MemoryRouter } from 'react-router'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@localixai/kit/tooltip'
import { applyPlatformDataset } from '@localixai/kit/environment'
import { RootErrorBoundary } from './RootErrorBoundary'
import { CompanionPage } from '@/pages/companion/ui/CompanionPage'
import { registerAgentRunPreflight } from '@/shared/api/agentRunPreflight'
import { registerSessionPreviews } from '@/shared/lib/sessionPreviews'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { finishTerminalTabs } from '@/features/terminal/model/deadTerminalTabs'
import { inspectorSessionPreviews } from '@/features/inspector/model/sessionPreviewRouters'
import { waitForRuntimeCapabilities } from '@/shared/contrib/runtimeCapabilityReadiness'
import { bindMiniAppUiToast } from '@localixai/mini-app-sdk/ui'
import { createMiniAppToast } from '@/shared/contrib/miniAppToast'
import { toast } from '@/shared/lib/notify'
import './miniAppRuntime'
import { installMiniAppSharedModules } from './miniAppSharedModules'
import { discoverUi } from '@/shared/contrib/discover'

installMiniAppSharedModules()
discoverUi()

const stopQuitFlush = installQuitFlush()
if (import.meta.hot) import.meta.hot.dispose(stopQuitFlush)
applyPlatformDataset()
document.documentElement.dataset.companion = 'true'
registerAgentRunPreflight(waitForRuntimeCapabilities)
registerSessionPreviews(inspectorSessionPreviews)
// A finished terminal retires its transcript actions here too.
terminalBus.setFinisher(finishTerminalTabs)
// Mini app views in the shared transcript publish through the host's notifications here too;
// without this binding their first toast throws.
bindMiniAppUiToast(createMiniAppToast(toast))
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <TooltipProvider>
        <MemoryRouter>
          <CompanionPage />
        </MemoryRouter>
      </TooltipProvider>
    </RootErrorBoundary>
  </StrictMode>,
)
