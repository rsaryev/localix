# Set up a provider and model

The `/setup` page connects a provider and chooses the default chat model for new desktop/web
sessions. It prepares a first session through the same model browser used later in the workspace.

## What you can do

| Step         | Mechanism                                                        | Boundary                                                      |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| **Welcome**  | Continue to provider setup or finish setup immediately           | Provider setup is optional                                    |
| **Provider** | Create or select a provider connection, then choose a chat model | **Continue** requires a connection with key material          |
| **Ready**    | Review the connection and the chosen model                       | The check does not contact the provider or validate the model |

The Provider step also lists credentials detected in the Localix server environment. Connecting one
sends only its provider id; the server reads the key and creates an API-key connection without
returning the secret value to the client, then opens that provider's models.

When a provider is connected but no model is chosen, the step suggests one catalog model as a
one-click default. The suggestion ranks the provider's own chat models by tool support, reasoning
and attachments, release date, context length, and price; it prefers a standard model over a reduced
"mini" variant, and never reaches across providers.

## How it works

After settings synchronize, Localix redirects to `/setup` when `uiSettings.onboardingCompletedAt` is
absent. Finishing or skipping writes the timestamp, clears tab-scoped wizard progress, and returns
to the home route.

The Provider step embeds the workspace `ModelBrowser`. It supplies provider and model search,
connection forms, recent and favorite models, filters, and workload routes without a separate
onboarding catalog. That step renders in a near-full-width column, because the browser's workload,
provider, and details panes claim a fixed width before the model list gets any. The step opens on
the most recently added connection rather than on whichever pane happened to resolve first.

Choosing the Chat route writes `localix_last_connection` and `localix_last_model` to browser
`localStorage` when you continue. New desktop/web sessions read those values; the connection is used
only while it still exists in the client's current connection list.

The shared browser also exposes other workload routes. Changes to those routes save immediately;
only the Chat selection controls the onboarding **Continue** button.

The Ready step checks for a non-empty remembered model id and a matching connection id, then lists
the connection and model with a link back to the Provider step that owns them. Current and
furthest-visited steps live in tab-scoped `sessionStorage` as step **ids**, so a full-page OAuth
return reopens the Provider step even across a release that reorders the steps; an unrecognized id
resumes at Welcome. Visited steps remain navigable, unseen steps stay locked, and Escape moves back
one step.

## Configuration

| State or control                          | Storage or effect                                            |
| ----------------------------------------- | ------------------------------------------------------------ |
| `uiSettings.onboardingCompletedAt`        | Suppresses the first-run redirect after settings synchronize |
| `localix_last_connection`                 | Browser-local connection id used to seed new sessions        |
| `localix_last_model`                      | Browser-local model id used to seed new sessions             |
| `localix_onboarding_step`                 | Current step id in tab-scoped `sessionStorage`               |
| `localix_onboarding_furthest`             | Furthest visited step id in tab-scoped `sessionStorage`      |
| **Settings → Preferences → Replay setup** | Opens `/setup` without clearing the completion timestamp     |
| **Skip setup for now**                    | Records completion and exits from Welcome                    |
| **Skip this step**                        | Advances from Provider without choosing a model              |
| **Finish without a model**                | Records completion from Ready without a runnable pair        |

## Limits

- **Ready to chat** is a structural check, not a credential or inference test. Authentication,
  quota, network access, disabled keys, or a stale model id can still fail on the first request.
- Onboarding can finish without a provider or model. That does not establish a browser chat default;
  a new session still needs an existing project default or a provider and model selected elsewhere.
- Remembered defaults live in one browser profile. They do not follow the user to another browser
  profile.
- The wizard configures a provider and a chat model but not appearance, typography, shortcuts,
  profile, plugins, skills, workbenches, or channels.
- Only the Chat model is committed by **Continue**. The browser's other workload routes save as you
  change them, so skipping the step does not undo them.
- The wizard does not scan or import plugins, agents, skills, MCP configuration, or provider files
  from another application. Those artifacts use their owning installation or import flows.
- If `sessionStorage` is unavailable, a full-page OAuth return reopens at Welcome. The Provider
  completion handler is not mounted again until you advance to that step.

## Related guides

- [Installation](../getting-started/installation.md)
- [Your first session](../getting-started/first-session.md)
- [Providers and credentials](providers.md)

## Source of truth

- [Step registry](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/onboarding/model/steps.ts)
- [Wizard navigation](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/onboarding/ui/OnboardingWizard.tsx)
- [Tab-scoped progress](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/onboarding/model/onboardingProgress.ts)
- [Provider step](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/onboarding/ui/steps/ProviderStep.tsx)
- [Recommended-model heuristic](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/onboarding/model/recommendedModel.ts)
- [Readiness check](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/onboarding/ui/steps/ReadyStep.tsx)
- [Stored chat defaults](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/model/persistence.ts)
- [New-session defaults](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/model/sessionActionsSlice.ts)
- [First-run redirect](https://github.com/rsaryev/localix/blob/main/apps/ui/src/app/RootLayout.tsx)
- [Environment-detected providers](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/provider-connections/env-detect.ts)
