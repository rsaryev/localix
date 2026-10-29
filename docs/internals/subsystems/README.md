# Subsystem notes

These pages record implementation contracts and failure boundaries for individual Localix
subsystems. Read the matching note before changing that subsystem; user-facing behavior remains in
the linked feature guides.

| Subsystem                                                                         | Contract                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Active-tab context](active-tab-context.md)                                       | How visible workspace state becomes bounded model context                            |
| [Attachment spill-to-disk](attachment-spill.md)                                   | Attachment persistence, cleanup, and prompt references                               |
| [Context Fabric and Edit Prediction](context-and-edit-prediction-architecture.md) | Shared architecture for context collection and edit suggestions                      |
| [Capabilities](capabilities.md)                                                   | What is installed, what may run, and how the two compose                             |
| [Composer tips](composer-tips.md)                                                 | Snapshot-derived tip text, relevance gates, pacing, and actions                      |
| [Context system](context-system.md)                                               | Context references, selection, persistence, and runtime projection                   |
| [Edit prediction](edit-prediction.md)                                             | Prediction requests, cancellation, caching, and acceptance                           |
| [Global search](global-search.md)                                                 | Search domains, ranking, navigation, and result limits                               |
| [Change feed](change-feed.md)                                                     | Typed change notices, consumer cursors, cascades and the shared writer               |
| [Semantic index and local models](semantic-index.md)                              | Embedding engine, indexing, hybrid ranking, the model router and mini app API        |
| [Message bindings](message-bindings.md)                                           | Durable message-to-resource links and runtime projection                             |
| [Notifications](notifications.md)                                                 | Notification policy, delivery channels, and interruption state                       |
| [Notification problems](notification-problems.md)                                 | Standing conditions, request traces, duplicate suppression, and mini app attribution |
| [Agent preview control](preview-control.md)                                       | Preview lifecycle, probe connection, capture, and actions                            |
| [Research context](research-context.md)                                           | Research-result persistence and context injection                                    |
| [UI anchors and locations](ui-anchors.md)                                         | Stable UI targets for navigation and contributed surfaces                            |
| [Workbench contributions](workbench-contributions.md)                             | Mini app workbench registration, routing, and enablement                             |

## Related guides

- [Documentation index](../../README.md)
- [Architecture](../architecture.md)
- [Contributing](../contributing.md)
