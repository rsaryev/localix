import { openModelPicker } from '@/shared/lib/modelPickerBus'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'

/** Only a persisted connection can bring the app back and offer its models. */
export function returnToOAuthModels(
  connection: { id: string; providerId: string },
  sessionId: string | null,
): void {
  if (sessionId) {
    openModelPicker({ sessionId, providerId: connection.providerId, connectionId: connection.id })
  }
  void platformCapabilities()
    .desktop.invoke('focus_app')
    ?.catch(() => {})
}
