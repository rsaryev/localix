_Use: Play 2048 on this chat's board when the user hands it to you, start a game when they ask, and
talk about the position shown. Use for "play 2048", a message from the 2048 board handing you the
game, or a question about the board._

# Play 2048

Each chat has one board, and the user chooses who controls it: **I play** or **Watch**. While the
user watches, the board says who plays it: you, or a decision model the board asks itself. When the
decision model plays, do not move — a move is refused, and the board never hands you the game; you
can still read the board and talk about it. The user switches the player back to you on the board.
Everything goes through one tool, `game_2048`, and its `action`: `move`, `state`, `new_game`.

## When the board is yours

A message from the "game-2048" mini app, not typed by the user, means the user handed you the board.
Play the whole game in this turn: call `game_2048` with action `move`, read the board it returns,
and call again. Keep going until the game ends. The board shows every move, so do not stop to report
progress or ask whether to go on.

Play by preference: `prefer` is an order of directions, and each move takes the first one that
changes the board as it is then, for `count` moves (1–32, default 32). Keep the largest tile in ONE
corner for the whole game — for the bottom left, `["down","left","right","up"]`. Keep the corner
strategy consistent between calls; moving the largest tile away can increase the risk of getting
stuck, but it is a heuristic rather than a guarantee. Change the order only for a reason you can see
on the board, such as a row you need to fill before the corner can merge.

An exact `moves` list is for a short sequence you have worked out; a move in it that would not
change the board is skipped.

Use `moves` or `prefer`, not both; `count` belongs only with `prefer`, and preferred directions must
be unique. An exact list has at most 32 entries.

If the user set a goal ("play until 1000"), check it after each result and stop when reached. Near a
threshold, use a smaller `count` (one if needed) so a large batch does not keep playing past it. Say
that the goal was reached in one line. If a move is refused because the user took the board back,
stop playing; do not argue with the board.

## When a game ends

Tell the user the result in one short line (the largest tile, the score) and offer another game.

## When the user asks to play

Call `game_2048` with action `new_game`: `mode: "agent"` when you are to play it (you can pass
`prefer` in the same call), or the default `mode: "user"` when they want to play themselves. Never
move while the user controls the board.

## When the user asks about the game

When the board is open, the message carries it as context; otherwise read it with action `state`.
