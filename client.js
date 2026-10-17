(() => {
  const $ = id => document.getElementById(id);
  const lobby = $("lobby"), game = $("game"), canvas = $("arena"), ctx = canvas.getContext("2d");
  const nickname = $("nickname"), roomCode = $("roomCode"), errorBox = $("lobbyError");
  let socket = null, selfId = null, roomId = null, players = new Map(), bullets = [];
  let arena = {width:1800,height:1100}, keys = {}, mouse = {x:600,y:380,down:false};
  let camera = {x:0,y:0}, lastToast = 0, toastTimer = null, joined = false;
  const urlParams = new URLSearchParams(location.search);
  if (urlParams.get("room")) roomCode.value = urlParams.get("room").toUpperCase();
  nickname.value = localStorage.getItem("serega_name") || "";

  function wsUrl() {
    return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  }
  function connect(kind, id) {
    errorBox.textContent = "";
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    socket = new WebSocket(wsUrl());
    socket.addEventListener("open", () => socket.send(JSON.stringify({
      type: kind, roomId: id, name: nickname.value.trim() || "Игрок"
    })));
    socket.addEventListener("message", event => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === "error") {
        if (!joined) errorBox.textContent = msg.message;
        else toast(msg.message);
        return;
      }
      if (msg.type === "joined") {
        joined = true; selfId = msg.selfId; roomId = msg.roomId; arena = msg.state.arena;
        players = new Map(msg.state.players.map(p => [p.id, p])); bullets = msg.state.bullets || [];
        lobby.classList.add("hidden"); game.classList.remove("hidden");
        $("roomLabel").textContent = `КОМНАТА ${roomId}`;
        history.replaceState({}, "", `/?room=${roomId}`);
        localStorage.setItem("serega_name", nickname.value.trim());
        toast("Комната готова. Отправь ссылку другу!");
        renderLeaderboard(); draw();
      } else if (msg.type === "state") {
        players = new Map(msg.players.map(p => [p.id, p])); bullets = msg.bullets;
        const me = players.get(selfId);
        if (me) { $("hpBar").style.width = `${me.hp}%`; $("hpText").textContent = me.hp; }
        renderLeaderboard();
      } else if (msg.type === "joinedPlayer") {
        players.set(msg.player.id, msg.player); renderLeaderboard();
        if (msg.player.id !== selfId) toast(`${msg.player.name} подключился`);
      } else if (msg.type === "left") {
        players.delete(msg.playerId); renderLeaderboard();
      } else if (msg.type === "hit") {
        const p = players.get(msg.targetId); if (p) p.hp = msg.hp;
        if (msg.targetId === selfId) toast(msg.hp === 0 ? "Ты выбыл! Возвращение через секунду…" : `Попадание! Осталось ${msg.hp} HP`);
        if (msg.killerId === selfId) toast("Противник устранён!");
      } else if (msg.type === "respawn") {
        players.set(msg.player.id, msg.player);
        if (msg.player.id === selfId) toast("Ты снова в бою!");
      }
    });
    socket.addEventListener("close", () => {
      if (joined) { toast("Соединение потеряно. Обнови страницу, чтобы подключиться снова."); joined = false; }
    });
    socket.addEventListener("error", () => {
      if (!joined) errorBox.textContent = "Не удалось подключиться к серверу.";
    });
  }
  $("createBtn").addEventListener("click", () => connect("create"));
  $("joinBtn").addEventListener("click", () => {
    const id = roomCode.value.trim().toUpperCase();
    if (!id) { errorBox.textContent = "Введи код комнаты."; return; }
    connect("join", id);
  });
  roomCode.addEventListener("keydown", e => { if (e.key === "Enter") $("joinBtn").click(); });
  nickname.addEventListener("keydown", e => { if (e.key === "Enter") $("createBtn").click(); });
  $("copyBtn").addEventListener("click", async () => {
    const link = `${location.origin}/?room=${roomId}`;
    try { await navigator.clipboard.writeText(link); toast("Ссылка скопирована! Отправь её другу."); }
    catch { prompt("Скопируй ссылку на комнату:", link); }
  });
  $("leaveBtn").addEventListener("click", () => {
    if (socket) socket.close();
    joined = false; selfId = null; roomId = null; players.clear(); bullets = [];
    game.classList.add("hidden"); lobby.classList.remove("hidden");
    history.replaceState({}, "", "/");
  });

  function toast(text) {
    const el = $("toast"); el.textContent = text; el.classList.remove("hidden");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
  }
  function renderLeaderboard() {
    const list = $("playersList"); list.innerHTML = "";
    const sorted = [...players.values()].sort((a,b) => b.kills-a.kills);
    $("playerCount").textContent = `${sorted.length}/12`;
    for (const p of sorted) {
      const row = document.createElement("div"); row.className = "player-row";
      const dot = document.createElement("span"); dot.className = "player-color"; dot.style.color = p.color; dot.style.background = p.color;
      const name = document.createElement("span"); name.className = "player-name"; name.textContent = p.name + (p.id === selfId ? " (ты)" : "");
      const score = document.createElement("span"); score.className = "player-score"; score.textContent = `${p.kills} ☠`;
      row.append(dot, name, score); list.append(row);
    }
  }
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(rect.width*dpr), h = Math.round(rect.height*dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function draw() {
    requestAnimationFrame(draw);
    if (game.classList.contains("hidden")) return;
    resizeCanvas();
    const w = canvas.width, h = canvas.height;
    ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,w,h);
    const me = players.get(selfId);
    if (me) { camera.x = me.x - w/2; camera.y = me.y - h/2; }
    camera.x = Math.max(0, Math.min(arena.width - w, camera.x));
    camera.y = Math.max(0, Math.min(arena.height - h, camera.y));
    ctx.save(); ctx.translate(-camera.x, -camera.y);
    ctx.fillStyle = "#0b1322"; ctx.fillRect(0,0,arena.width,arena.height);
    ctx.strokeStyle = "#1c2a40"; ctx.lineWidth = 1;
    for(let x=0;x<=arena.width;x+=50){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,arena.height);ctx.stroke();}
    for(let y=0;y<=arena.height;y+=50){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(arena.width,y);ctx.stroke();}
    // Decorative arena blocks
    ctx.fillStyle = "#111d30"; ctx.strokeStyle = "#283d5a"; ctx.lineWidth = 3;
    for (const [x,y,bw,bh] of [[260,220,110,110],[650,130,190,55],[1050,300,80,180],[420,650,200,65],[1350,720,150,100],[900,880,110,90],[150,850,170,60]]) {
      ctx.beginPath(); ctx.roundRect(x,y,bw,bh,10); ctx.fill(); ctx.stroke();
      ctx.fillStyle="#1d2d46"; ctx.fillRect(x+10,y+10,bw-20,4); ctx.fillStyle="#111d30";
    }
    // arena border
    ctx.strokeStyle = "#5c6b91"; ctx.lineWidth = 5; ctx.strokeRect(0,0,arena.width,arena.height);
    for (const b of bullets) {
      ctx.save(); ctx.translate(b.x,b.y); ctx.rotate(b.angle);
      ctx.shadowColor="#8beaff";ctx.shadowBlur=12;ctx.fillStyle="#c8f7ff";
      ctx.beginPath();ctx.roundRect(-8,-2,16,4,2);ctx.fill();ctx.restore();
    }
    for (const p of players.values()) {
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);
      ctx.globalAlpha = p.hp <= 0 ? .25 : 1;
      ctx.shadowColor=p.color;ctx.shadowBlur=p.id===selfId?18:8;
      ctx.fillStyle=p.color;ctx.beginPath();ctx.roundRect(-2,-6,31,12,5);ctx.fill();
      ctx.shadowBlur=0;ctx.fillStyle="#e8f4ff";ctx.beginPath();ctx.arc(0,0,13,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(0,0,9,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#0b1020";ctx.beginPath();ctx.arc(3,-3,2,0,Math.PI*2);ctx.fill();
      ctx.restore();
      ctx.globalAlpha=1;
      ctx.font="bold 12px system-ui";ctx.textAlign="center";ctx.fillStyle="#e9efff";ctx.fillText(p.name,p.x,p.y-28);
      ctx.fillStyle="#293449";ctx.fillRect(p.x-18,p.y-21,36,4);
      ctx.fillStyle=p.hp>50?"#62edb0":p.hp>25?"#ffd166":"#ff547c";ctx.fillRect(p.x-18,p.y-21,36*Math.max(0,p.hp)/100,4);
    }
    ctx.restore();
    // crosshair stays in screen coordinates
    ctx.strokeStyle="#d7f5ff";ctx.lineWidth=1.5;ctx.globalAlpha=.85;
    ctx.beginPath();ctx.arc(mouse.x,mouse.y,7,0,Math.PI*2);ctx.moveTo(mouse.x-12,mouse.y);ctx.lineTo(mouse.x-4,mouse.y);ctx.moveTo(mouse.x+4,mouse.y);ctx.lineTo(mouse.x+12,mouse.y);ctx.moveTo(mouse.x,mouse.y-12);ctx.lineTo(mouse.x,mouse.y-4);ctx.moveTo(mouse.x,mouse.y+4);ctx.lineTo(mouse.x,mouse.y+12);ctx.stroke();ctx.globalAlpha=1;
    // send inputs at a controlled rate
    const now = performance.now();
    if (socket && socket.readyState===WebSocket.OPEN && now-(draw.lastSend||0)>45 && me) {
      draw.lastSend=now;
      const rect=canvas.getBoundingClientRect(), sx=canvas.width/rect.width, sy=canvas.height/rect.height;
      const worldMouseX=camera.x+mouse.x*sx, worldMouseY=camera.y+mouse.y*sy;
      socket.send(JSON.stringify({type:"input",input:{up:!!(keys.w||keys.arrowup),down:!!(keys.s||keys.arrowdown),left:!!(keys.a||keys.arrowleft),right:!!(keys.d||keys.arrowright)},angle:Math.atan2(worldMouseY-me.y,worldMouseX-me.x),shoot:mouse.down}));
    }
  }
  window.addEventListener("keydown", e => { const k=e.key.toLowerCase(); if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"," "].includes(k)) e.preventDefault(); keys[k]=true; });
  window.addEventListener("keyup", e => { keys[e.key.toLowerCase()]=false; });
  window.addEventListener("blur", () => { keys={}; mouse.down=false; });
  canvas.addEventListener("mousemove", e => { const r=canvas.getBoundingClientRect(); mouse.x=(e.clientX-r.left)*canvas.width/r.width; mouse.y=(e.clientY-r.top)*canvas.height/r.height; });
  canvas.addEventListener("mousedown", e => { if(e.button===0) mouse.down=true; });
  window.addEventListener("mouseup", e => { if(e.button===0) mouse.down=false; });
  canvas.addEventListener("contextmenu", e => e.preventDefault());
})();