import { lazy, Suspense } from 'react'
import { BookOpen, Library, TextQuote } from 'lucide-react'
import {
  resourceMessageBindingDraft,
  type FileEditorProps,
  type MiniAppUiHost,
  type PublishMessageContext,
  type WorkItemLike,
} from '@localixai/mini-app-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { isReaderReadable } from '../shared/formats'
import { parseReaderUri, readerBookUri, readerRootUri } from '../shared/resource-uri'
import { useReaderStatusItem } from './statusItem'

const ReaderWorkspaceLazy = lazy(() =>
  import('./ReaderWorkspace').then((module) => ({ default: module.ReaderWorkspace })),
)

// Both tab bodies read the chat they belong to from the host (`useWorkItemSessionId`), never the
// opaque `item.scope` and never the chat in front: the open book is remembered per chat and a
// quote or note is inserted into the chat's composer, so a guessed chat sent them to whichever one
// was on screen. Both are session kinds — a body without a session has nothing to show.
function ReaderLibraryBody({
  visible,
  publishMessageContext,
}: {
  visible: boolean
  publishMessageContext?: PublishMessageContext
}) {
  const sessionId = useWorkItemSessionId()
  if (!sessionId) return null
  return (
    <Suspense fallback={<LoadingHint>Opening Reader…</LoadingHint>}>
      <ReaderWorkspaceLazy
        key={sessionId}
        sessionId={sessionId}
        visible={visible}
        publishMessageContext={publishMessageContext}
      />
    </Suspense>
  )
}

function ReaderBookBody({
  item,
  visible,
  publishMessageContext,
}: {
  item: WorkItemLike
  visible: boolean
  publishMessageContext?: PublishMessageContext
}) {
  const sessionId = useWorkItemSessionId()
  if (!sessionId) return null
  return (
    <Suspense fallback={<LoadingHint>Opening book…</LoadingHint>}>
      <ReaderWorkspaceLazy
        sessionId={sessionId}
        visible={visible}
        initialPath={typeof item.payload?.path === 'string' ? item.payload.path : undefined}
        initialMediaId={
          typeof item.payload?.mediaId === 'string' ? item.payload.mediaId : undefined
        }
        initialName={typeof item.payload?.name === 'string' ? item.payload.name : undefined}
        initialChapter={
          typeof item.payload?.chapter === 'number' ? item.payload.chapter : undefined
        }
        publishMessageContext={publishMessageContext}
      />
    </Suspense>
  )
}

function ReaderFileBody({
  path,
  mediaId,
  name,
  sessionId,
  publishMessageContext,
}: FileEditorProps) {
  return (
    <Suspense fallback={<LoadingHint>Opening book…</LoadingHint>}>
      <ReaderWorkspaceLazy
        sessionId={sessionId}
        initialPath={path || undefined}
        initialMediaId={mediaId}
        initialName={name}
        publishMessageContext={publishMessageContext}
      />
    </Suspense>
  )
}

function readerBookTabId(path: string): string {
  return `reader:book:${encodeURIComponent(path)}`
}

let registered = false

export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true

  host.workItems.register({
    kind: 'reader:workspace',
    Component: ReaderLibraryBody,
    Icon: Library,
    restorable: true,
    scope: 'session',
    agentContext: {
      description: 'Reader library for the session this tab belongs to.',
      tools: ['reader_research'],
      nextSteps: [
        'Inspect the library or selected source.',
        'Use reader_research for a question that needs evidence across sources.',
      ],
    },
    toMessageBinding: (item) =>
      resourceMessageBindingDraft({ uri: readerRootUri(), label: item.title }),
  })
  host.workItems.register({
    kind: 'reader:book',
    Component: ReaderBookBody,
    Icon: BookOpen,
    restorable: true,
    scope: 'session',
    siblingGroupKey: () => 'reader:books',
    agentContext: {
      description: 'Open book or document in Reader.',
      tools: ['reader_research'],
      nextSteps: [
        'Inspect the current document and position.',
        'Use reader_research when the user asks for sourced analysis.',
      ],
    },
    toMessageBinding: (item) => {
      const path = typeof item.payload?.path === 'string' ? item.payload.path : null
      const mediaId = typeof item.payload?.mediaId === 'string' ? item.payload.mediaId : null
      if (!path && !mediaId) return null
      return resourceMessageBindingDraft({
        uri: readerBookUri(
          path
            ? { path }
            : {
                mediaId: mediaId!,
                ...(typeof item.payload?.name === 'string' ? { name: item.payload.name } : {}),
              },
        ),
        label: item.title,
      })
    },
  })
  // The open book in the titlebar — the source the next `reader_research` answer comes from.
  host.statusItems.register({
    id: 'reader:open-book',
    placement: 'titlebar',
    useItem: useReaderStatusItem,
  })
  host.railViewlets.register({
    kind: 'reader:workspace',
    title: 'Reader',
    label: 'Reader — focused local reading with live agent context',
    defaultArea: 'bar',
    keywords: ['reader', 'book', 'epub', 'library', 'reading', 'notes', 'research'],
    Icon: Library,
  })
  host.anchors.register({
    id: 'reader:resources',
    namespaces: ['reader'],
    icons: { book: BookOpen, chapter: TextQuote },
    resolve: (uri) => {
      const parsed = parseReaderUri(uri)
      if (!parsed) return null
      if (parsed.kind === 'root') {
        return {
          kind: 'work-item',
          workKind: 'reader:workspace',
          id: 'reader:workspace',
          title: 'Reader',
        }
      }
      const sourceKey = 'path' in parsed.source ? parsed.source.path : parsed.source.mediaId
      const sourceTitle =
        'path' in parsed.source
          ? (parsed.source.path.split('/').at(-1) ?? 'Book')
          : (parsed.source.name ?? 'Uploaded book')
      return {
        kind: 'work-item',
        workKind: 'reader:book',
        id: readerBookTabId(sourceKey),
        title: sourceTitle,
        payload: {
          ...parsed.source,
          ...(parsed.kind === 'chapter' ? { chapter: parsed.chapter } : {}),
        },
      }
    },
  })
  host.resourceRefIcons.register({ book: BookOpen, chapter: TextQuote })
  host.fileFormats.register({
    epub: { contentType: 'application/epub+zip', openExternally: true },
    mobi: { contentType: 'application/x-mobipocket-ebook', openExternally: true },
    azw3: { contentType: 'application/x-mobipocket-ebook', openExternally: true },
    fb2: { contentType: 'application/x-fictionbook+xml', openExternally: true },
    cbz: { contentType: 'application/vnd.comicbook+zip', openExternally: true },
  })
  host.fileEditors.register({
    id: 'reader:book',
    label: 'Reader',
    // Same table the backend parses with (`shared/formats`) — the editor must never
    // claim a file the reader cannot open.
    match: (path) => isReaderReadable(path),
    Component: ReaderFileBody,
    acceptsMedia: true,
  })
}
