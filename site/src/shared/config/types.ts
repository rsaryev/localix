import type { Block } from '@/shared/ui';

/** A link by its words. `href` is a route of this site (`/docs`) or an address. */
export type NavLink = { label: string; href: string };

/** What the whole site knows about itself: content/site.ts. */
export type SiteConfig = {
  /** The product's name: the titles' suffix, what a screen reader is told a link goes to. */
  name: string;
  /** The landing's <title> and its link preview's. */
  title: string;
  /** One or two sentences: the meta description, the link preview. */
  description: string;
  /** Where the site is published, with no trailing slash: canonical URLs, the sitemap. */
  url: string;
  /** The product's repository. */
  github: string;
  /** The repository this site's sources are in, when it is not the product's: where "Edit this
   *  page" goes, and where a docs link to a repository file points. */
  source?: string;
  /** The folder of that repository the site is in, when it is not its root (`site`): what a
   *  path under the site's root is given in a link to the repository. */
  sourceDir?: string;
  /** The builds a reader downloads, for a product that is an app: the page's first action is
   *  then the build for the reader's system, the first build when the system has none or is not
   *  known, and the install command is not shown. */
  downloads?: Build[];
  /** The install command, one tab per way in (a tab row shows only with several): the page's
   *  first action for a product with no builds to download. */
  install?: (readonly [label: string, command: string])[];
  /** The card every link preview shows, under public/: a PNG or a JPEG of 1200×630, or of the
   *  size given here when it is drawn larger (twice that, for a dense screen). */
  image: { path: string; alt: string; width?: number; height?: number };
  /** The bar over every page: its links, on the right, and the one action after them, a filled
   *  pill. On a phone only the first link and the action show. */
  bar: { links: NavLink[]; action?: NavLink };
  /** Under every page: one line, and links. */
  footer: { note: string; links: NavLink[] };
  /** Who makes the product, and the page of everything they make: signed first in the footer,
   *  before its line, and the way there from every page. */
  maker?: NavLink;
  /** schema.org data for the landing. */
  jsonLd?: Record<string, unknown>;
  /** The opening of llms.txt, as markdown; the docs' list follows it. */
  llms: string;
};

/** A build of the product: the system it is for, the button's words, the file, what the build
 *  needs in a few words, and the words of the quiet link to it beside another build's button. */
export type Build = { os: 'macos' | 'linux' | 'windows'; label: string; href: string; note?: string; also: string };

/** The docs' one table of contents: content/docs/nav.ts. A page is its file's name under the
 *  docs' folder without `.md`, reached at /docs/<name>; its title is its first heading and its
 *  description its first paragraph. A page in a folder there is named with it
 *  (`features/delegation`) and reached at the names joined by two hyphens
 *  (`/docs/features--delegation`). */
export type DocsConfig = {
  /** Where the markdown is, from the site's root, when it is not `content/docs`: for a site that
   *  is a folder of its product's repository, the repository's own docs (`../docs`). */
  dir?: string;
  /** The index at /docs. */
  index: { title: string; description: string };
  groups: { title: string; blurb: string; pages: string[] }[];
  /** Markdown under the docs' folder that is no page, and why: any other file there must be in
   *  a group, so a new doc is never left off the site unnoticed. A name that ends in `/` is a
   *  folder: what of it no group lists. */
  unlisted: Record<string, string>;
};

/** What a card shows beside its words. A picture or a video names its size in pixels, so its
 *  room is held before it loads. Files are under public/.
 *  - `terminal`: what a program printed, drawn from blocks (shared/ui's Panel);
 *  - `image`: a screenshot or a diagram, itself the link to the picture whole;
 *  - `video`: a short silent clip, played while it is in view;
 *  - `film`: a terminal session recorded with asciinema, played in a real terminal. */
export type Media =
  | { kind: 'terminal'; blocks: Block[]; label?: string }
  | { kind: 'image'; src: string; alt: string; width: number; height: number }
  | ({ kind: 'video' } & Clip)
  | { kind: 'film'; src: string; label: string };

/** A short silent clip under public/: its size in pixels, the still shown before it plays, and
 *  what it shows, in words. */
export type Clip = { src: string; label: string; width: number; height: number; poster?: string };

/** The product in stills of one size (in pixels, files under public/), each with the name its
 *  button carries; `label` says what the frame holds, for a reader who cannot see it. */
export type Tour = { label: string; width: number; height: number; scenes: { label: string; src: string; alt: string }[] };

/** A card of the landing: a claim, and beside it what shows it. `tag` is a small label over the
 *  title; `text` marks code with backticks; `links` say where to read more. With no `media` the
 *  words take the card's whole width. */
export type Card = { tag?: string; title: string; text: string; media?: Media; links?: NavLink[] };

/** The landing: content/landing.ts. `code` between backticks in a text is drawn as code. A
 *  section left out is not drawn. */
export type LandingContent = {
  hero: {
    /** The headline: an optional first word on a chip, what follows it unbroken (a comma), and
     *  the rest. */
    title: { chip?: string; after?: string; rest: string };
    lede: string;
    /** The small line under the first action; it takes [links](/docs). */
    under: string;
    /** Other ways in, as outlined actions beside the download. */
    links?: NavLink[];
    /** A recorded terminal session (asciinema v3) under public/, and what it shows, in words. */
    film?: { src: string; label: string };
    /** The product's window in a few stills, for a product that is an app; shown instead of the
     *  recording when both are given. */
    tour?: Tour;
    /** The product at work in a short silent clip, for an app whose work is best seen moving;
     *  shown instead of the stills and the recording when given. */
    clip?: Clip;
  };
  /** The cards, one sliding over another under their heading. `aside` is the short line at the
   *  heading's right. */
  loop: { title: string; aside?: string; cards: Card[] };
  /** The docs as columns, a column a group of content/docs/nav.ts, a row a page. With `limit`, a
   *  column shows that many of its pages, then how many more, a link to its group on /docs. */
  docs?: { title: string; limit?: number };
  /** The latest releases, read from CHANGELOG.md; `more` is the link at the heading's right. */
  releases?: { title: string; more?: NavLink };
  /** The page's end: how to start, in numbered steps, and where to go; the first link is the
   *  filled action, unless the site has `downloads`: then the download is, before the links. Its
   *  address on the page is `#start`. */
  closing: { title: string; aside?: string; steps: { title: string; text: string }[]; links: NavLink[] };
};
