# Snake

Open **Snake** from a chat's workbench rail. Each chat has its own board on a 16×16 grid. Choose **I
play** to steer with the arrow keys or a swipe; the snake starts with your first key. Food grows the
snake and adds a point; a wall or the snake's own body ends the game. The best score stays with the
chat, and **New game** starts again.

## Watch a decision model play

Choose **Model plays** to hand the board to a decision model (Jev through OpenRouter). The board
asks it for one move at a time, without writing in the chat, and shows each move as it lands. Its
spend is recorded under **Decisions** for the conversation. **Stop** pauses it before the next move,
and **Continue** goes on from the same board. Without a connected OpenRouter account, the board says
so; there is no other player to fall back on.

The chat's agent does not steer the snake. It can read the board and start a game for you.
