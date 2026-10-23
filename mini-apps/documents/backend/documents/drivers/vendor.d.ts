/**
 * Minimal ambient declarations for the two document-parsing libs that ship no type
 * declarations (mammoth, xlsx, officeparser, fflate all bundle their own). Kept to
 * the members the drivers actually call, so `await import(...)` type-checks cleanly.
 */

declare module 'turndown' {
  interface TurndownOptions {
    headingStyle?: 'setext' | 'atx'
    codeBlockStyle?: 'indented' | 'fenced'
    bulletListMarker?: '-' | '+' | '*'
    hr?: string
    emDelimiter?: string
    [key: string]: unknown
  }
  export default class TurndownService {
    constructor(options?: TurndownOptions)
    turndown(html: string): string
    use(plugin: unknown | unknown[]): this
    remove(filter: unknown): this
  }
}

declare module 'turndown-plugin-gfm' {
  const gfm: unknown
  const tables: unknown
  const strikethrough: unknown
  const taskListItems: unknown
  export { gfm, tables, strikethrough, taskListItems }
}

declare module 'word-extractor' {
  class ExtractedDocument {
    getBody(): string
    getFootnotes(): string
    getEndnotes(): string
    getHeaders(): string
    getFooters(): string
  }
  export default class WordExtractor {
    extract(input: Buffer | string): Promise<ExtractedDocument>
  }
}
