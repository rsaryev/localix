_Use: Play Battleship with the user on this chat's board: fire when the board wakes the chat, start
a game when the user asks to play, and talk about the game without guessing at the user's fleet. Use
for "let's play battleship" or "sea battle", a woken "your shot", or a question about the game._

# Play Battleship

Each chat has its own game, and this chat's is yours to play. You and the user each have a fleet of
ten ships — one of four cells, two of three, three of two, four of one — placed at random, straight,
never touching even at a corner. While the game is playing, the user's unsunk fleet is hidden from
your game tools and board context. Only shot results and sunk ships are visible, so do not claim to
know the remaining positions. After the game ends, the state reveals both fleets. The board keeps
the score at this table from game to game.

Everything goes through one tool, `battleship`, and its `action`: `fire`, `state`, `new_game`. Use
`actions` for up to 16 sequential steps, instead of a top-level `action`. Hits can continue within a
batch; it stops when a miss or new game hands the turn to the user, when the game ends, or when a
step is refused. Earlier completed actions remain applied. Read the completed count and refusal text
even when `isError` is absent; re-read the board before planning another batch. Single shots let you
adjust your aim after each result.

## When the decision model fires from your side

The user can choose, on the board, who fires from your side: you, or a decision model the board asks
itself. When the board says the decision model fires from your side, you do not fire — a shot is
refused — and the board never wakes you; a new game you open lets the user fire first. You can still
read the board and talk about the game. To play against you again, the user switches the opponent
back on the board.

## When the board wakes you

A message from the "battleship" mini app, not typed by the user, means it is your shot. It carries
what happened since your last shot, your picture of the user's board (`.` unknown, `o` water, `x`
hit, `#` sunk) and, when a ship is hit but afloat, the cells beside it worth aiming at.

Call `battleship` with action `fire` and one unknown `cell` ("E5"). A hit earns another shot: the
result says so, and you fire again straight away. A miss passes the turn and, when it answers the
board's wake, ends your turn — the board shows it, so no chat line is needed.

Aim well: after a hit, fire at the unknown cells straight beside it; after two hits in a line, keep
to that line. With no open hit, spread your shots in a checkerboard pattern — every ship of two or
more cells covers at least one square of each colour. Never fire at a cell next to a sunk ship: it
is water. If a shot is refused, the result shows your side as it is now; act on it.

## When a game ends

Tell the user the result in one line and offer another game. If the game showed you something about
how this user plays that you did not know, such as how they hunt, keep it in your memory, in one
note on Battleship that you update rather than add to. Save only observations the game actually
exposed; both fleets are randomly placed, so do not infer user placement preferences. Use memory
only when you have it and may write there. The board is session-owned and is removed when the chat
is deleted.

## When the user asks to play

Call `battleship` with action `new_game` — it places both fleets on this chat's board; give the user
the result's `App view` link. The user fires first unless they ask you to (`first: "agent"`); then
fire straight away. Before the first shot of a session, recall your Battleship note if you have one.

## When the user asks about the game

When the board is open, the message carries the shots and the score as context; otherwise read your
side with action `state`. Never fire for the user and never fire when it is not your turn: the board
wakes you when it is.
