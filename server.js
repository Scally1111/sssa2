const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const rooms = new Map();
const clients = new Map();
const TICK_MS = 50;
const ARENA = { width: 1800, height: 1100 };
const SPEED = 250;
const PLAYER_RADIUS = 17;
const BULLET_SPEED = 650;
const MAX_PLAYERS = 12;

function makeId(n = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < n; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}
function publicPlayer(p) {
  return { id: p.id, name: p.name, x: p.x, y: p.y, angle: p.angle,
    hp: p.hp, color: p.color, kills: p.kills, deaths: p.deaths };
}
function getRoom(roomId) { return rooms.get(roomId); }
function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(room, obj) {
  const payload = JSON.stringify(obj);
  for (const p of room.players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(payload);
  }
}
function roomInfo(room) {
  return { roomId: room.id, players: [...room.players.values()].map(publicPlayer),
    bullets: room.bullets.map(b => ({ id: b.id, x: b.x, y: b.y, angle: b.angle, owner: b.owner })),
    arena: ARENA };
}
function spawnPoint() {
  return { x: 100 + Math.random() * (ARENA.width - 200),
           y: 100 + Math.random() * (ARENA.height - 200) };
}
function leaveRoom(ws) {
  const state = clients.get(ws);
  if (!state) return;
  const room = getRoom(state.roomId);
  if (room) {
    room.players.delete(state.playerId);
    broadcast(room, { type: "left", playerId: state.playerId });
    if (room.players.size === 0) rooms.delete(room.id);
  }
  clients.delete(ws);
}
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (pathname === "/") pathname = "/index.html";
  const safePath = path.normalize(path.join(ROOT, pathname));
  if (!safePath.startsWith(ROOT + path.sep) && safePath !== path.join(ROOT, "index.html")) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(safePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(safePath);
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff" });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: "error", message: "Некорректный запрос" }); }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "create" || msg.type === "join") {
      if (clients.has(ws)) return;
      let room;
      if (msg.type === "create") {
        let id;
        do { id = makeId(); } while (rooms.has(id));
        room = { id, players: new Map(), bullets: [], nextBullet: 1, createdAt: Date.now() };
        rooms.set(id, room);
      } else {
        const id = String(msg.roomId || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
        room = getRoom(id);
        if (!room) return send(ws, { type: "error", message: "Комната не найдена. Проверь ссылку." });
      }
      if (room.players.size >= MAX_PLAYERS) return send(ws, { type: "error", message: "Комната заполнена (максимум 12 игроков)." });
      const id = crypto.randomUUID();
      const spawn = spawnPoint();
      const palette = ["#68e1fd", "#ff6b8a", "#a78bfa", "#ffd166", "#72ef9f", "#ff9f43"];
      const player = { id, ws, name: String(msg.name || "Игрок").trim().slice(0, 18) || "Игрок",
        ...spawn, angle: 0, hp: 100, color: palette[room.players.size % palette.length],
        kills: 0, deaths: 0, input: { up:false, down:false, left:false, right:false },
        lastShot: 0, respawnAt: 0 };
      room.players.set(id, player);
      clients.set(ws, { roomId: room.id, playerId: id });
      send(ws, { type: "joined", selfId: id, roomId: room.id, shareUrl: `${getBaseUrl(reqFromWs(ws))}/?room=${room.id}`, state: roomInfo(room) });
      broadcast(room, { type: "joinedPlayer", player: publicPlayer(player) });
      return;
    }
    const state = clients.get(ws);
    if (!state) return send(ws, { type: "error", message: "Сначала войдите в комнату." });
    const room = getRoom(state.roomId);
    const player = room && room.players.get(state.playerId);
    if (!player) return;
    if (msg.type === "input") {
      const i = msg.input || {};
      player.input = { up:!!i.up, down:!!i.down, left:!!i.left, right:!!i.right };
      if (Number.isFinite(msg.angle)) player.angle = msg.angle;
      if (msg.shoot && Date.now() - player.lastShot > 220 && player.hp > 0) {
        player.lastShot = Date.now();
        room.bullets.push({ id: room.nextBullet++, owner: player.id,
          x: player.x + Math.cos(player.angle) * 24, y: player.y + Math.sin(player.angle) * 24,
          angle: player.angle, born: Date.now() });
      }
    } else if (msg.type === "ping") send(ws, { type: "pong", t: msg.t });
  });
  ws.on("close", () => leaveRoom(ws));
  ws.on("error", () => leaveRoom(ws));
});

// Resolve movement, bullets, and hits on the server; clients only send input.
setInterval(() => {
  const dt = TICK_MS / 1000;
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of room.players.values()) {
      if (p.hp <= 0) {
        if (now >= p.respawnAt) {
          Object.assign(p, spawnPoint(), { hp: 100 });
          broadcast(room, { type: "respawn", player: publicPlayer(p) });
        }
        continue;
      }
      let dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
      let dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      p.x = Math.max(PLAYER_RADIUS, Math.min(ARENA.width - PLAYER_RADIUS, p.x + dx / len * SPEED * dt));
      p.y = Math.max(PLAYER_RADIUS, Math.min(ARENA.height - PLAYER_RADIUS, p.y + dy / len * SPEED * dt));
    }
    const survivors = [];
    for (const b of room.bullets) {
      b.x += Math.cos(b.angle) * BULLET_SPEED * dt;
      b.y += Math.sin(b.angle) * BULLET_SPEED * dt;
      let hit = false;
      if (now - b.born < 1600 && b.x >= 0 && b.y >= 0 && b.x <= ARENA.width && b.y <= ARENA.height) {
        for (const target of room.players.values()) {
          if (target.id === b.owner || target.hp <= 0) continue;
          if (Math.hypot(target.x - b.x, target.y - b.y) < PLAYER_RADIUS + 5) {
            target.hp = Math.max(0, target.hp - 34);
            hit = true;
            if (target.hp === 0) {
              target.deaths++;
              const killer = room.players.get(b.owner);
              if (killer) killer.kills++;
              target.respawnAt = now + 1800;
            }
            broadcast(room, { type: "hit", targetId: target.id, hp: target.hp,
              killerId: target.hp === 0 ? b.owner : null });
            break;
          }
        }
      }
      if (!hit && now - b.born < 1600 && b.x >= 0 && b.y >= 0 && b.x <= ARENA.width && b.y <= ARENA.height) survivors.push(b);
    }
    room.bullets = survivors;
    broadcast(room, { type: "state", players: [...room.players.values()].map(publicPlayer),
      bullets: room.bullets.map(b => ({ id:b.id, x:b.x, y:b.y, angle:b.angle, owner:b.owner })) });
  }
}, TICK_MS);

function reqFromWs(ws) {
  // The share URL is also constructed client-side from the current browser origin.
  return { headers: { host: `localhost:${PORT}` } };
}
function getBaseUrl(req) {
  const proto = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).protocol.replace(":", "") : "http";
  const host = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).host : req.headers.host;
  return `${proto}://${host}`;
}
server.listen(PORT, "0.0.0.0", () => console.log(`Serega is running at http://localhost:${PORT}`));
