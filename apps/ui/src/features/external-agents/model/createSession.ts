import { externalAgentsApi } from '../api'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

export async function openOwnedExternalSession(
  sessionId: string,
  shouldReveal: () => boolean = () => true,
) {
  try {
    const terminal = await externalAgentsApi.openOwned(sessionId)
    if (shouldReveal()) terminalBus.openOwned(sessionId, terminal.terminalId, terminal.providerName)
  } catch (error) {
    toast.error('Could not open the agent terminal', {
      description: errorMessage(error, '') || undefined,
    })
  }
}
