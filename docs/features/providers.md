# Connect model providers

Use the model picker to connect a provider and choose the model for the current session. The same
connection path supplies chat, auxiliary model tasks, and delegated agents.

**Availability:** Providers and models come from the active runtime catalog. API-key connections
need a catalog entry, and sign-in appears only when that runtime reports an OAuth flow.

## What you can do

| Capability                   | Mechanism                                                                            | Boundary                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Connect with an API key      | Store a key from the model picker's provider form                                    | A provider must exist in the runtime catalog                           |
| Connect from the environment | Select a catalog provider whose server-side environment key exists                   | Only the variable name reaches the client; its value stays server-side |
| Sign in through OAuth        | Start the interaction advertised by the runtime adapter                              | Availability and interaction style depend on the provider definition   |
| Keep separate connections    | Add and label more than one connection for the same provider                         | A session stores one preferred connection                              |
| Manage connection keys       | Add, remove, enable, or disable masked keys                                          | The final key cannot be removed or disabled                            |
| Choose a session model       | Bind a catalog model and connection from the composer                                | The model must belong to the connection's provider                     |
| Inspect model fit            | Compare capabilities, modalities, limits, wire protocol, and pricing including tiers | Catalog records can be partial or change with the active runtime       |
| Narrow the model list        | Search models, or filter by tools, reasoning, vision, priced caching, or free        | A facet appears only when some model in the list matches it            |
| Find a provider              | Search the provider column; it filters connections and providers to add              | It never narrows the model list                                        |
| Choose reasoning effort      | Pick a level in the model details panel's Settings, stored per provider/model pair   | A model that publishes none offers only "off"                          |
| Route auxiliary work         | Select model slots for session titles, inline completion, and delegated agents       | Each unset route uses its documented fallback                          |

## How it works

The composer and model details share the same reasoning preferences. The active participant's
session level takes precedence when reselecting its current model; a different model uses its saved
preference or inherits that participant's level, limited to the levels it supports. Switching
sessions resets the picker to the newly opened conversation. “Follow the conversation” clears a
preview model's explicit preference.

The runtime adapter projects its provider definitions, text models, image models, authentication
methods, limits, modalities, and pricing into engine-neutral catalog records. The API caches that
projection, and the model browser groups models by live connections. Its workload column lets the
user choose what the next model assignment is for before choosing the provider and model. On a
narrow window the workload and provider columns open from switchers in the model list's header, and
the model details panel, with its settings, opens in place of the list.

Creating a connection writes its label, provider id, authentication type, key order, and enabled
state to SQLite. API keys and OAuth token fields are stored separately in the encrypted credential
vault. Connection responses contain only a masked key suffix and metadata.

A conversation stores a connection id and a namespaced model id **per participant**, and only when
someone actually chose one there. At run time, Localix verifies that the provider owns the model,
tries the stored connection first, and can resolve another usable connection for the same provider
if that one no longer works. It never crosses to a different provider or model.

### Which model a participant runs on

A participant with no model of its own is answered in this order, every time the conversation is
read:

| Order | Level                               | Set from                      |
| ----- | ----------------------------------- | ----------------------------- |
| 1     | This conversation                   | The model picker, or `/model` |
| 2     | Your last choice **for this agent** | Learned from the picker       |
| 3     | The agent's default                 | **Settings → Agents**         |
| 4     | The project                         | **Settings → Project**        |
| 5     | The conversation's main model       | Its first participant         |

The picker learns a preference for that exact agent without modifying its definition. Every new
conversation starts with the last model explicitly selected for that agent. The agent's default is
used until the first selection and can be changed only in **Settings → Agents**. Preferences are per
agent, so one agent never inherits the model last selected for another. The main model is only the
final room fallback: it prevents an otherwise unconfigured participant from failing while the
conversation already has a working model. The picker labels this source as **main model**.

Because the chain is applied on READ, nothing is frozen at birth: a model you set on the project
today reaches the conversations you started yesterday. A participant seated later joins with no
model of its own and is answered the same way. A delegated child snapshots its assigned
participant's effective route from the parent, falling back to the parent's main model. This
inherited route does not become that agent's cross-session “last used” preference.

**Reasoning effort** follows the same order but is settled once, when a participant is seated,
because it is the dial for the task in front of you: a conversation started on `high` stays on
`high` when a level below it changes later. A child takes its parent's. With nothing stated anywhere
it starts at **medium**. A model that cannot reason is simply asked for none at request time; that
is a fact about the model, so it is never remembered as your preference and never carried to the
next model you pick.

The required **Chat sessions** route is the default for a direct conversation. Optional workload
routes cover session-title generation, inline completion, and delegated agents. Each optional route
can inherit a documented parent route rather than requiring another connection. Reasoning
preferences are keyed by workload, provider, and model so changing one route does not silently
rewrite another model's preference.

The board has no route of its own. A worker's model is its agent's — **Settings → Agents** — so it
applies on every dispatch path rather than only on a card; a card that names no model inherits the
session that owns the board, like any other unrouted workload.

Within one connection, the runtime selects the enabled key with the lowest numeric priority. OAuth
refresh runs through a connection-scoped credential store; refresh updates for one key are
serialized so concurrent runs do not overwrite rotating tokens.

The catalog adapter can enrich existing OpenRouter model records with public release dates for
sorting. It never creates a model that is absent from the runtime's built-in catalog.

## Configuration

