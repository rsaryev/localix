import { RouterProvider } from 'react-router/dom'
import { router } from '@/app/routing/router'
import { FileDropOverlay } from '@/shared/ui/FileDropOverlay'
import { useDeepLinks } from '@/shared/hooks/useDeepLinks'
import { useNativeMenu } from '@/shared/hooks/useNativeMenu'
import { useDockBadge } from '@/entities/chat/model/useDockBadge'
import { useDockRecents } from '@/entities/chat/model/useDockRecents'
import { useDockProjects } from '@/entities/chat/model/useDockProjects'
import { ActionRegistryProvider } from '@/shared/lib/actions'
import { TooltipProvider } from '@localixai/kit/tooltip'

export default function App() {
  useDeepLinks()
  useNativeMenu()
  useDockBadge()
  useDockRecents()
  useDockProjects()
  return (
    <TooltipProvider>
      <ActionRegistryProvider>
        <RouterProvider router={router} />
        <FileDropOverlay />
      </ActionRegistryProvider>
    </TooltipProvider>
  )
}
