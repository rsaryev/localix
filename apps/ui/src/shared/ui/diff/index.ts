export { VirtualDiff, type VirtualDiffProps } from './VirtualDiff'
export { DiffStat } from './DiffFileHeader'
export { DiffViewModeToggle } from './DiffViewModeToggle'
export { useDiffViewMode, setDiffViewMode, type DiffViewMode } from './diffViewMode'
export { DiffCode, escapeDiffHtml } from './DiffCode'
export { HunkHeaderLabel } from './HunkHeaderLabel'
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
export {
  DIFF_ROW_CLASS,
  DIFF_CTX_ROW_CLASS,
  DIFF_SIGN_CLASS,
  DIFF_WORD_MARK,
  diffRowWash,
  diffSignGlyph,
  diffSignClass,
  type DiffChangeKind,
  type DiffLineKind,
} from './diffLineStyles'
export {
  parseUnifiedDiff,
  firstChangedLine,
  countDiffLines,
  countDiffStats,
  languageFromPath,
} from './parseUnifiedDiff'
export type { DiffHunk, DiffLine, DiffLineType } from './parseUnifiedDiff'
export { parseApplyPatch } from './parseApplyPatch'
export type { PatchFileSegment, PatchSegmentKind } from './parseApplyPatch'