The `OpenAI` provider supports **Sign in with ChatGPT** for subscription authentication. New browser
authorizations identify the application as **Localix** on ChatGPT's connection screen. The browser
sign-in finishes in the background. Once the connection is saved, the desktop app comes to the
foreground and shows the model list for that connection, including after signing in again. Close the
success page manually. The browser login uses a stable installation UUID, created on first use and
retained in `~/.localix/oauth-device-id` across restarts and projects. `OpenAI Codex (legacy)`
remains a separate provider using the older ChatGPT backend transport; existing connections keep
their provider identity.

| Control or value       | Contract                                                                       |
| ---------------------- | ------------------------------------------------------------------------------ |
| Provider source        | Runtime catalog projected by the engine's `listCatalog()`                      |
| API-key connection     | Requires at least one non-empty key                                            |
| Environment detection  | Uses catalog-declared variable names in the server process                     |
| OAuth connection       | Uses the runtime-reported browser, loopback-server, or device-code interaction |
| Connection label       | User-editable; does not change provider identity                               |
| Key display            | Masked to the final four characters                                            |
| Key selection          | Enabled keys ordered by ascending numeric priority                             |
| Model identity         | Stored as `<providerId>/<modelId>`                                             |
| Catalog metadata cache | `~/.localix/catalog-metadata.json`                                             |
| Required route         | Chat sessions                                                                  |
| Context routes         | Session titles, inline completion                                              |
| Worker route           | Delegated agents; with the route off, a child runs on the session model        |
| Reasoning preference   | Stored for the workload plus provider/model pair when supported                |

The onboarding provider step embeds the same model browser used by the workspace. It can connect a
detected environment key, create an API-key or OAuth connection, and remember the selected
connection and model for the first session.

## Limits

- “Provider-flexible” means the providers and models in the runtime catalog, not every provider,
  endpoint, protocol, or model.
- OAuth is not synthesized for API-key-only providers. The available sign-in methods are exactly
  those reported by the adapter's provider definitions.
- Multiple keys do not provide automatic rotation or request failover. A run selects the
  highest-priority enabled key; a provider failure does not retry the next key.
- If vault data is missing, corrupt, or unreadable, Localix keeps the connection metadata visible
  but excludes the credential from runnable connection state.
- The same-provider connection fallback occurs during model resolution. A failed provider request
  does not switch connections, providers, or models silently.
- Model requests send the assembled prompt and context to the selected provider. Connected providers
  remain outside Localix's local trust boundary; see [Privacy](../getting-started/privacy.md).
- Advertised capabilities, modalities, limits, dates, and pricing are catalog metadata rather than a
  Localix guarantee about provider behavior or availability.
- A stored reasoning preference does not add reasoning support to a model that does not advertise
  it, and one provider can expose fewer effort levels than another. The catalog publishes the levels
  each model offers, so the picker shows only those; a preference carried over from a finer-grained
  model is clamped to the nearest level the new one has — upward first, then down. The runtime
  clamps again before the request, so a level from an older client or an unpublished capability
  degrades instead of failing the run.
- Release dates and published reasoning levels come from OpenRouter's public model list. Localix
  asks for it once per launch (at most every five minutes), in the background, with a 1.5-second
  timeout. Nothing waits for the answer: the catalog is served from the last saved answer, or from
  the generated metadata on a first launch or when the network is unreachable. When the answer
  arrives, the next catalog read uses it and it is saved for the next launch. A failed request is
  never saved.
- The catalog endpoint answers with an `ETag`. A client that already holds the current catalog gets
  `304 Not Modified` instead of the full list.
- Providers that offer no chat models, such as classifier-only ones, are not offered for connection,
  including by environment-key detection.
- Environment-key detection offers only a variable that the provider's own authentication accepts as
  a plain API key, for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. Bearer tokens, cloud
  profiles and keys that need extra account values are not offered.
- When a chosen model cannot run, the error says why: the catalog no longer lists the model, the
  provider has no enabled key, or the connection's credential could not be loaded. The model picker
  shows `<model> is no longer available` when the catalog has dropped the model you chose.

## Related guides

- [Onboarding](onboarding.md)
- [Secrets](secrets.md)
- [Privacy](../getting-started/privacy.md)

## Source of truth

- [Runtime catalog projection](https://github.com/rsaryev/localix/blob/main/packages/agent-runtime-pi/src/models.ts)
- [Provider transports and metadata](https://github.com/rsaryev/localix/blob/main/packages/agent-runtime-pi/src/providers.ts)
- [Background catalog metadata refresh](https://github.com/rsaryev/localix/blob/main/packages/agent-runtime-pi/src/catalog-metadata.ts)
- [Provider API-key environment variables](https://github.com/rsaryev/localix/blob/main/packages/agent-runtime-pi/src/provider-env.ts)
- [Unresolved model reasons](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/model-resolution-miss.ts)
- [Runtime authentication bridge](https://github.com/rsaryev/localix/blob/main/packages/agent-runtime-pi/src/auth.ts)
- [Connection API and DTOs](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/provider-connections/contracts.ts)
- [Credential storage and refresh](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/provider-connections/service.ts)
- [Environment-key detection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/provider-connections/env-detect.ts)
- [Model and connection resolution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/model-resolution.ts)
- [Key-selection policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/provider-keys.ts)
- [Model browser](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/ui/prompt-input/model-select/ModelBrowser.tsx)
- [Workload route catalog](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/model-task-catalog.ts)
- [Model route persistence](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/ui/prompt-input/model-select/useModelTaskRouting.ts)
- [Per-model reasoning control](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/ui/prompt-input/model-select/ModelReasoningControl.tsx)
