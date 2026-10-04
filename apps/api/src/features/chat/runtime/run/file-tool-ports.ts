/**
 * What the FILE tools may reach outside the filesystem: post-edit diagnostics, the outline
 * view, document text extraction, and the person's unsaved editor buffers. Optional host
 * capabilities, resolved per run so a provider or language-server change is honoured on the
 * next turn rather than at boot.
 *
 * The language server reaches the model through these two ports only. There are no
 * LSP-driven model tools: navigation is `search` + `read`, and an LSP-authored
 * rename/quick-fix wrote files one at a time with no rollback, so a partial failure left
 * the tree half-renamed.
 */
import type { DiagnosticsReporter } from '../../../agent-core/tools/file/file-utils'
import type { CoreToolDeps } from '../../../agent-core/tool-registry'
import type { RunnerDeps } from '../agent-runner-types'
import { buildDocumentTextExtractor } from './document-extract'
import { editorBufferNote } from './editor-buffer-note'

export interface FileToolPortsDeps {
  deps: RunnerDeps
  defaultCwd: string
  /** Whose editor buffers the file tools may see — never another user's. */
  userId: string
}

export function buildFileToolPorts({
  deps,
  defaultCwd,
  userId,
}: FileToolPortsDeps): Pick<
  CoreToolDeps,
  'reportDiagnostics' | 'readOutline' | 'readDocumentExtractor' | 'editorBuffer'
> {
  const editorBufferText = deps.editorBufferText
  const lspManager = deps.lspManager
  // Resolved when the toolkit is built for THIS run, so provider changes are honoured.
  const documentPort = deps.documentExtract?.()
  return {
    // After every write/edit/apply_patch, notify the language server and fold any errors
    // straight into the tool result — no separate diagnostics tool call. Returns '' when
    // clean or when no server handles the file type.
    reportDiagnostics: lspManager
      ? async (filePaths) => (await lspManager.reportFileDiagnostics(filePaths, defaultCwd)).block
      : (undefined as DiagnosticsReporter | undefined),
    // read mode:'outline' — the file's language-server symbol skeleton (the same
    // documentSymbols the UI outline uses), so the agent can survey a big source file for a
    // fraction of a full read.
    readOutline: lspManager
      ? async (filePath) => lspManager.documentSymbols(defaultCwd, filePath)
      : undefined,
    // read on an office/PDF file: delegate to the extractor so a `.docx`/`.pdf` read yields
    // text instead of the binary-file refusal. Absent → `read` unchanged.
    readDocumentExtractor: documentPort ? buildDocumentTextExtractor(documentPort) : undefined,
    // The person's unsaved editor text for a file the tools read or write, as a result note
    // (`editor-buffer-note.ts`). The buffer is the LSP document service's copy — the editor
    // syncs it on every pause in typing — so no extra round-trip to the UI.
    editorBuffer: editorBufferText
      ? (path, diskText, moment) =>
          editorBufferNote(path, diskText, editorBufferText(userId, path), moment)
      : undefined,
  }
}
