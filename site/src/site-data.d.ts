// What the build reads from the repository's files for the landing (vite.config.ts, `data`).
declare module 'virtual:site-data' {
  /** Each docs page's title by its file's name without `.md`. */
  export const DOC_TITLES: Record<string, string>;
  /** The changelog's latest releases, newest first. `date` is '' when the heading has none. */
  export const RELEASES: { version: string; date: string; summary: string; changes: number }[];
}
