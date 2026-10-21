/** The workload switcher's label: the participant's name, else the task's, else chat sessions. */
export function workloadLabelFor(
  participant: { label?: string; handle?: string } | undefined,
  taskLabel: string | undefined,
): string {
  return participant?.label ?? participant?.handle ?? taskLabel ?? 'Chat sessions'
}
