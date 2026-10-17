const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".ico":"image/x-icon" };
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  if (pathname === "/") pathname = "/index.html";
  const safe = path.normalize(path.join(ROOT, pathname));
  if (!safe.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(safe, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(safe)] || "application/octet-stream", "Cache-Control":"no-cache" });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
const rooms = new Map();
const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
function cleanName(v) { return String(v || "Player").replace(/[<>]/g, "").trim().slice(0, 18) || "Player"; }
function roomCode() { return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function send(ws, obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function players(room) { return [...room.players.values()].map(p => ({ id:p.id, name:p.name, team:p.team, x:p.x, y:p.y, z:p.z, yaw:p.yaw, pitch:p.pitch, hp:p.hp, score:p.score, avatar:p.avatar, bot:!!p.bot })); }
function broadcast(room, obj) { const packet = JSON.stringify(obj); for (const p of room.players.values()) if (!p.bot && p.ws?.readyState === WebSocket.OPEN) p.ws.send(packet); }
function publicRoom(room) { return { type:"state", room:room.code, players:players(room), started:room.started }; }
function chooseTeam(room) {
  const t = { T:0, CT:0 }; for (const p of room.players.values()) if (!p.bot) t[p.team] = (t[p.team] || 0) + 1;
  return t.T <= t.CT ? "T" : "CT";
}
function spawn(p) { p.x = p.team === "T" ? -8 + Math.random()*3 : 8 - Math.random()*3; p.y = 1.6; p.z = Math.random()*10-5; p.hp=100; p.pitch=0; }
function join(ws, msg) {
  let code = String(msg.room || "").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8);
  if (!code) { code = roomCode(); while (rooms.has(code)) code = roomCode(); }
  let room = rooms.get(code);
  if (!room) { room = { code, players:new Map(), started:true, created:Date.now() }; rooms.set(code, room); }
  if ([...room.players.values()].filter(p=>!p.bot).length >= 16) return send(ws,{type:"error",message:"Комната заполнена (максимум 16 игроков)."});
  const id = crypto.randomUUID();
  const p = { id, ws, name:cleanName(msg.name), team:msg.team==="T"||msg.team==="CT"?msg.team:chooseTeam(room), x:0,y:1.6,z:0,yaw:0,pitch:0,hp:100,score:0,avatar:typeof msg.avatar==="string"&&msg.avatar.length<180000?msg.avatar:"",lastDash:0,lastShot:0,bot:false };
  spawn(p); room.players.set(id,p); ws.playerId=id; ws.roomCode=code;
  send(ws,{type:"joined",id,room:code,players:players(room)});
  broadcast(room, publicRoom(room));
}
function remove(ws) {
  const room=rooms.get(ws.roomCode); if (!room) return;
  room.players.delete(ws.playerId);
  if (![...room.players.values()].some(p=>!p.bot)) rooms.delete(room.code);
  else broadcast(room, publicRoom(room));
}
function tickBots(room) {
  const now=Date.now();
  for (const b of room.players.values()) {
    if (!b.bot) continue;
    const target=[...room.players.values()].filter(p=>!p.bot&&p.team!==b.team).sort((a,c)=>Math.hypot(a.x-b.x,a.z-b.z)-Math.hypot(a.x-c.x,a.z-c.z))[0];
    if (target) {
      const dx=target.x-b.x, dz=target.z-b.z, d=Math.hypot(dx,dz)||1;
      if (d>7) { b.x+=dx/d*0.055; b.z+=dz/d*0.055; }
      b.yaw=Math.atan2(-dx,-dz);
      if (d<18 && now-b.lastShot>650) { b.lastShot=now; target.hp-=12; if(target.hp<=0){target.score++;spawn(target);broadcast(room,{type:"feed",text:`${b.name} выбил ${target.name}`});} }
    }
  }
}
wss.on("connection", ws => {
  ws.on("message", raw => {
    let m; try { m=JSON.parse(raw.toString()); } catch { return; }
    if (m.type==="join") return join(ws,m);
    const room=rooms.get(ws.roomCode), p=room?.players.get(ws.playerId); if(!room||!p) return;
    if (m.type==="move") {
      const now=Date.now();
      p.x=clamp(m.x,-29,29); p.y=clamp(m.y,0.7,8); p.z=clamp(m.z,-29,29);
      p.yaw=clamp(m.yaw,-1000,1000); p.pitch=clamp(m.pitch,-1.5,1.5);
      if (m.dash && now-p.lastDash>1100) p.lastDash=now;
      p.avatar=typeof m.avatar==="string"&&m.avatar.length<180000?m.avatar:p.avatar;
    } else if (m.type==="team" && (m.team==="T"||m.team==="CT")) {
      p.team=m.team; spawn(p); broadcast(room,publicRoom(room));
    } else if (m.type==="name") { p.name=cleanName(m.name); broadcast(room,publicRoom(room)); }
    else if (m.type==="avatar" && typeof m.avatar==="string" && m.avatar.length<180000) { p.avatar=m.avatar; broadcast(room,publicRoom(room)); }
    else if (m.type==="bot") {
      const bots=[...room.players.values()].filter(x=>x.bot).length;
      if (bots>=8) return send(ws,{type:"error",message:"В комнате максимум 8 ботов."});
      const bot={id:"bot-"+crypto.randomUUID(),name:cleanName(m.name||`BOT-${bots+1}`),team:m.team==="T"||m.team==="CT"?m.team:(p.team==="T"?"CT":"T"),x:0,y:1.6,z:0,yaw:0,pitch:0,hp:100,score:0,avatar:"",lastShot:0,bot:true};
      spawn(bot); room.players.set(bot.id,bot); broadcast(room,publicRoom(room));
    } else if (m.type==="shoot") {
      const now=Date.now(); if(now-p.lastShot<170) return; p.lastShot=now;
      // Server-side hit validation: ray approximation from shooter view against enemy player positions.
      const dx=-Math.sin(p.yaw), dz=-Math.cos(p.yaw), maxDist=38;
      let best=null, bestAlong=maxDist;
      for(const q of room.players.values()) {
        if(q.id===p.id||q.team===p.team||q.hp<=0) continue;
        const vx=q.x-p.x, vz=q.z-p.z, along=vx*dx+vz*dz;
        if(along<=0||along>bestAlong) continue;
        const side=Math.abs(vx*dz-vz*dx);
        if(side < 0.9 && Math.abs(q.y-p.y)<2.3) {best=q;bestAlong=along;}
      }
      if(best) {
        best.hp-=34;
        if(best.hp<=0) { p.score++; spawn(best); broadcast(room,{type:"feed",text:`${p.name} выбил ${best.name}`}); }
        broadcast(room,{type:"hit",id:best.id,hp:best.hp,by:p.id});
      }
    } else if (m.type==="respawn") spawn(p);
  });
  ws.on("close",()=>remove(ws));
  ws.on("error",()=>remove(ws));
});
setInterval(()=>{ for(const room of rooms.values()){tickBots(room); broadcast(room,publicRoom(room));} },50);
server.listen(PORT,"0.0.0.0",()=>console.log(`Serega V3 listening on ${PORT}`));
