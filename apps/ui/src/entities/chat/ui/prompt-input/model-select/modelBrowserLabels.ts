/** The workload switcher's label: the agent's name, else the task's, else chat sessions. */
export function workloadLabelFor(
  agent: { name?: string } | undefined,
  taskLabel: string | undefined,
): string {
  return agent?.name ?? taskLabel ?? 'Chat sessions'
}
