import type { RealtimeResource } from '@localixai/api/realtime-resources'
import { createResourceSync } from '@localixai/plugin-sdk/ui/resource-sync'

export { createResourceSync }
export const resourceSync = createResourceSync<RealtimeResource>()
