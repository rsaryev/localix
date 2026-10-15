interface SlotLike {
  providerConnectionId: string | null
  modelId: string
}

/**
 * Whether the model the details panel shows is the one this target runs on: its settings
 * then edit the live route rather than the remembered per-model preference.
 */
export function isDetailCurrent(
  detailModelId: string | null | undefined,
  detailConnectionId: string | null,
  currentSlot: SlotLike | null | undefined,
): boolean {
  return (
    detailModelId != null &&
    currentSlot?.providerConnectionId === detailConnectionId &&
    currentSlot?.modelId === detailModelId
  )
}

/** The workload switcher's label: the participant's name, else the task's, else chat sessions. */
export function workloadLabelFor(
  participant: { label?: string; handle?: string } | undefined,
  taskLabel: string | undefined,
): string {
  return participant?.label ?? participant?.handle ?? taskLabel ?? 'Chat sessions'
}
