export interface SearchToolDetails {
  query: string
  cwd: string
  glob?: string
  bytes: number
  truncated: boolean
  output: string
  /** A batched search (`queries`): one entry per query, in the order asked. */
  queries?: SearchQueryDetails[]
}

/** One query of a batched search, as its card section shows it. */
export interface SearchQueryDetails extends Omit<SearchToolDetails, 'queries'> {
  isError?: true
  /** Not delivered: past the call's query or text budget. The model was told to run it alone. */
  skipped?: true
}
