/**
 * The one trigger look for a per-model setting in the details panel: quiet text and a chevron,
 * no outline or resting fill — the settings row already frames it. Shared so every row's value
 * sits on the same baseline and right edge.
 */
export const SETTING_TRIGGER_CLASS =
  '-mr-1.5 inline-flex h-(--chrome-control-md) min-w-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-surface-hover focus-ring aria-expanded:bg-surface-active disabled:cursor-not-allowed disabled:opacity-45'
