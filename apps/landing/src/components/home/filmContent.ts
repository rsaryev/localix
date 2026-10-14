/**
 * The product films on the homepage: one chapter each in the workspace player. Each is a short,
 * silent film rendered from real Localix captures (the video studio's plates), published under
 * `public/films/<key>.mp4` with a poster `<key>.jpg`. The title and detail read as the section
 * heading while the chapter plays; they repeat what the owning guide documents.
 */
export interface Film {
  key: string
  label: string
  title: string
  detail: string
  alt: string
}

export const FILMS: readonly Film[] = [
  {
    key: 'team',
    label: 'Team',
    title: 'A team in one conversation.',
    detail:
      'Bring in the agents the work needs, give each a role, and keep every approval with you.',
    alt: 'Team Lead, Frontend and QA Engineer join one conversation, the board fills, and a test command waits for approval',
  },
]

export const filmSrc = (film: Film) => `/films/${film.key}.mp4`
export const filmPoster = (film: Film) => `/films/${film.key}.jpg`
