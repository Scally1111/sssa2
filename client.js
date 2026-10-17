import * as THREE from "/node_modules/three/build/three.module.js";

const $=id=>document.getElementById(id);
const defaults={volume:45,sens:8,keyForward:"W",keyBack:"S",keyLeft:"A",keyRight:"D",keyDash:"SHIFT",quality:"high",sound:"on"};
let settings={...defaults}; try{settings={...settings,...JSON.parse(localStorage.getItem("sv3-settings")||"{}")}}catch{}
let avatar=localStorage.getItem("sv3-avatar")||"", nickname=localStorage.getItem("sv3-name")||"Player";
$("nickname").value=nickname;
function avatarPreview(){ $("avatarpreview").innerHTML=avatar?`<img src="${avatar}" alt="avatar">`:"SV"; }
avatarPreview();
function applySettingsUI(){for(const k of Object.keys(defaults)){const el=$(k);if(el)el.value=settings[k]} $("volumeval").value=settings.volume+"%";$("sensval").value=(settings.sens/10).toFixed(1);}
applySettingsUI();
function saveSettings(){for(const k of Object.keys(defaults)){const el=$(k);if(el)settings[k]=el.value}localStorage.setItem("sv3-settings",JSON.stringify(settings));$("volumeval").value=settings.volume+"%";$("sensval").value=(settings.sens/10).toFixed(1);if(renderer){renderer.setPixelRatio(Math.min(devicePixelRatio,settings.quality==="low"?1:settings.quality==="medium"?1.4:2));}}
$("volume").addEventListener("input",()=>{$("volumeval").value=$("volume").value+"%";settings.volume=+$("volume").value;localStorage.setItem("sv3-settings",JSON.stringify(settings))});
$("sens").addEventListener("input",()=>{$("sensval").value=(+$("sens").value/10).toFixed(1);settings.sens=+$("sens").value;localStorage.setItem("sv3-settings",JSON.stringify(settings))});
for(const k of ["keyForward","keyBack","keyLeft","keyRight","keyDash","quality","sound"])$(k).addEventListener("change",saveSettings);
$("avatarpick").onclick=()=>$("avatarfile").click();
$("avatarfile").onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>2*1024*1024){alert("Выбери изображение меньше 2 МБ.");return}const img=new Image();img.onload=()=>{const c=document.createElement("canvas");c.width=128;c.height=128;const ctx=c.getContext("2d");const s=Math.min(img.width,img.height);ctx.drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,128,128);avatar=c.toDataURL("image/jpeg",.8);localStorage.setItem("sv3-avatar",avatar);avatarPreview()};img.src=URL.createObjectURL(f)};
let ws=null, myId=null, roomCode=null, roster=[], gameOn=false, pointer=false, keys={}, lastSent=0, lastShot=0, dashUntil=0, nextDash=0, localHP=100, kills=0, isScore=false, isPaused=false;
let scene,camera,renderer,player,remoteMeshes=new Map(),clock=new THREE.Clock(), raycaster=new THREE.Raycaster();
const materials={floor:new THREE.MeshStandardMaterial({color:0x172635,roughness:.9}),wall:new THREE.MeshStandardMaterial({color:0x30465a,roughness:.8}),accent:new THREE.MeshStandardMaterial({color:0x287a91,metalness:.35,roughness:.4}),T:new THREE.MeshStandardMaterial({color:0xff8158,roughness:.65}),CT:new THREE.MeshStandardMaterial({color:0x5dc8ff,roughness:.65}),head:new THREE.MeshStandardMaterial({color:0xd2ad8c}),gun:new THREE.MeshStandardMaterial({color:0x111923,metalness:.75,roughness:.3})};
function block(x,y,z,sx,sy,sz,mat){const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);return m}
function initWorld(){
 scene=new THREE.Scene();scene.background=new THREE.Color(0x09111b);scene.fog=new THREE.Fog(0x09111b,35,90);
 camera=new THREE.PerspectiveCamera(76,innerWidth/innerHeight,.1,150);camera.position.set(0,1.65,0);
 renderer=new THREE.WebGLRenderer({canvas:$("world"),antialias:settings.quality!=="low"});renderer.setPixelRatio(Math.min(devicePixelRatio,settings.quality==="low"?1:settings.quality==="medium"?1.4:2));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=settings.quality==="high";renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 scene.add(new THREE.HemisphereLight(0x9bc8e9,0x18202b,2));
 const light=new THREE.DirectionalLight(0xffe5c4,2.2);light.position.set(-8,18,5);light.castShadow=true;light.shadow.mapSize.set(1024,1024);scene.add(light);
 const floor=block(0,-.5,0,64,1,64,materials.floor);floor.receiveShadow=true;
 // Arena walls, cover blocks, containers, and luminous lane markings.
 block(0,3,-32,64,6,1,materials.wall);block(0,3,32,64,6,1,materials.wall);block(-32,3,0,1,6,64,materials.wall);block(32,3,0,1,6,64,materials.wall);
 for(let z=-24;z<=24;z+=8){block(-12,1.1,z,5,2.2,3,materials.wall);block(12,1.1,z+4,5,2.2,3,materials.wall)}
 for(let x=-24;x<=24;x+=8){block(x,1.3,-12,3,2.6,5,materials.wall);block(x+4,1.3,12,3,2.6,5,materials.wall)}
 for(let i=-3;i<=3;i++){const stripe=block(i*3,.015,0,.035,.02,58,materials.accent);stripe.castShadow=false}
 for(const [x,z,col] of [[-23,-23,0xff7755],[23,23,0x55cfff]]){const lamp=new THREE.PointLight(col,24,24);lamp.position.set(x,5,z);scene.add(lamp)}
 player=new THREE.Group();const body=new THREE.Mesh(new THREE.CapsuleGeometry(.38,.8,4,8),materials.CT);body.position.y=1;player.add(body);const head=new THREE.Mesh(new THREE.SphereGeometry(.23,12,10),materials.head);head.position.y=1.65;player.add(head);const gun=blockLocal(.35,1.15,-.4,.18,.16,.7,materials.gun);player.add(gun);scene.add(player);
}
function blockLocal(x,y,z,sx,sy,sz,mat){const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat);m.position.set(x,y,z);return m}
function makeRemote(p){const g=new THREE.Group();const body=new THREE.Mesh(new THREE.CapsuleGeometry(.38,.8,4,8),p.team==="T"?materials.T:materials.CT);body.position.y=1;g.add(body);const head=new THREE.Mesh(new THREE.SphereGeometry(.23,12,10),materials.head);head.position.y=1.65;g.add(head);const gun=new THREE.Mesh(new THREE.BoxGeometry(.16,.15,.7),materials.gun);gun.position.set(.35,1.15,-.4);g.add(gun);scene.add(g);return g}
function connect(create){
 const name=$("nickname").value.trim().slice(0,18)||"Player";localStorage.setItem("sv3-name",name);
 let code=create?"":$("roomcode").value.trim().toUpperCase();if(!create&&!code){alert("Введи код комнаты или нажми «Создать комнату».");return}
 const proto=location.protocol==="https:"?"wss:":"ws:";
 ws=new WebSocket(`${proto}//${location.host}`);
 ws.onopen=()=>ws.send(JSON.stringify({type:"join",room:code,name,team:$("team").value==="AUTO"?undefined:$("team").value,avatar}));
 ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}
  if(m.type==="error"){alert(m.message);return}
  if(m.type==="joined"){myId=m.id;roomCode=m.room;roster=m.players;startGame();return}
  if(m.type==="state"){roster=m.players||[];syncPlayers();renderRoster();if(isScore)renderScore();const me=roster.find(p=>p.id===myId);if(me){localHP=me.hp;$("health").textContent=Math.max(0,me.hp);$("hpfill").style.width=Math.max(0,me.hp)+"%";$("kills").textContent=me.score||0;kills=me.score||0;if(me.hp<=0&&!respawnTimer){respawnTimer=setTimeout(()=>{if(ws?.readyState===1)ws.send(JSON.stringify({type:"respawn"}));respawnTimer=null},1800)}}}
  if(m.type==="feed")showFeed(m.text);
  if(m.type==="hit"&&m.by===myId){showFeed("ПОПАДАНИЕ");}
 };
 ws.onclose=()=>{if(gameOn)showFeed("Соединение закрыто")};
}
let respawnTimer=null;
$("create").onclick=()=>connect(true);$("join").onclick=()=>connect(false);
function startGame(){gameOn=true;$("lobby").classList.add("hidden");$("game").classList.remove("hidden");$("roomlabel").textContent="ROOM "+roomCode;initWorld();syncPlayers();renderRoster();animate();try{renderer.domElement.requestPointerLock()}catch{}}
function syncPlayers(){if(!scene)return;const seen=new Set();for(const p of roster){if(p.id===myId){if(player){player.position.set(p.x,0,p.z);player.rotation.y=p.yaw}continue}seen.add(p.id);let g=remoteMeshes.get(p.id);if(!g){g=makeRemote(p);remoteMeshes.set(p.id,g)}g.position.set(p.x,0,p.z);g.rotation.y=p.yaw;g.visible=p.hp>0;if(g.children[0].material!== (p.team==="T"?materials.T:materials.CT))g.children[0].material=p.team==="T"?materials.T:materials.CT}for(const [id,g] of remoteMeshes)if(!seen.has(id)){scene.remove(g);remoteMeshes.delete(id)}}
function renderRoster(){const sorted=[...roster].sort((a,b)=>a.team.localeCompare(b.team)||b.score-a.score);$("playercount").textContent=sorted.length;$("rosterlist").innerHTML=sorted.map(p=>`<div class="person"><span class="dot" style="background:${p.team==="T"?"#ff8158":"#5dc8ff"}"></span>${p.avatar?`<img class="avatarmini" src="${p.avatar}">`:`<span class="avatarmini">${p.bot?"AI":"SV"}</span>`}<span class="personname">${escapeHtml(p.name)}${p.id===myId?" (ты)":""}</span><span class="personscore">${p.score||0}</span></div>`).join("")}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function renderScore(){const sorted=[...roster].sort((a,b)=>b.score-a.score);$("scorebody").innerHTML=sorted.map(p=>`<tr><td>${p.id===myId?"★ ":""}${escapeHtml(p.name)}${p.bot?" · AI":""}</td><td style="color:${p.team==="T"?"#ff9a75":"#78d8ff"}">${p.team==="T"?"Террористы":"Контр-террористы"}</td><td>${p.score||0}</td><td>${p.hp}</td></tr>`).join("")}
function showFeed(t){const d=document.createElement("div");d.className="feeditem";d.textContent=t;$("feed").appendChild(d);setTimeout(()=>d.remove(),4100)}
$("addbot").onclick=()=>{if(ws?.readyState===1)ws.send(JSON.stringify({type:"bot",name:"BOT-"+(roster.filter(p=>p.bot).length+1)}))};
$("switchteam").onclick=()=>{const me=roster.find(p=>p.id===myId);if(ws?.readyState===1)ws.send(JSON.stringify({type:"team",team:me?.team==="T"?"CT":"T"}))};
$("invite").onclick=async()=>{const url=new URL(location.href);url.searchParams.set("room",roomCode);try{await navigator.clipboard.writeText(url.href);$("invite").textContent="✓ Ссылка скопирована";setTimeout(()=>$("invite").textContent="↗ Пригласить",1800)}catch{prompt("Скопируй ссылку:",url.href)}};
$("leave").onclick=leaveGame;$("pauseLeave").onclick=leaveGame;
function leaveGame(){gameOn=false;document.exitPointerLock?.();if(ws){ws.onclose=null;ws.close();ws=null}if(renderer){renderer.dispose();renderer=null}remoteMeshes.clear();scene=null;$("game").classList.add("hidden");$("lobby").classList.remove("hidden");["settings","scoreboard","pause"].forEach(id=>$(id).classList.add("hidden"));history.replaceState(null,"",location.pathname)}
$("openSettings").onclick=$("settingsLobby").onclick=()=>{$("settings").classList.remove("hidden");isPaused=true;document.exitPointerLock?.()};
$("closeSettings").onclick=()=>{$("settings").classList.add("hidden");saveSettings();isPaused=false;if(gameOn)renderer?.domElement.requestPointerLock()};
$("pauseSettings").onclick=()=>{$("pause").classList.add("hidden");$("settings").classList.remove("hidden")};
$("resume").onclick=()=>{$("pause").classList.add("hidden");isPaused=false;renderer?.domElement.requestPointerLock()};
$("fullscreen").onclick=()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.();else document.exitFullscreen?.()};
$("closeScore").onclick=()=>{isScore=false;$("scoreboard").classList.add("hidden");renderer?.domElement.requestPointerLock()};
document.addEventListener("pointerlockchange",()=>{pointer=document.pointerLockElement===$("world");if(gameOn&&!pointer&&!isScore&&!$("settings").classList.contains("hidden")===false){if(!isPaused){$("pause").classList.remove("hidden");isPaused=true}}});
document.addEventListener("mousemove",e=>{if(!pointer||!player)return;const sens=(settings.sens/10)*.0017;player.rotation.y-=e.movementX*sens;camera.rotation.order="YXZ";camera.rotation.y=player.rotation.y;camera.rotation.x=Math.max(-1.35,Math.min(1.35,camera.rotation.x-e.movementY*sens))});
document.addEventListener("keydown",e=>{if(["TAB"," "].includes(e.key.toUpperCase()))e.preventDefault();keys[e.key.toUpperCase()]=true;if(e.key==="Tab"){isScore=true;$("scoreboard").classList.remove("hidden");document.exitPointerLock?.();renderScore()}if(e.key==="Escape"){if(!$("scoreboard").classList.contains("hidden")){$("scoreboard").classList.add("hidden");isScore=false}else if(!$("settings").classList.contains("hidden"))$("settings").classList.add("hidden")}});
document.addEventListener("keyup",e=>{keys[e.key.toUpperCase()]=false;if(e.key==="Tab"){isScore=false;$("scoreboard").classList.add("hidden");if(gameOn&&!isPaused)renderer?.domElement.requestPointerLock()}});
$("world").addEventListener("mousedown",e=>{if(e.button===0&&pointer&&gameOn&&!isScore){const now=performance.now();if(now-lastShot>140&&ws?.readyState===1){lastShot=now;ws.send(JSON.stringify({type:"shoot"}));playShot()}}});
let audioCtx=null;function playShot(){if(settings.sound==="off"||+settings.volume===0)return;try{audioCtx ||=new AudioContext();const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type="sawtooth";osc.frequency.setValueAtTime(120,audioCtx.currentTime);osc.frequency.exponentialRampToValueAtTime(45,audioCtx.currentTime+.07);gain.gain.setValueAtTime(.06*(settings.volume/100),audioCtx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.09);osc.connect(gain);gain.connect(audioCtx.destination);osc.start();osc.stop(audioCtx.currentTime+.1)}catch{}}
function animate(){if(!gameOn||!renderer)return;requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05),now=performance.now();if(player&&pointer&&!isPaused&&!isScore){let f=0,s=0;if(keys[settings.keyForward])f+=1;if(keys[settings.keyBack])f-=1;if(keys[settings.keyRight])s+=1;if(keys[settings.keyLeft])s-=1;const len=Math.hypot(f,s)||1;f/=len;s/=len;let speed=7.4;if(keys[settings.keyDash]&&now>nextDash){dashUntil=now+155;nextDash=now+1100;showFeed("РЫВОК!")}if(now<dashUntil)speed=22;const yaw=player.rotation.y;const vx=(-Math.sin(yaw)*f+Math.cos(yaw)*s)*speed*dt,vz=(-Math.cos(yaw)*f-Math.sin(yaw)*s)*speed*dt;player.position.x=THREE.MathUtils.clamp(player.position.x+vx,-29,29);player.position.z=THREE.MathUtils.clamp(player.position.z+vz,-29,29);
 const t=now/1000;camera.position.set(player.position.x,1.65+Math.sin(t*10)*(f||s?0.025:0),player.position.z);camera.rotation.y=player.rotation.y;camera.rotation.x=Math.max(-1.35,Math.min(1.35,camera.rotation.x));if(now-lastSent>45&&ws?.readyState===1){lastSent=now;ws.send(JSON.stringify({type:"move",x:player.position.x,y:camera.position.y,z:player.position.z,yaw:player.rotation.y,pitch:camera.rotation.x,dash:now<dashUntil,avatar}))}$("dashlabel").textContent=now>nextDash?"READY":Math.ceil((nextDash-now)/100)/10+"s"}
 renderer.render(scene,camera)}
window.addEventListener("resize",()=>{if(camera&&renderer){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)}});
const q=new URLSearchParams(location.search).get("room");if(q){$("roomcode").value=q;setTimeout(()=>connect(false),350)}
