import type { SiteConfig } from '@/shared/config';

// What the site knows about itself: the product's name, where the site is published, the
// repository, the build a reader downloads. The title and the description are the product's
// positioning, word for word as the README and the app say it (scripts/positioning.test.ts).
const GITHUB = 'https://github.com/localixai/localix-studio';
const DESCRIPTION =
  'Localix is an open source Agentic Development Environment: an AI agent, its subagents, your editor, terminals and browser. Use any model, or run one locally.';

const site: SiteConfig = {
  name: 'Localix Studio',
  title: 'Localix — One workspace for you and your agents',
  description: DESCRIPTION,
  url: 'https://studio.localix.ai',
  github: GITHUB,
  // The site is a folder of the product's repository, not a repository of its own.
  sourceDir: 'site',
  // The release workflow uploads the installer under this name too, with no version in it, so
  // the link always reaches the newest release.
  downloads: [
    {
      os: 'macos',
      label: 'Download for macOS',
      href: `${GITHUB}/releases/latest/download/Localix-macos-arm64.dmg`,
      note: 'Apple silicon',
      also: 'Also for macOS',
    },
  ],
  image: {
    path: '/og.jpg',
    width: 2400,
    height: 1260,
    alt: 'Localix Studio, the Agentic Development Environment: the app’s window with the agent’s chat beside the page it built',
  },
  bar: {
    links: [
      { label: 'Docs', href: '/docs' },
      { label: 'Changelog', href: `${GITHUB}/blob/main/CHANGELOG.md` },
      { label: 'GitHub', href: GITHUB },
    ],
    action: { label: 'Download', href: '/#start' },
  },
  footer: {
    note: 'Localix Studio is MIT-licensed and open source.',
    links: [
      { label: 'Docs', href: '/docs' },
      { label: 'GitHub', href: GITHUB },
      { label: 'X', href: 'https://x.com/localixai' },
      { label: 'Changelog', href: `${GITHUB}/blob/main/CHANGELOG.md` },
      { label: 'Security', href: `${GITHUB}/blob/main/SECURITY.md` },
    ],
  },
  // No rating, review or price is implied.
  jsonLd: {
    '@type': 'SoftwareApplication',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'macOS',
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
    sameAs: [GITHUB, 'https://x.com/localixai'],
  },
  llms: `> ${DESCRIPTION}`,
};

export default site;
