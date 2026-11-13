import type { Block, Build, Card, Clip, Tour } from '@/shared/config';

/** The kit's specimens. They are the template's, not a site's content: a site's copy never
 *  changes what the kit shows, only its theme does. */
export const ONE_WAY: [string, string][] = [['npm', 'npm create example@latest']];
export const THREE_WAYS: [string, string][] = [
  ['curl', 'curl -fsSL https://example.com/install | sh'],
  ['brew', 'brew install example'],
  ['npm', 'npm install -g example'],
];

export const BLOCKS: { name: string; text: string; blocks: Block[] }[] = [
  {
    name: 'shell',
    text: 'A session: lines that start with `$` are commands and are highlighted, the rest is output.',
    blocks: [{ lang: 'shell', text: '$ example build --target web "src/**/*.ts" > build.log\n$ echo $?\n0' }],
  },
  {
    name: 'json',
    text: 'Data, highlighted.',
    blocks: [{ lang: 'json', text: '{\n  "status": "done",\n  "files": 12,\n  "cached": true\n}' }],
  },
  {
    name: 'grid',
    text: 'A table in real columns, aligned per column (`align: "rll"`), each cell with a tone of its own.',
    blocks: [
      {
        grid: [
          [['dim', '0'], ['ok', 'done'], ['dim', 'everything passed']],
          [['dim', '1'], ['bad', 'failed'], ['dim', 'a check did not pass']],
          [['dim', '130'], 'interrupted', ['dim', 'stopped by a signal']],
        ],
        align: 'rll',
      },
    ],
  },
  {
    name: 'ui and out',
    text: 'A drawn screen, part by part, and single lines of output. The tones: plain, `dim`, `hi`, `ok`, `bad`, `acc`, `sel`.',
    blocks: [
      { ui: [[['sel', '❯ '], ['hi', 'Deploy to production'], ['dim', '  enter']], [['', '  '], ['', 'Deploy a preview']], [['', '  '], ['dim', 'Cancel']]] },
      { out: '3 checks passed', tone: 'ok' },
      { out: '1 warning: the bundle grew by 4 kB', tone: 'acc' },
      { out: 'took 1.8 s', tone: 'dim' },
    ],
  },
];

export const CARD: Card = {
  tag: 'For whom',
  title: 'A card says one thing',
  text: 'Words on the left, what shows them on the right: a drawn terminal, a picture, a clip or a recording. Code in the text is marked with backticks, like `--flag`.',
  links: [{ label: 'A link to more', href: '#card' }],
  media: { kind: 'terminal', blocks: [{ lang: 'shell', text: '$ example check\n' }, { out: 'ok  12 files, 0 problems', tone: 'ok' }] },
};

export const PROSE = `## A second-level heading

A paragraph of a docs page, with **strong words**, a [link](#prose), and \`inline code\` such as
\`--dry-run\`. It keeps to a measure a line is easy to follow in.

### A third-level heading

- A list item.
- Another, with \`code\`.

1. A numbered step.
2. The next one.

\`\`\`sh
# a code block, with its language and a Copy
npm run build -- --mode production
\`\`\`

\`\`\`ts title="content/site.ts"
// any common language is highlighted at build time
const site: SiteConfig = { name: 'sitekit', url: 'https://example.com' };
\`\`\`

> [!NOTE]
> A callout, written as GitHub writes it.

| Option | Default | What it does |
| --- | --- | --- |
| \`--port\` | \`5173\` | Where the dev server listens. |
| \`--open\` | off | Opens the browser once it is up. |
`;

/** A still drawn here, so the kit needs no picture of any product: a field of one grey. */
const still = (grey: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 10"><rect width="16" height="10" fill="rgb(${grey},${grey},${grey})"/></svg>`)}`;
export const TOUR: Tour = {
  label: 'A product in three stills',
  width: 1600,
  height: 1000,
  scenes: [
    { label: 'One', src: still(28), alt: 'The first still' },
    { label: 'Two', src: still(44), alt: 'The second still' },
    { label: 'Three', src: still(60), alt: 'The third still' },
  ],
};
/** A clip with nothing to play: its poster, in the room its size holds, under its controls. */
export const CLIP: Clip = { src: '', label: 'A clip of the product at work', width: 1600, height: 1000, poster: still(36) };
export const BUILDS: Build[] = [
  { os: 'macos', label: 'Download for macOS', href: '#download', note: 'What this build needs', also: 'Also for macOS' },
  { os: 'linux', label: 'Download for Linux', href: '#download', note: 'What this build needs', also: 'Also for Linux' },
];
