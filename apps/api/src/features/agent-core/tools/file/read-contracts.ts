export interface ReadToolDetails {
  path: string
  bytes: number
  truncated: boolean
  output: string
  /** Set when the file was an image (the card shows its picture) or a rendered notebook. */
  kind?: 'image' | 'notebook'
  mediaType?: string
  width?: number
  height?: number
  /** A batched read (`reads`): one entry per file, in the order asked. */
  items?: ReadItemDetails[]
}

/** One file of a batched read, as its card row shows it. */
export interface ReadItemDetails extends Omit<ReadToolDetails, 'items'> {
  /** The window asked for: `L10-40`, `outline`, `from byte 64000`; absent for a whole file. */
  range?: string
  isError?: true
  /** Not delivered: past the call's item, text or image budget. The model was told to re-read it. */
  skipped?: true
}
