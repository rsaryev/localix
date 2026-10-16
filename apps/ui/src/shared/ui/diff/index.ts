export { VirtualDiff, type VirtualDiffProps } from './VirtualDiff'
export { DiffStat } from './DiffFileHeader'

export { useDiffViewMode } from './diffViewMode'

export {
  buildDiffDocument,
  type DiffDocument,
  type DiffFileInput,
  type DiffHunkInput,
  type DiffLineInput,
  type DocFile,
  type DocRun,
} from './document/diffDocument'
export { diffDocumentFromPatch, parsePatchText } from './document/parsePatchText'

export { firstChangedLine, languageFromPath } from './parseUnifiedDiff'
