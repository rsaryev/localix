# Share durable view state with explicit revisions

Conversation routes keep their existing domain owner. Durable surface selections and conversation
drafts use a typed, user-scoped view-state registry on the backend and the existing realtime
transport. Each write names the revision it read: concurrent edits to an unsent draft retain both
versions for a user decision instead of silently overwriting text. Focus, hover, native geometry and
device layout stay local because synchronizing them would make independent windows move or steal
focus.
