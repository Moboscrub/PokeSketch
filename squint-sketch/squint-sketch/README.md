# Squint & Sketch

A Jackbox / Gartic Phone–style party game. Everyone in the lobby gets the **same blurred Pokémon card**, draws what they see, and guesses who it is.

**Scoring each round**
- **+1** if you name the Pokémon (small typos are forgiven, e.g. "Sycther")
- **+1** if your drawing gets the most votes (ties all score)

**Host settings:** generations I–IX (pick any mix, like Pokédle), rounds (3/5/8/10), drawing time, blur strength (Light → Brutal), and **Trace mode** (draw right on top of the blurry card; the voting gallery shows each drawing over that card).

Cards come from the free [Pokémon TCG API](https://pokemontcg.io). Names for autocomplete and answer checking come from [PokeAPI](https://pokeapi.co) and are cached in `species-cache.json` after the first run.

## Run it

You only need **Node.js 18 or newer**. There's nothing to install.

```bash
node server.js
```

Open http://localhost:3000, enter a name, and click **Create a room**. Share the 4-letter code or click **Copy invite link**.

- Friends on the **same Wi-Fi** can join at `http://<your-PC's-local-IP>:3000`. Run `ipconfig` on Windows to find your IP.
- Friends **elsewhere** need a public URL. Pick one:
  - **Quick tunnel (no account):** `npx localtunnel --port 3000`, or `cloudflared tunnel --url http://localhost:3000`, then share the URL it prints.
  - **Free hosting:** push this folder to GitHub and create a Render "Web Service" from it. Use build command *(none)* and start command `node server.js`. Render sets `PORT` for you. Free instances sleep when idle, so the first load can take about 30 seconds.

### Options (environment variables)

| Variable | What it does |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `POKEMONTCG_API_KEY` | Optional free key from pokemontcg.io. It raises the rate limit; without one you get about 1,000 requests a day, which is plenty for game nights. |
| `MOCK=1` | Uses fake placeholder cards so you can test offline |

## How a round works

1. **Draw** – Everyone sees the same blurred card. Draw it (brush, fill bucket, eraser, 3 sizes, colors, undo) and type a guess, with autocomplete limited to the chosen generations. Press **Lock it in**, or it auto-submits when time's up.
2. **Vote** – Drawings appear without names. Tap your favorite; you can't vote for your own.
3. **Reveal** – The real card flips in, with who guessed right, the vote counts, and points. The host clicks **Next round**.
4. **Final** – Podium, then **Play again** keeps the same lobby.

Other details:
- Refreshing the page or briefly losing connection puts you back in the game.
- The host can **Skip ▸** to end a phase early and can remove players in the lobby.
- If the host leaves, the host role passes to someone else.
- Rooms live in memory, so restarting the server ends all games.

## Files

- `server.js` – the whole backend: rooms, timers, card picking, scoring. It uses Server-Sent Events for live updates, so no packages are needed.
- `public/` – the game page (`index.html`, `app.js`, `style.css`).
