export type { ToolTiming } from '@localixai/api/client'

// Message + system-notice types live in the shared API contracts layer
// (shared/api/contracts.ts) so shared code can use them without importing from
// this feature; re-exported here to keep feature-internal call sites stable.
export type {
  Message,
  SystemNotice,
  SystemNoticeKind,
  SystemNoticeTone,
} from '@/shared/api/contracts'
