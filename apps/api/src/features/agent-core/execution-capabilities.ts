/** Host authority required by tools that may create another agent run. */
export const ORCHESTRATION_DELEGATE_TASK = 'orchestration.delegate-task' as const

/** Extend this union as additional host-authority-gated tools are introduced. */
export type ExecutionCapability = typeof ORCHESTRATION_DELEGATE_TASK
