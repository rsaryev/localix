/** Semantic host tokens that may cross an opaque-origin UI sandbox. */
export const HOST_THEME_VARIABLES = [
  '--font-sans',
  '--font-mono',
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
  '--radius',
  '--surface-raised',
  '--surface-hover',
  '--surface-active',
  // The recessed/black-veil step and the always-opaque ground — both are load-bearing on the host
  // side (a code inset, a switch knob) and were missing here, which meant a sandboxed panel that
  // reached for either got nothing back. Added ahead of any panel actually needing them, so the
  // next one just works instead of rediscovering the gap.
  '--surface-sunken',
  '--background-solid',
  '--text-strong',
  '--text-soft',
  '--text-faint',
  '--control-border',
  '--control-border-hover',
  '--control-border-focus',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-2xl',
  '--status-success',
  '--status-error',
  '--status-warning',
  '--status-info',
  '--scroll-thumb',
  '--scroll-thumb-hover',
  // Motion and elevation. Without them a sandboxed panel could match the host's colours but not
  // its timing — its hovers and reveals ran on whatever literal it picked, so the same gesture
  // settled on a different beat inside the iframe than one pixel outside it.
  '--dur-instant',
  '--dur-fast',
  '--dur-base',
  '--dur-moderate',
  '--dur-slow',
  '--ease-soft',
  '--ease-emphasized',
  '--ease-standard',
  '--ease-exit',
  '--shadow-popover',
  '--shadow-raised',
] as const

export type HostThemeVariable = (typeof HOST_THEME_VARIABLES)[number]
export type HostThemeVariables = Partial<Record<HostThemeVariable, string>>

/** Read the allow-listed theme surface only; arbitrary host CSS never crosses the sandbox. */
export function readHostThemeVariables(
  root: Element = document.documentElement,
): HostThemeVariables {
  const style = getComputedStyle(root)
  const result: HostThemeVariables = {}
  for (const name of HOST_THEME_VARIABLES) {
    const value = style.getPropertyValue(name).trim()
    if (value) result[name] = value
  }
  return result
}

export function hostThemeVariablesToCss(variables: HostThemeVariables): string {
  return HOST_THEME_VARIABLES.flatMap((name) => {
    const value = variables[name]
    return value ? [`${name}:${value};`] : []
  }).join('\n')
}
