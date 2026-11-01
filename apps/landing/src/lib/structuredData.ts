import { REPOSITORY_URL, SITE_ORIGIN, X_URL } from './site'

const HOME_URL = `${SITE_ORIGIN}/`

export const HOME_DESCRIPTION =
  'Localix is an open source Agentic Development Environment: an AI agent, its subagents, your editor, terminals and browser. Use any model, or run one locally.'

/**
 * The homepage's schema.org graph. `index.html` ships the same JSON for the first paint, and the
 * docs restore it on the way back home; a test keeps the two equal. No rating, review, price, or
 * release is implied.
 */
export const HOME_STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${HOME_URL}#website`,
      name: 'Localix',
      url: HOME_URL,
      inLanguage: 'en',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${HOME_URL}#app`,
      name: 'Localix',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS',
      url: HOME_URL,
      description: HOME_DESCRIPTION,
      image: `${HOME_URL}og.png`,
      screenshot: `${HOME_URL}films/demo.jpg`,
      license: 'https://opensource.org/licenses/MIT',
      isAccessibleForFree: true,
      sameAs: [REPOSITORY_URL, X_URL],
      author: { '@type': 'Organization', name: 'Localix', url: HOME_URL },
    },
    {
      '@type': 'VideoObject',
      name: 'Localix demo: a landing page built and tested from one prompt',
      description:
        'One prompt with a pasted brief: the agent writes a landing page, opens it in the browser itself and tests it at phone, tablet and desktop widths.',
      thumbnailUrl: `${HOME_URL}films/demo.jpg`,
      contentUrl: `${HOME_URL}films/demo.mp4`,
      uploadDate: '2026-11-01',
      duration: 'PT23S',
      about: { '@id': `${HOME_URL}#app` },
    },
  ],
}
