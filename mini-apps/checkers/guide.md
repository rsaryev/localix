_Use: Play checkers (Russian draughts) with the user on this chat's Checkers board: answer a move
when the board wakes the chat, start a game when the user asks to play, resign a lost game, and talk
about the position shown. Use for "let's play checkers", a woken "your move", or a question about
the game on the board._

# Play checkers

Each chat has its own board, and this chat's is yours to play: the user plays one colour, you play
the other. White moves first. The board's new-game action can swap colours; the tool defaults the
user to white unless `userPlays` is provided. The board, not the chat, is where the game happens —
the user sees every move there, so the chat only needs a short line. The board keeps the score at
this table from game to game.

The rules are Russian draughts: a capture is compulsory and a capture that can go on must go on; men
move forward but capture in every direction; kings move and capture any distance along a diagonal; a
man that reaches the far row mid-capture becomes a king and carries on capturing. The board enforces
all of it — you never need to work it out.

Everything goes through one tool, `checkers`, and its `action`: `move`, `state`, `new_game`,
`resign`. Use `action` or `actions`, not both. A batch accepts up to 16 sequential steps; for a new
game followed by your first move, set `userPlays: "black"` on the `new_game` step. It stops when a
mutation hands the turn to the user, the game ends, you resign, or a step is refused. Completed
steps remain applied; read the completion count and current board before continuing.

## When the decision model plays the other colour

The user can choose, on the board, who plays the other colour: you, or a decision model the board
asks itself. When the board says the decision model plays it, you do not move or resign — both are
refused — and the board never wakes you; a new game you open gives the user white to move first. You
can still read the board and talk about the position. To play against you again, the user switches
the opponent back on the board.

## When the board wakes you

A message from the "checkers" mini app, not typed by the user, means it is your move. It carries the
position, the list of legal moves and the score so far.

Call `checkers` with action `move` and one move from that list, written exactly as listed ("c3-d4",
or a capture "c3:e5:g3"), and nothing else: while the game goes on, the move ends your turn, because
the board shows it. When your move ends the game, the result asks for one short line — say it
without redrawing the board.

Play to win: prefer the capture that takes the most and loses the least, avoid stepping where your
piece can be taken for nothing, push men toward the far row to crown them, and keep the back row
covered early. If the move is refused, the result shows the board as it is now — the game may have
moved on (the user started a new game); act on that board, and do not argue with it.

## When the game is lost

If the position is hopeless — the user is far ahead and will soon win, and no realistic play saves
it — resign with action `resign` rather than play on to the last piece. Give one short `reason`. Do
not resign a game that is merely difficult: a draw or a comeback is still worth playing for.

## When a game ends

Tell the user the result in one line and offer another game. If the game showed you something about
how this user plays that you did not know — an opening they favour, a trade they avoid — keep it in
your memory, in one note on Checkers that you update rather than add to. Use memory only when you
have it and may write there. The board is session-owned and is removed with its chat.

## When the user asks to play

Call `checkers` with action `new_game` — it sets up this chat's board; give the user the result's
`App view` link. The user plays white (and moves first) unless they ask for black
(`userPlays: "black"`); then you play white, so move straight away. Before the first move of a
session, recall your Checkers note if you have one.

## When the user asks about the game

When the board is open, the message carries it as context; otherwise read it with action `state`.
Never move for the user and never move when it is not your turn: the board wakes you when it is.
