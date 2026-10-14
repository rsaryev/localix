/**
 * ONE motion recipe for an inline disclosure — a header, the chevron in it, and the grid-rows body
 * it reveals. The tool row, the tool cluster header, the stacked-item digest and the reasoning
 * block all render this triple.
 *
 * It lived in the tool row's own file, so the reasoning block — in the same transcript, one row
 * away — could not reach it and wrote its own `duration-200` instead of the token. The two then
 * opened on different beats. Here it is owned by the layer every one of them already imports.
 *
 * The chevron and the body MUST settle together: both run --dur-base. The header's hover tint is a
 * separate gesture and stays on the quicker --dur-fast. Easing is left to the Tailwind default,
 * which the theme points at --ease-soft.
 */
export const COLLAPSIBLE_MOTION = {
  /** Header row: hover/open background tint. */
  header: 'transition-colors duration-(--dur-fast)',
  /** Disclosure chevron rotation. */
  chevron: 'transition-transform duration-(--dur-base)',
  /** The grid-rows body reveal the chevron points at. */
  body: 'transition-[grid-template-rows,opacity] duration-(--dur-base)',
} as const
