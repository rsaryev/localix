# Subsystem notes

These pages record implementation contracts and failure boundaries for individual Localix
subsystems. Read the matching note before changing that subsystem; user-facing behavior remains in
the linked feature guides.

| Subsystem                                                                         | Contract                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Active-tab context](active-tab-context.md)                                       | How visible workspace state becomes bounded model context          |
| [Attachment spill-to-disk](attachment-spill.md)                                   | Attachment persistence, cleanup, and prompt references             |
| [Context Fabric and Edit Prediction](context-and-edit-prediction-architecture.md) | Shared architecture for context collection and edit suggestions    |
| [Capabilities](capabilities.md)                                                   | What is installed, what may run, and how the two compose           |
| [Context system](context-system.md)                                               | Context references, selection, persistence, and runtime projection |
| [Native data view](data-view.md)                                                  | Detection, export, viewer selection, and native-app opening        |
| [DevOps Workspace](devops-workbench.md)                                           | Workbench registration, overview data, and tool boundaries         |
| [Docker provider](docker-workbench.md)                                            | Docker discovery, actions, streaming, and project identity         |
| [Documents plugin](documents.md)                                                  | Extraction, viewers, generation, and format limits                 |
| [Edit prediction](edit-prediction.md)                                             | Prediction requests, cancellation, caching, and acceptance         |
| [Global search](global-search.md)                                                 | Search domains, ranking, navigation, and result limits             |
| [Kubernetes provider](kubernetes-workbench.md)                                    | Contexts, resources, watches, actions, and safety gates            |
| [Message bindings](message-bindings.md)                                           | Durable message-to-resource links and runtime projection           |
| [Notifications](notifications.md)                                                 | Notification policy, delivery channels, and interruption state     |
| [Onboarding](onboarding.md)                                                       | First-run state, step progression, and completion                  |
| [Agent preview control](preview-control.md)                                       | Preview lifecycle, probe connection, capture, and actions          |
| [Research context](research-context.md)                                           | Research-result persistence and context injection                  |
| [Source control](source-control.md)                                               | Repository state, diffs, staging, commits, and branch operations   |
| [Trading workbench](trading-workbench.md)                                         | Public market data, streaming, and read-only tool policy           |
| [UI anchors and locations](ui-anchors.md)                                         | Stable UI targets for navigation and contributed surfaces          |
| [Workbench contributions](workbench-contributions.md)                             | Plugin workbench registration, routing, and enablement             |

## Related guides

- [Documentation index](../../README.md)
- [Architecture](../architecture.md)
- [Contributing](../contributing.md)
