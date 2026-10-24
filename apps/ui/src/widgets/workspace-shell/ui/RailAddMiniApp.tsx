import { Plus } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { IconButton } from '@localixai/kit/icon-button'
import { railBtn } from '@localixai/kit/rail-button'
import { openMiniAppStore } from '@/shared/lib/openMiniAppStore'

/**
 * The rail's add button: the mini app store in its own tab. An app installed there appears in the
 * rail on its `mini-apps` poke.
 */
export function RailAddMiniApp() {
  return (
    <IconButton
      size="touch"
      aria-label="Add mini apps"
      className={cn(railBtn)}
      onClick={openMiniAppStore}
    >
      <Plus />
    </IconButton>
  )
}
