/** Which workbench surface renders a file that is not a plain editor document. */
export type FileViewerKind = 'pdf' | 'document' | 'spreadsheet' | 'editor'

// The extension → media-type vocabulary and the binary sniff are shared with the server and
// plugin backends, so they live in the web-standard `../media-types` leaf.
export {
  BINARY_SNIFF_LENGTH,
  CSV_CONTENT_TYPE,
  DOCX_CONTENT_TYPE,
  fileExtension,
  hasBinarySignature,
  mediaTypeForExtension,
  mediaTypeForPath,
  ODT_CONTENT_TYPE,
  PDF_CONTENT_TYPE,
  PPTX_CONTENT_TYPE,
  XLSX_CONTENT_TYPE,
} from '../media-types'

/** One file format contributed to the host's dedicated-viewer router. */
export interface DedicatedViewerType {
  contentType: string
  viewer?: Exclude<FileViewerKind, 'editor'>
  openExternally?: boolean
}
