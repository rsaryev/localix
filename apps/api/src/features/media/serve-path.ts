/**
 * The single source of truth for the media-serving URL shape. The API emits this
 * RELATIVE path on file-backed attachments/thumbnails; the UI resolves it against
 * its API origin (`API_BASE_URL`). Keeping the shape in one place means the route
 * mount (`/rpc/media` in app.ts) and every consumer can't drift apart.
 */
export const MEDIA_SERVE_PREFIX = '/rpc/media'
