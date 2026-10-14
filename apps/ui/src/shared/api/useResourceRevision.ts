import { useEffect, useState } from 'react'
import type { RealtimeResource } from '@localixai/api/realtime-resources'
import { resourceSync } from './resourceSync'

/** Re-run a domain's existing read effect; its cancellation/edit policy remains authoritative. */
export function useResourceRevision(resource: RealtimeResource, enabled = true): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!enabled) return
    return resourceSync.subscribe(resource, () => setRevision((current) => current + 1))
  }, [resource, enabled])
  return revision
}
