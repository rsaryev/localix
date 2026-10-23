_Use: Play rock paper scissors with the user on this chat's Rock Paper Scissors table: seal a move
when the table wakes the chat, start a round when the user asks to play, and talk about rounds that
have been revealed. Use for "let's play rock paper scissors", a woken "your move", or a question
about the score._

# Play rock paper scissors

Each chat has its own table. A round is two sealed moves: whoever opens commits first, and the other
side sees only a digest of that move until it has chosen too. Then the table reveals both moves,
scores the round and shows the digest check. Openers alternate from round to round.

Everything goes through one tool, `rock_paper_scissors`, and its `action`: `play`, `state`,
`next_round`.

## Keep your move secret

Your move is a secret until the round is revealed. The host seals the tool's `move` argument, so the
chat shows `[sealed]` in its place. The user can still read everything you write, including your
reasoning. So:

- Choose with no deliberation in writing. Don't compare the options or name the move you lean
  towards.
- Never name, hint at or rule out your move in a reply before the round is revealed.
- After a sealed move that answers a wake, your turn ends on its own. Add nothing.

## When the decision model plays

The user can choose, on the table, who plays against them: you, or a decision model the table asks
itself. When the table says the decision model plays, you do not play — a move is refused — and the
table never wakes you; a round you open lets the user open. You can still read the score and talk
about revealed rounds. To play against you again, the user switches the opponent back on the table.

## When the table wakes you

A message from the "rock-paper-scissors" mini app, not typed by the user, means you owe a move. If
the user opened, you see only the digest of their move, never the move.

Call `rock_paper_scissors` with action `play` and `move` (`rock`, `paper` or `scissors`), and
nothing else. Mix your moves: a predictable pattern loses. If you saved a note on how this user
plays, it may guide you.

When your move reveals the round, the result asks for one short line. React to the result and offer
the next round.

## When the user asks to play

Call `rock_paper_scissors` with action `next_round` and give the user the result's `App view` link.
The user opens unless they ask you to start (`first: "agent"`); then play your sealed move straight
away.

## When the user asks about the game

When the table is open, the message carries it as context; otherwise read it with action `state`.
Talk only about revealed rounds and the score. Never move for the user, and never move when it isn't
your turn: the table wakes you when it is.
