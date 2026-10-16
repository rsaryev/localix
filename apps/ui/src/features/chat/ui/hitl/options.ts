/** Resolve the value an HITL option returns when selected: explicit `value`, else its label. */
export function optionValue(option: { label: string; value?: string }): string {
  return option.value ?? option.label
}
