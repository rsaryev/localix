import { REPOSITORY_URL, SITE_ORIGIN } from './site'

const HOME_URL = `${SITE_ORIGIN}/`

export const HOME_DESCRIPTION =
  'Localix is an open source Agentic Development Environment: agent teams, a fast Browser, and plugins you build in minutes on embeddings and decision models.'

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
      name: 'Localix demo: one /workflows run',
      description:
        'A /workflows prompt puts three cards on the board, agents build and test a dark 2048 game in the browser, and a Visual Feedback comment adds a light theme.',
      thumbnailUrl: `${HOME_URL}films/demo.jpg`,
      contentUrl: `${HOME_URL}films/demo.mp4`,
      uploadDate: '2026-10-19',
      duration: 'PT39S',
      about: { '@id': `${HOME_URL}#app` },
    },
  ],
}
