# Serega V3

A deployable browser-based 3D online team FPS prototype built with Three.js, Node.js and WebSockets.

## Included
- Create a room or join by room code; invite URL is copied from the in-game button.
- Terrorists (T) vs Counter-Terrorists (CT), balanced auto-team assignment, live roster.
- TAB scoreboard, bots (up to 8 per room), custom avatar upload, nickname changes.
- Mouse look, configurable WASD keys, mouse sensitivity, sound volume/toggle, quality settings, fullscreen.
- Shift dash with cooldown, server-validated approximate hits, respawns, simple 3D arena.
- Render deployment blueprint.

## Run locally
Requires Node.js 20+.

```bash
npm install
npm start
```

Open http://localhost:3000 in a desktop browser. For multiplayer testing, open the same address in two browser windows.

## Deploy to Render
1. Push the contents of this folder to a Git repository.
2. In Render, choose **New + → Blueprint** and select that repository, or create a Node Web Service.
3. The included `render.yaml` defines the service. Render will install dependencies and run `npm start`.
4. Open the service's HTTPS URL. The client automatically uses secure WebSockets (`wss://`) on HTTPS.
5. Create a room and share the invitation link.

## Important production notes
This is a playable starter/prototype, not a promise of lag-free operation for every player. Real latency depends on players' geography, device performance, Wi-Fi, and the hosting plan. The server runs a 20 Hz room update loop and uses WebSockets, but it is a single-process in-memory service:
- Room state is lost when the server restarts or sleeps.
- A single Render instance hosts all active rooms; horizontal scaling needs a shared pub/sub/state layer (for example Redis) and sticky routing or a dedicated realtime architecture.
- Hit detection is deliberately simple; competitive production FPS needs server-side movement simulation, collision/raycasting, rate limits, abuse prevention, persistence, monitoring, and load tests.
- Uploaded avatars are kept as small data URLs in room memory and browser local storage; no account system or permanent avatar storage is included.
- This prototype uses Three.js from the installed package and has no external game assets.

## Controls
- Mouse: look
- Left mouse: shoot
- Configurable forward/back/left/right keys
- Configurable dash key (default Shift)
- TAB: scoreboard (hold)
- ESC: pause/settings behavior
