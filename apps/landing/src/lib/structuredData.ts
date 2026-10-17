import { REPOSITORY_URL, SITE_ORIGIN } from './site'

const HOME_URL = `${SITE_ORIGIN}/`

export const HOME_DESCRIPTION =
  'Localix is an open source Agentic Development Environment: one workspace where you and a team of agents share the editor, terminals, preview, and databases.'

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
        'A /workflows prompt fills the board, agents build and test a 2048 game in the browser, and a comment gets the cells resized.',
      thumbnailUrl: `${HOME_URL}films/demo.jpg`,
      contentUrl: `${HOME_URL}films/demo.mp4`,
      uploadDate: '2026-10-18',
      duration: 'PT52S',
      about: { '@id': `${HOME_URL}#app` },
    },
  ],
}
