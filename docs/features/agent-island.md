# Agent island

The agent island puts the question an agent is waiting on at the top of your Mac screen, at the
notch, while you work in another app. It has no chat and no input. It shows two things: a light that
runs while agents work, and the request card when one needs your answer. It is available on macOS
and is off until you turn it on; see [Turn the island on or off](#turn-the-island-on-or-off).

## What it shows

| State                | What you see                                                             |
| -------------------- | ------------------------------------------------------------------------ |
| Nothing to do        | Nothing. The island is invisible and clicks pass through it.             |
| An agent is working  | A light runs along the edge of the notch. There is nothing to open.      |
| A request is waiting | The request card opens below the notch, in the same form as in the app.  |
| Request left waiting | The card folds back into the notch, and a warmer, faster light stays on. |

The card is the [human-in-the-loop](hitl.md) card you already know: a title naming the act,
**Deny**, **Approve** rightmost, and the time left before the request expires. It covers questions,
permission approvals and configuration proposals. Choosing **Open chat** in its header shows the
conversation in the app, and the request stays pending there.

## When it opens

The island opens only when Localix is not the active app. While a Localix window is focused, the
request stays in the app, where it appears as it always did, and a click on the notch passes
through. A request that arrived meanwhile opens on the island once you switch to another app.
Returning to Localix folds the island, and the app shows the request.

## Answer, fold and disappear

- **Answer.** Click **Approve** or **Deny**, or answer a question and send it. The answer goes
  through the same path as in the chat, and the island disappears completely. If another request is
  waiting, it takes the card next.
- **Resolved elsewhere.** If you answer in the app, or the request expires or is cancelled, the
  island folds and disappears the same way.
- **Left alone.** An unanswered card folds after about fifteen seconds, or as soon as the pointer
  leaves it. The request is not answered by folding: it stays pending, and the warm light keeps
  showing that something waits. Rest the pointer on the notch, or click it, to open the card again.

The keyboard stays with the app you were using. A card that opens by itself never takes your next
Enter; **Enter** and **Escape** answer it only after you click inside the card, as they do in the
app. Reduced motion keeps the light still.

## Turn the island on or off

Open **Settings → Preferences → Agent island** and use **Show the agent island**. The choice applies
to this device and survives a restart. The section is absent on other platforms.
