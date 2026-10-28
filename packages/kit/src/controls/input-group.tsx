'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn, FIELD_SURFACE } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from './button'
import { Input } from './input'

function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        FIELD_SURFACE,
        'group/input-group relative flex h-[var(--chrome-control-md)] w-full min-w-0 items-center transition-colors outline-none in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-data-[align=block-end]:rounded-md has-data-[align=block-start]:rounded-md has-[[data-slot=input-group-control]:focus-visible]:ring-1 has-[[data-slot=input-group-control]:focus-visible]:ring-inset has-[[data-slot=input-group-control]:focus-visible]:ring-control-border-focus has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-2 has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[textarea]:rounded-md has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5',
        className,
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-1 py-2 text-xs/relaxed font-medium text-text-soft select-none group-data-[disabled=true]/input-group:opacity-50 **:data-[slot=kbd]:rounded-[calc(var(--radius-sm)-2px)] **:data-[slot=kbd]:bg-muted-foreground/10 **:data-[slot=kbd]:px-1 **:data-[slot=kbd]:text-2xs [&>svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      align: {
        'inline-start': 'order-first pl-2 has-[>button]:ml-[-0.275rem] has-[>kbd]:ml-[-0.275rem]',
        'inline-end': 'order-last pr-2 has-[>button]:mr-[-0.275rem] has-[>kbd]:mr-[-0.275rem]',
        'block-start':
          'order-first w-full justify-start px-2 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2',
        'block-end':
          'order-last w-full justify-start px-2 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
)

function InputGroupAddon({
  className,
  align = 'inline-start',
  focusOnClick = true,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof inputGroupAddonVariants> & {
    /**
     * Whether clicking the addon's own surface hands focus to the group's input —
     * the point of `cursor-text` on a leading icon/prefix, which reads as part of
     * the field. Set false for an addon that is purely an ACTION cluster: there,
     * the gutters between buttons and any decorative divider are not "the field",
     * and jumping the caret into the input when the user misses a button by a
     * pixel is a surprise.
     */
    focusOnClick?: boolean
  }) {
  return (
    // The click only hands the POINTER to the field the addon decorates; a keyboard user already
    // reaches that input with Tab, so there is no key path to add to this surface.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- pointer-only focus forwarding to the input the keyboard reaches directly
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(
        inputGroupAddonVariants({ align }),
        !focusOnClick && 'cursor-default',
        className,
      )}
      onClick={
        focusOnClick
          ? (e) => {
              if ((e.target as HTMLElement).closest('button')) {
                return
              }
              e.currentTarget.parentElement?.querySelector('input')?.focus()
            }
          : undefined
      }
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  'flex items-center gap-2 rounded-md text-xs/relaxed shadow-none',
  {
    variants: {
      // Addon sizes name the SAME physical measures as `buttonVariants`, so a
      // name means one size across the whole design system: `xs` = 20px,
      // `icon-sm` = 24px, `icon` = 28px (the group's own height — a square
      // action that fills the field). `sm` intentionally sets no height: it
      // inherits Button's 28px default, which is also the group's own default
      // height — so a group whose height is overridden away from `md` puts its
      // children on a different rung than the field, and must resize them too.
      // These two icon names previously read `icon-xs` = 24px and
      // `icon-sm` = 28px — one tier up from the identical names in
      // `buttonVariants`. The pixels were right for a 28px field; only the
      // labels were wrong, so they were renamed, not resized.
      size: {
        xs: "h-[var(--chrome-control-xs)] gap-1 rounded-[calc(var(--radius-sm)-2px)] px-1 [&>svg:not([class*='size-'])]:size-3",
        sm: 'gap-1',
        'icon-sm': 'size-[var(--chrome-control-sm)] p-0 has-[>svg]:p-0',
        icon: 'size-[var(--chrome-control-md)] p-0 has-[>svg]:p-0',
      },
    },
    defaultVariants: {
      size: 'xs',
    },
  },
)

function InputGroupButton({
  className,
  type = 'button',
  variant = 'ghost',
  size = 'xs',
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'size'> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        'flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0',
        className,
      )}
      {...props}
    />
  )
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput }
