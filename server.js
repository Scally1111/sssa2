'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const rooms = new Map();
const clients = new Map();
const TICK_MS = 33; // ~30 server updates/sec, less network/render pressure
const ARENA = { width: 1800, height: 1100 };
const SPEED = 250;
const PLAYER_RADIUS = 17;
const MAX_PLAYERS = 12;
const WEAPONS = {
  pistol:  { label: 'Пистолет', cooldown: 260, damage: 34, speed: 650, count: 1, spread: 0, life: 1400, radius: 4 },
  rifle:   { label: 'Автомат', cooldown: 105, damage: 17, speed: 780, count: 1, spread: 0.035, life: 1300, radius: 3 },
  shotgun: { label: 'Дробовик', cooldown: 650, damage: 12, speed: 560, count: 5, spread: 0.28, life: 650, radius: 4 }
};
const PALETTE = ['#68e1fd','#ff6b8a','#a78bfa','#ffd166','#72ef9f','#ff9f43'];
function makeId(n = 6) { const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let out=''; for(let i=0;i<n;i++)out+=chars[crypto.randomInt(chars.length)]; return out; }
function publicPlayer(p, withAvatar = true) {
  const data = { id:p.id, name:p.name, x:p.x, y:p.y, angle:p.angle, hp:p.hp, color:p.color, kills:p.kills, deaths:p.deaths, weapon:p.weapon };
  if (withAvatar && p.avatar) data.avatar = p.avatar;
  return data;
}
function send(ws, obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj) { const payload=JSON.stringify(obj); for(const p of room.players.values()) if(p.ws.readyState===WebSocket.OPEN) p.ws.send(payload); }
function roomInfo(room) { return { roomId:room.id, players:[...room.players.values()].map(p=>publicPlayer(p,true)), bullets:room.bullets.map(b=>({id:b.id,x:b.x,y:b.y,angle:b.angle,owner:b.owner,weapon:b.weapon})), arena:ARENA }; }
function spawnPoint() { return { x:100+Math.random()*(ARENA.width-200), y:100+Math.random()*(ARENA.height-200) }; }
function leaveRoom(ws) { const state=clients.get(ws); if(!state)return; const room=rooms.get(state.roomId); if(room){room.players.delete(state.playerId);broadcast(room,{type:'left',playerId:state.playerId});if(room.players.size===0)rooms.delete(room.id);} clients.delete(ws); }
function validAvatar(value) {
  if (typeof value !== 'string' || value.length > 15000) return '';
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
}
const server=http.createServer((req,res)=>{
  let pathname; try { pathname=decodeURIComponent(new URL(req.url,`http://${req.headers.host}`).pathname); } catch { res.writeHead(400);return res.end('Bad request'); }
  if(pathname==='/')pathname='/index.html';
  const safePath=path.resolve(ROOT,'.'+pathname);
  if(!safePath.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(safePath,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}
    const ext=path.extname(safePath);const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':ext==='.html'?'no-cache':'public, max-age=300','X-Content-Type-Options':'nosniff'});res.end(data);
  });
});
const wss=new WebSocketServer({server,maxPayload:24*1024,perMessageDeflate:false});
wss.on('connection',ws=>{
  ws.on('message',raw=>{
    let msg;try{msg=JSON.parse(raw.toString());}catch{return send(ws,{type:'error',message:'Некорректный запрос'});}
    if(!msg||typeof msg.type!=='string')return;
    if(msg.type==='create'||msg.type==='join'){
      if(clients.has(ws))return;
      let room;
      if(msg.type==='create'){let id;do{id=makeId();}while(rooms.has(id));room={id,players:new Map(),bullets:[],nextBullet:1};rooms.set(id,room);}
      else {const id=String(msg.roomId||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);room=rooms.get(id);if(!room)return send(ws,{type:'error',message:'Комната не найдена. Проверь ссылку.'});}
      if(room.players.size>=MAX_PLAYERS){if(room.players.size===0)rooms.delete(room.id);return send(ws,{type:'error',message:'Комната заполнена (максимум 12 игроков).'});}
      const id=crypto.randomUUID(),spawn=spawnPoint();
      const player={id,ws,name:String(msg.name||'Игрок').trim().slice(0,18)||'Игрок',avatar:validAvatar(msg.avatar),...spawn,angle:0,hp:100,color:PALETTE[room.players.size%PALETTE.length],kills:0,deaths:0,weapon:WEAPONS[msg.weapon]?msg.weapon:'pistol',input:{up:false,down:false,left:false,right:false},lastShot:0,respawnAt:0};
      room.players.set(id,player);clients.set(ws,{roomId:room.id,playerId:id});
      send(ws,{type:'joined',selfId:id,roomId:room.id,state:roomInfo(room)});
      broadcast(room,{type:'joinedPlayer',player:publicPlayer(player,true)});return;
    }
    const state=clients.get(ws);if(!state)return send(ws,{type:'error',message:'Сначала войдите в комнату.'});
    const room=rooms.get(state.roomId),player=room&&room.players.get(state.playerId);if(!player)return;
    if(msg.type==='input'){
      const i=msg.input||{};player.input={up:!!i.up,down:!!i.down,left:!!i.left,right:!!i.right};
      if(Number.isFinite(msg.angle))player.angle=msg.angle;
      if(WEAPONS[msg.weapon])player.weapon=msg.weapon;
      const weapon=WEAPONS[player.weapon],now=Date.now();
      if(msg.shoot&&now-player.lastShot>=weapon.cooldown&&player.hp>0){player.lastShot=now;
        for(let n=0;n<weapon.count;n++){
          const angle=player.angle+(weapon.count===1?0:(Math.random()-.5)*weapon.spread*2);
          room.bullets.push({id:room.nextBullet++,owner:player.id,x:player.x+Math.cos(angle)*24,y:player.y+Math.sin(angle)*24,angle,weapon:player.weapon,damage:weapon.damage,speed:weapon.speed,life:weapon.life,radius:weapon.radius,born:now});
        }
      }
    } else if(msg.type==='weapon') { if(WEAPONS[msg.weapon]){player.weapon=msg.weapon;send(ws,{type:'weaponChanged',weapon:player.weapon});} }
  });
  ws.on('close',()=>leaveRoom(ws));ws.on('error',()=>leaveRoom(ws));
});
let lastTick=Date.now();
setInterval(()=>{
  const now=Date.now(),dt=Math.min((now-lastTick)/1000,.08);lastTick=now;
  for(const room of rooms.values()){
    for(const p of room.players.values()){
      if(p.hp<=0){if(now>=p.respawnAt){Object.assign(p,spawnPoint(),{hp:100});broadcast(room,{type:'respawn',player:publicPlayer(p,true)});}continue;}
      let dx=(p.input.right?1:0)-(p.input.left?1:0),dy=(p.input.down?1:0)-(p.input.up?1:0);const len=Math.hypot(dx,dy)||1;
      p.x=Math.max(PLAYER_RADIUS,Math.min(ARENA.width-PLAYER_RADIUS,p.x+dx/len*SPEED*dt));p.y=Math.max(PLAYER_RADIUS,Math.min(ARENA.height-PLAYER_RADIUS,p.y+dy/len*SPEED*dt));
    }
    const survivors=[];
    for(const b of room.bullets){const weapon=WEAPONS[b.weapon]||WEAPONS.pistol;b.x+=Math.cos(b.angle)*b.speed*dt;b.y+=Math.sin(b.angle)*b.speed*dt;let hit=false;
      if(now-b.born<b.life&&b.x>=0&&b.y>=0&&b.x<=ARENA.width&&b.y<=ARENA.height){
        for(const target of room.players.values()){
          if(target.id===b.owner||target.hp<=0)continue;
          if(Math.hypot(target.x-b.x,target.y-b.y)<PLAYER_RADIUS+b.radius){target.hp=Math.max(0,target.hp-b.damage);hit=true;
            if(target.hp===0){target.deaths++;const killer=room.players.get(b.owner);if(killer)killer.kills++;target.respawnAt=now+1800;}
            broadcast(room,{type:'hit',targetId:target.id,hp:target.hp,killerId:target.hp===0?b.owner:null});break;
          }
        }
      }
      if(!hit&&now-b.born<b.life&&b.x>=0&&b.y>=0&&b.x<=ARENA.width&&b.y<=ARENA.height)survivors.push(b);
    }
    room.bullets=survivors;
    // Avatar data is sent only on join/respawn; frequent snapshots stay small.
    broadcast(room,{type:'state',players:[...room.players.values()].map(p=>publicPlayer(p,false)),bullets:room.bullets.map(b=>({id:b.id,x:b.x,y:b.y,angle:b.angle,owner:b.owner,weapon:b.weapon}))});
  }
},TICK_MS);
server.listen(PORT,'0.0.0.0',()=>console.log(`Serega is running on port ${PORT}`));
