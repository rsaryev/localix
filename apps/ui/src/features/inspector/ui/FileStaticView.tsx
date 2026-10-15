import { FileText, FileX2 } from 'lucide-react'
import { isOpenExternallyType } from '@/shared/lib/contentTypeRouting'
import { StateNotice } from '@localixai/kit/state-notice'
import { looksBinary } from '@/shared/lib/looksBinary'
import { baseName } from '@localixai/plugin-sdk/ui/utilities'
import type { FileLoadState } from './fileLoadState'
import { isMarkdown } from './fileTabHelpers'
import { FileImageView } from './FileImageView'
import { FileReadonlyView } from './FileReadonlyView'

type ReadyState = Extract<FileLoadState, { status: 'ready' }>

/** A loaded file the editor does not take: an image, a binary, an empty or a read-only file. */
export function FileStaticView({
  path,
  state,
  line,
}: {
  path: string
  state: ReadyState
  line?: number
}) {
  if (state.mimeType?.startsWith('image/')) {
    return (
      <FileImageView
        path={path}
        content={state.content}
        mimeType={state.mimeType}
        encoding={state.encoding}
        truncated={state.truncated}
      />
    )
  }

  // Non-image binary (read back as mojibake) — don't render garbage as code.
  if (!isMarkdown(path) && looksBinary(state.content)) {
    return (
      <StateNotice
        icon={FileX2}
        title={baseName(path)}
        body="Binary file — preview not supported."
      />
    )
  }

  // An empty file would render as a blank panel — say so explicitly.
  if (state.content === '') {
    return <StateNotice title={baseName(path)} body="Empty file" />
  }

  return (
    <FileReadonlyView path={path} content={state.content} truncated={state.truncated} line={line} />
  )
}

/**
 * Safety net: pdf/office/spreadsheet files have dedicated read-only viewers that the
 * editor grid routes them to. If one reaches the code editor directly (a caller that
 * bypassed that routing), don't try to edit it or render its bytes as text — surface
 * a read-only notice keyed off the shared content-type routing.
 */
export function FileDocumentNotice({ path, contentType }: { path: string; contentType: string }) {
  return (
    <StateNotice
      icon={FileText}
      title={baseName(path)}
      body={
        isOpenExternallyType(contentType)
          ? 'This document is read-only in-app — open it from the file tree to use its viewer.'
          : 'This file opens as a table, not in the code editor.'
      }
    />
  )
}
