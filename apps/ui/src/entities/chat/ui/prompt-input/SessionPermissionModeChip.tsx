import { usePermissionMode } from '../../model/usePermissionMode'
import { PermissionModeControl } from './PermissionModeControl'

export function SessionPermissionModeChip({
  sessionId,
  disabled,
}: {
  sessionId: string | null
  disabled?: boolean
}) {
  const permission = usePermissionMode(sessionId)
  if (!sessionId) return null
  return (
    <PermissionModeControl
      value={permission.mode}
      editable={permission.editable}
      onChange={permission.setMode}
      waitingPlan={permission.waitingPlan}
      onApprovePlan={permission.approvePlan}
      disabled={disabled}
    />
  )
}
