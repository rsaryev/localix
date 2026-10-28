# Decision models

A decision model answers typed questions instead of writing text. It reads the state Localix gives
it and returns a pick among options, or the probability that a statement is true, with the
probability of each answer. Localix uses one wherever a quick, cheap choice beats a full model turn.

**Availability:** On once an OpenRouter connection can serve the model. Localix uses Jev
(`~typesafe/jev-latest`) through OpenRouter. A call costs a fraction of a cent and usually answers
in about a third of a second.

## Turn them on

Connect OpenRouter. The start screen's **Connect OpenRouter for decisions** slide opens the model
picker on OpenRouter; choose **Sign in with OpenRouter**, or paste an API key. Nothing else is
configured: features that can use a decision model start using it as soon as the connection works.

## Where Localix uses them

| Where                                                                | What the model decides                                                   | Without one                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| [Browser](workspace.md#the-browser)                                  | The next click or field during a `goal` run, from the agent's own values | The agent uses ordinary steps |
| [Games](games.md)                                                    | The opponent's move, when the table plays the decision model             | The chat agent plays          |
| [Mini apps](../extending/mini-app-semantics.md#ask-a-decision-model) | Small choices a mini app makes itself, through `ctx.host.decisions`      | The mini app's own fallback   |

Every caller keeps its own fallback. A decision that comes back late, refused, or with no connection
leaves the feature on that fallback; it never fails the feature.

## Spend and privacy

Each call is recorded in the usage ledger under **Decisions**, against the conversation it served.
The request carries the state the question needs: the page's controls and visible text for the
Browser, the board for a game. Decisions are logged without that state.
