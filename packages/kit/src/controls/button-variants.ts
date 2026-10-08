import { cva, type VariantProps } from 'class-variance-authority'
import { CONTROL_FOCUS_VISIBLE, CONTROL_INVALID } from '@localixai/plugin-sdk/ui/classes'

export const buttonVariants = cva(
  // Focus comes from the SDK recipe rather than a fourth hand-written spelling. The string here
  // used to be `focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30` — the
  // shout that was already removed from the SDK constant and never propagated to the primitives
  // that had transcribed it. Interpolated, so the two can no longer drift.
  `group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap shadow-none transition-[background-color,border-color,color,box-shadow] duration-(--dur-fast) motion-reduce:transition-none select-none ${CONTROL_FOCUS_VISIBLE} disabled:pointer-events-none disabled:opacity-50 ${CONTROL_INVALID} [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80 active:bg-primary/70',
        // Monochrome solid primary (foreground-on-background) — the app's de-facto
        // "do it" action style, previously hand-rolled as a raw class string in
        // ~15 places. Hover dims via bg-alpha (animated by the base transition,
        // like default/secondary) for design-system consistency. Migrate raw
        // monochrome buttons to <Button variant="mono">.
        mono: 'bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/80',
        // `aria-expanded:bg-surface-active` like `ghost`, not `bg-muted`: under glass `muted` is a
        // 6% veil while the hover above lands near 9%, so an OPEN outline trigger read weaker
        // than merely hovering it. 11% is the shared "this one is engaged" step.
        // No resting fill in either theme — the border alone carries "outline" at rest, matching
        // its name; `dark:bg-input/30` used to break that symmetry with a fill dark got and light
        // didn't, for no reason the variant's own name or its hover/engaged states call for.
        outline:
          'border-border hover:bg-surface-hover hover:text-foreground active:bg-surface-active aria-expanded:bg-surface-active aria-expanded:text-foreground',
        // A bordered button with a resting FILL that is a foreground veil (`--field-fill`), for a
        // button that sits on a tinted strip — a conflict or bisect band on `bg-status-*/10`.
        // `outline` has no resting fill; `field` adds a hairline around the same quiet veil
        // as `secondary`. The veil adds density to whatever colour is underneath.
        field:
          'border-control-border bg-field-fill text-text-soft hover:bg-surface-hover hover:text-foreground active:bg-surface-active aria-expanded:bg-surface-active aria-expanded:text-foreground',
        secondary:
          'bg-field-fill text-secondary-foreground hover:bg-surface-hover active:bg-surface-active aria-expanded:bg-surface-active aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-surface-hover hover:text-foreground active:bg-surface-active aria-expanded:bg-surface-active aria-expanded:text-foreground',
        // The focus ring is recoloured, not resized: the base recipe's 1px inset stays, so these
        // alphas moved up from 20-40% — a fifth of the colour was tuned for a 2px halo and is
        // invisible on a hairline.
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 active:bg-destructive/30 focus-visible:ring-destructive/80 dark:bg-destructive/20 dark:hover:bg-destructive/30',
        // Solid destructive (white-on-red) — the confirm action in destructive
        // dialogs, distinct from the subtle `destructive` tint above.
        'destructive-solid':
          'bg-destructive text-white hover:bg-destructive/90 active:bg-destructive/80 focus-visible:ring-white/70',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          "h-[var(--chrome-control-md)] gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-[var(--chrome-control-xs)] gap-1 rounded-sm px-2 text-2xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-[var(--chrome-control-sm)] gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-[var(--chrome-control-lg)] gap-1 px-2.5 text-xs/relaxed has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        // Settings/dialog scale: taller (h-9) with text-sm — the size used by
        // the forms in features/settings and confirm dialogs. Lets those raw
        // buttons migrate to <Button> without shrinking text/height.
        xl: "h-[var(--chrome-control-xl)] gap-1.5 px-3 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        // Square variants mirror the text ladder measure-for-measure:
        // icon-xs≡xs (20), icon-sm≡sm (24), icon≡default (28), icon-lg≡lg (32),
        // icon-xl≡xl (36), icon-touch (40, no text twin — a pointer target).
        // IconButton's public size names map onto these one-to-one, so `sm`
        // means 24px on a text button and on an icon button alike.
        icon: "size-[var(--chrome-control-md)] [&_svg:not([class*='size-'])]:size-3.5",
        'icon-xs':
          "size-[var(--chrome-control-xs)] rounded-sm [&_svg:not([class*='size-'])]:size-2.5",
        'icon-sm': "size-[var(--chrome-control-sm)] [&_svg:not([class*='size-'])]:size-3",
        'icon-lg': "size-[var(--chrome-control-lg)] [&_svg:not([class*='size-'])]:size-4",
        'icon-xl': "size-[var(--chrome-control-xl)] [&_svg:not([class*='size-'])]:size-4",
        'icon-touch':
          "size-[var(--chrome-control-touch)] rounded-lg [&_svg:not([class*='size-'])]:size-4.5",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
