/**
 * OS visual-preference contract for sandboxed plugin panel documents.
 *
 * Media queries do match inside an iframe, but host styles do not cross its
 * document boundary. The panel document injects this build-owned CSS so
 * a plugin cannot accidentally lose the workbench's contrast, transparency and
 * forced-color behavior merely because it runs in the security sandbox.
 */
export const EMBEDDED_VISUAL_PREFERENCES_CSS = `
@media (prefers-reduced-motion: reduce) {
  *,*::before,*::after {
    animation-duration:0.01ms!important;
    animation-delay:0s!important;
    animation-iteration-count:1!important;
    transition-duration:0.01ms!important;
    transition-delay:0s!important;
    scroll-behavior:auto!important;
  }
}
@media (prefers-contrast: more) {
  :root {
    --muted-foreground:color-mix(in oklch,var(--foreground) 88%,var(--background))!important;
    --border:color-mix(in oklch,var(--foreground) 28%,var(--background))!important;
    --border-subtle:color-mix(in oklch,var(--foreground) 20%,var(--background))!important;
    --border-strong:color-mix(in oklch,var(--foreground) 46%,var(--background))!important;
    --input:color-mix(in oklch,var(--foreground) 38%,var(--background))!important;
    --surface-hover:color-mix(in oklch,var(--foreground) 14%,var(--background))!important;
    --surface-active:color-mix(in oklch,var(--foreground) 22%,var(--background))!important;
    --text-soft:color-mix(in oklch,var(--foreground) 88%,var(--background))!important;
    --text-faint:color-mix(in oklch,var(--foreground) 78%,var(--background))!important;
    --control-border:color-mix(in oklch,var(--foreground) 38%,var(--background))!important;
    --control-border-hover:color-mix(in oklch,var(--foreground) 55%,var(--background))!important;
    --control-border-focus:color-mix(in oklch,var(--foreground) 82%,var(--background))!important;
    --scroll-thumb:color-mix(in oklch,var(--foreground) 55%,transparent)!important;
    --scroll-thumb-hover:color-mix(in oklch,var(--foreground) 78%,transparent)!important;
  }
  :where(.lx-card,.lx-panel,.lx-list,[role='dialog'],[role='menu'],[role='listbox']) {
    outline:1px solid var(--border-strong);outline-offset:-1px;
  }
  :where([aria-selected='true'],[aria-checked='true'],[aria-pressed='true'],[aria-current]:not([aria-current='false'])) {
    outline:2px solid var(--ring);outline-offset:-2px;
  }
  :where(button,input,textarea,select,[role='button'],[role='menuitem'],[role='option'],[role='tab']):focus-visible {
    outline:2px solid var(--ring);outline-offset:-2px;
  }
}
@media (prefers-reduced-transparency: reduce) {
  :where([class*='backdrop-blur'],[style*='backdrop-filter']) {
    -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
  }
  .lx-inset { background:var(--muted); }
}
@media (forced-colors: active) {
  :where(.lx-card,.lx-panel,.lx-list) { border-color:CanvasText; }
  :where([aria-selected='true'],[aria-checked='true'],[aria-pressed='true'],[aria-current]:not([aria-current='false'])) {
    outline:2px solid Highlight;outline-offset:-2px;
  }
  :where(button,input,textarea,select,[role='button'],[role='menuitem'],[role='option'],[role='tab']):focus-visible {
    outline:2px solid Highlight;outline-offset:-2px;
  }
}
`
