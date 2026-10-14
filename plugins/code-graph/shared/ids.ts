/**
 * The ONE place a node id is spelled.
 *
 * Both references lost weeks to ids formed in two places: an extractor and a builder that disagreed
 * by one normalisation step produced two disconnected nodes for one function, and slug ids without
 * the file path collided across files that shared a stem. So an id is the project-relative path
 * (never absolute: the same project checked out elsewhere must produce the same ids) plus, for a
 * symbol, its qualified name inside that file — readable in a tool result, unique by construction,
 * and built only here.
 */

export const ROOT_DIR_ID = 'dir:.'

export const dirId = (path: string) => (path === '' || path === '.' ? ROOT_DIR_ID : `dir:${path}`)

export const fileId = (path: string) => `file:${path}`

/**
 * `sym:<file>#<qualified>`. `qualified` is dot-joined (`Client.send`); `ordinal` disambiguates a
 * second definition of the same qualified name in one file (overloads, a redefinition), counted in
 * source order so a re-parse of the same text yields the same id.
 */
export const symbolId = (path: string, qualified: string, ordinal = 0) =>
  `sym:${path}#${qualified}${ordinal > 0 ? `~${ordinal + 1}` : ''}`

export const packageId = (name: string) => `pkg:${name}`

/** The directory part of a project-relative path; '' for a top-level entry. */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}
