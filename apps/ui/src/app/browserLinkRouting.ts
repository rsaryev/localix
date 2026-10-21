import { useChatStore } from '@/entities/chat/model/store'
import { usePreviewStore } from '@/features/inspector/model/previewStore'
import { registerAppBrowserOpener } from '@/shared/lib/externalLink'
import { inspector, isInspectorReady } from '@/shared/lib/inspectorBus'

/** Bind shared link routing to the active conversation's Browser workspace. */
export function startBrowserLinkRouting(): () => void {
  return registerAppBrowserOpener((url) => {
    const sessionId = useChatStore.getState().activeSessionId
    // During setup there is no conversation workspace to host a Browser tab.
    if (!sessionId || !isInspectorReady()) return false
    const previewId = usePreviewStore.getState().openBrowserTab(sessionId, url)
    inspector.openPreview({ sessionId, previewId, url, version: 0 })
    return true
  })
}
