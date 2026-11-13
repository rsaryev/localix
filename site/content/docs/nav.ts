import type { DocsConfig } from '@/shared/config';
import publicNav from '../../../docs/public-nav.json' with { type: 'json' };

// The docs are the repository's own, in docs/, and so is their table of contents:
// docs/public-nav.json lists the pages the site publishes, by section and, in Features, by
// category. This file only gives it the template's shape: a group for each section, and for each
// category of a section that has them. A page's name is its path under docs/ (`features/agents`),
// reached at /docs/features--agents.
type Group = { title: string; blurb: string; pages: string[] };
type Section = { title: string; blurb?: string; pages?: string[]; categories?: Group[] };

const page = (path: string) => path.replace(/\.md$/, '');
const group = ({ title, blurb, pages }: Group): DocsConfig['groups'][number] => ({ title, blurb, pages: pages.map(page) });

const docs: DocsConfig = {
  dir: '../docs',
  index: {
    title: 'Localix Studio docs',
    description:
      'Start with setup and a first session, follow a recipe for a concrete task, or use the reference to find a feature’s controls and limits.',
  },
  groups: (publicNav.sections as Section[]).flatMap((section) =>
    section.categories ? section.categories.map(group) : [group({ title: section.title, blurb: section.blurb ?? '', pages: section.pages ?? [] })],
  ),
  // Everything else under docs/ is read in the checkout or on GitHub.
  unlisted: {
    'README.md': 'the docs’ index on GitHub; the site makes its own at /docs',
    'adr/': 'decision records, for the people who change Localix',
    'assets/': 'the captures’ own notes',
    'internals/': 'contributor notes; the public ones are listed under Contributors',
  },
};

export default docs;
