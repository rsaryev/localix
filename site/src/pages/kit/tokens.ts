/** The tokens the kit page lists: each by its custom property, with what it is for. Their values
 *  are read from the page itself, so a site's theme shows as it is. */
export type Swatch = { name: string; use: string; on?: string; text?: true };

export const SURFACES: Swatch[] = [
  { name: '--black', use: 'The page.' },
  { name: '--card', use: 'A raised surface: cards, the install block, menus.' },
  { name: '--raised', use: 'Inline code on a card.' },
  { name: '--panel', use: "A terminal's screen." },
  { name: '--code', use: 'A code block in the docs.' },
  { name: '--line', use: 'A hairline between regions.' },
  { name: '--line-strong', use: 'The border of anything that can be pressed or read apart.' },
  { name: '--faint', use: 'A border on hover, an underline at rest. Never text.' },
];

export const TEXT: Swatch[] = [
  { name: '--white', use: 'Headings, body text, the one filled action.', text: true },
  { name: '--soft', use: 'Secondary text: ledes, descriptions, links at rest.', text: true },
  { name: '--muted', use: 'Labels and small print.', text: true },
  { name: '--panel-text', use: "A terminal's own text.", on: '--panel', text: true },
  { name: '--bright', use: 'What a terminal marks bold.', on: '--panel', text: true },
];

export const SYNTAX: Swatch[] = [
  { name: '--tk-key', use: 'Keys and keywords.', on: '--panel', text: true },
  { name: '--tk-flag', use: 'Flags.', on: '--panel', text: true },
  { name: '--tk-str', use: 'Strings.', on: '--panel', text: true },
  { name: '--tk-num', use: 'Numbers and literals.', on: '--panel', text: true },
  { name: '--tk-var', use: 'Variables; an accent in a panel.', on: '--panel', text: true },
  { name: '--tk-dim', use: 'Prompts, comments, punctuation.', on: '--panel', text: true },
  { name: '--tk-ok', use: 'A status that means done. Never decoration.', on: '--panel', text: true },
  { name: '--tk-bad', use: 'A status that means wrong. Never decoration.', on: '--panel', text: true },
];

/** A terminal's sixteen colours, as a recording uses them. */
export const ANSI: Swatch[] = [
  { name: '--ansi-0', use: 'Black: a filled cell, never text.', on: '--panel' },
  { name: '--ansi-1', use: 'Red.', on: '--panel', text: true },
  { name: '--ansi-2', use: 'Green.', on: '--panel', text: true },
  { name: '--ansi-3', use: 'Yellow.', on: '--panel', text: true },
  { name: '--ansi-4', use: 'Blue.', on: '--panel', text: true },
  { name: '--ansi-5', use: 'Magenta.', on: '--panel', text: true },
  { name: '--ansi-6', use: 'Cyan.', on: '--panel', text: true },
  { name: '--ansi-7', use: 'White.', on: '--panel', text: true },
  { name: '--ansi-8', use: 'Bright black: the dim grey of a prompt.', on: '--panel', text: true },
  { name: '--ansi-9', use: 'Bright red.', on: '--panel', text: true },
  { name: '--ansi-10', use: 'Bright green.', on: '--panel', text: true },
  { name: '--ansi-11', use: 'Bright yellow.', on: '--panel', text: true },
  { name: '--ansi-12', use: 'Bright blue.', on: '--panel', text: true },
  { name: '--ansi-13', use: 'Bright magenta.', on: '--panel', text: true },
  { name: '--ansi-14', use: 'Bright cyan.', on: '--panel', text: true },
  { name: '--ansi-15', use: 'Bright white.', on: '--panel', text: true },
];

/** The type scale, largest first: the class that sets it, and where it is used. */
export const TYPE: { name: string; className: string; sample: string; use: string }[] = [
  { name: 'Headline', className: 'hero-title', sample: 'One headline a page', use: 'Display 700, clamp(2.25rem … 4rem), −0.05em. The landing’s h1.' },
  { name: '--step-3', className: 'kit-step-3', sample: 'A section heading', use: 'Display 700, −0.04em. Every h2 of the landing.' },
  { name: '--step-1', className: 'kit-step-1', sample: 'A lede says what the heading left out, in a sentence or two.', use: 'Text 400, line-height 1.5. Ledes and sub-headings.' },
  { name: 'Body', className: 'kit-body', sample: 'Body text is one rem, in a measure of 30 to 47 em, so a line stays easy to follow.', use: 'Text 400, 1rem / 1.65.' },
  { name: '--step-s', className: 'kit-step-s', sample: 'Small print · labels · the footer', use: 'Text or Mono, 0.8125rem.' },
  { name: 'Code', className: 'kit-code', sample: '$ npm run check', use: 'Mono 400, ligatures off.' },
];

export const SHAPE: { name: string; use: string }[] = [
  { name: '--radius', use: 'Cards, menus, code blocks.' },
  { name: '--gutter', use: "The page's side margin: 1.25rem on a phone, more with the window." },
  { name: '--ease-out', use: 'Every entrance. Hover states change in 160ms, with `ease`.' },
];
