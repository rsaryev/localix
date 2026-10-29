import { REPOSITORY_URL, SITE_ORIGIN } from './site'

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
      sameAs: [REPOSITORY_URL],
      author: { '@type': 'Organization', name: 'Localix', url: HOME_URL },
    },
    {
      '@type': 'VideoObject',
      name: 'Localix demo: a landing page from one prompt',
      description:
        'The Store, installing and playing a mini app, then one prompt: the agent builds a phone shop landing page and tests it in the browser, and a Visual Feedback comment removes a label.',
      thumbnailUrl: `${HOME_URL}films/demo.jpg`,
      contentUrl: `${HOME_URL}films/demo.mp4`,
      uploadDate: '2026-10-28',
      duration: 'PT55S',
      about: { '@id': `${HOME_URL}#app` },
    },
  ],
}
