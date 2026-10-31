import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installQuitFlush } from '@/shared/lib/quitFlush'
import { TooltipProvider } from '@localixai/kit/tooltip'
import { applyPlatformDataset } from '@localixai/kit/environment'
import { RootErrorBoundary } from './RootErrorBoundary'
import { ActionRegistryProvider } from '@/shared/lib/actions/ActionRegistryProvider'
import { AgentIslandPage } from '@/pages/agent-island/ui/AgentIslandPage'

const stopQuitFlush = installQuitFlush()
if (import.meta.hot) import.meta.hot.dispose(stopQuitFlush)
applyPlatformDataset()
document.documentElement.dataset.island = 'true'
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <TooltipProvider>
        {/* The one key dispatcher: Enter and Escape reach the request card through it. */}
        <ActionRegistryProvider>
          <AgentIslandPage />
        </ActionRegistryProvider>
      </TooltipProvider>
    </RootErrorBoundary>
  </StrictMode>,
)
