import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'

/** The room keeps its previous routes (the store rolls back); say why the change did not land. */
export const notifyPartyRouteFailure = (error: unknown): void => {
  toast.error('Could not update all agents', { description: errorMessage(error, 'Try again.') })
}
