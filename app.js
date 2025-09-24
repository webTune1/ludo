// app.js (module) — Ludo Playground (Local + AI) — Single-file logic
// React-like organization, pure JS (no libs).

/* ========================== Utilities ========================== */
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const lerp = (a, b, t) => a + (b - a) * t;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hexA = (hex, a) => {
  const c = hex.replace('#','');
  const r=parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
};
const randInt = (a,b) => a + Math.floor(Math.random()*(b-a+1));

/* ========================== Constants / State ========================== */
const COLORS = ['#2fbe3a','#f5c400','#1e88e5','#e53935']; // G,Y,B,R
const COLORNAMES = ['Green','Yellow','Blue','Red'];
const START_INDEX = [0,13,26,39];
const SAFE_EXTRA = [5,18,31,44];

const State = {
  mode: null, // 'Local' | 'AI'
  options: {
    theme: 'classic',     // 'classic' | 'minimal'
    showSafe: true,
    blockade: false,
    sound: true
  },
  players: [],            // [{id,name,color,isAI?}]
  pieces: {},             // id -> [-1..57]*4
  turnIndex: 0,
  dice: null,
  chain6: 0,
  winner: null,           // id
};

function resetMatch(players){
  State.players = players;
  State.pieces = {};
  players.forEach(p => State.pieces[p.id] = [-1,-1,-1,-1]);
  State.turnIndex = 0;
  State.dice = null;
  State.chain6 = 0;
  State.winner = null;
}

/* ========================== Board (Canvas) ========================== */
class Board {
  constructor(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.geom = null;
    this.path = [];      // 52 nodes on outer track
    this.home = [[],[],[],[]]; // 6 nodes per color
    this.base = [[],[],[],[]]; // 4 base spots per color
    this.theme = 'classic';
    this.showSafe = true;
  }
  setTheme(v){ this.theme=v; }
  setShowSafe(v){ this.showSafe=v; }

  resize(){
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * devicePixelRatio);
    this.canvas.height = Math.floor(rect.height * devicePixelRatio);
    this.ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);

    const W = rect.width, H = rect.height;
    const S = Math.min(W,H) - 24*2;
    const ox = (W - S)/2, oy = (H - S)/2;
    const n = 15, t = S / n;
    this.geom = {W,H,S,ox,oy,n,t};
    this.computeGeometry();
  }

  computeGeometry(){
    const {S,ox,oy,t} = this.geom;
    // 52-loop rectangular track (13 per side)
    const left = ox + t, right = ox + S - t, top = oy + t, bottom = oy + S - t;
    const per = 13; const P=[];
    for(let i=0;i<per;i++) P.push({x: lerp(left,right,i/(per-1)), y: top});
    for(let i=1;i<per;i++) P.push({x: right, y: lerp(top,bottom,i/(per-1))});
    for(let i=1;i<per;i++) P.push({x: lerp(right,left,i/(per-1)), y: bottom});
    for(let i=1;i<per-1;i++) P.push({x: left, y: lerp(bottom,top,i/(per-1))});
    this.path = P;

    const cx = ox + S/2, cy = oy + S/2;
    // home lanes (6 steps towards center from each color's entry)
    this.home = [0,1,2,3].map(p=>{
      const entry = P[p*13];
      const v = norm({x: cx-entry.x, y: cy-entry.y});
      const arr = [];
      for(let k=1;k<=6;k++){
        arr.push({ x: entry.x + v.x*t*k*1.25, y: entry.y + v.y*t*k*1.25 });
      }
      return arr;
    });
    // base centers (4 quadrants)
    const g = { x: this.gx(3),  y: this.gy(3)  };
    const y = { x: this.gx(12), y: this.gy(3)  };
    const b = { x: this.gx(12), y: this.gy(12) };
    const r = { x: this.gx(3),  y: this.gy(12) };
    this.base = [g,y,b,r].map(c => [
      {x:c.x - t*1.4, y:c.y - t*1.4},
      {x:c.x + t*1.4, y:c.y - t*1.4},
      {x:c.x - t*1.4, y:c.y + t*1.4},
      {x:c.x + t*1.4, y:c.y + t*1.4},
    ]);
  }

  render(state){
    const {W,H,ox,oy,S,t} = this.geom;
    const ctx = this.ctx;
    ctx.clearRect(0,0,W,H);

    // background
    roundRect(ctx, ox,oy,S,S,16);
    ctx.fillStyle = getCss('--panel'); ctx.fill();

    if(this.theme==='classic'){
      // four colored homes
      drawHome(ctx, ox,oy,S/2,S/2, COLORS[0]);
      drawHome(ctx, ox+S/2,oy,S/2,S/2, COLORS[1]);
      drawHome(ctx, ox+S/2,oy+S/2,S/2,S/2, COLORS[2]);
      drawHome(ctx, ox,oy+S/2,S/2,S/2, COLORS[3]);
      drawCenterStar(ctx, ox+S/2, oy+S/2, t*2.1);
    }

    // safe start circles
    const rNode = Math.max(6, t*0.35);
    START_INDEX.forEach((startIdx, p)=>{
      const c = this.coordForTrack(startIdx);
      ctx.beginPath(); ctx.arc(c.x, c.y, rNode, 0, Math.PI*2);
      ctx.fillStyle = hexA(COLORS[p], 0.85); ctx.fill();
      ctx.lineWidth=2; ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.stroke();
    });

    // extra safe stars
    if(this.showSafe && this.theme==='classic'){
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      SAFE_EXTRA.forEach(i=>{
        const c = this.coordForTrack(i);
        star(ctx, c.x, c.y, rNode*0.9, 5);
      });
      ctx.restore();
    }

    // tokens
    for(const P of state.players){
      const pcs = state.pieces[P.id] || [-1,-1,-1,-1];
      for(let k=0;k<4;k++){
        const pos = this.coordForPiece(P.color, pcs[k], k);
        drawToken(ctx, pos.x, pos.y, COLORS[P.color], t);
      }
    }
  }

  coordForTrack(i){ return this.path[(i%52+52)%52]; }
  coordForPiece(color, steps, kIdx){
    if(steps < 0) return this.base[color][kIdx];
    if(steps <= 51) return this.coordForTrack((color*13 + steps) % 52);
    if(steps <= 57) return this.home[color][steps-52];
    return this.home[color][5];
  }
  pickPiece(state, x,y){
    const cur = state.players[state.turnIndex]; if(!cur) return -1;
    const pcs = state.pieces[cur.id]; const R = Math.max(10, this.geom.t*0.45);
    for(let i=0;i<4;i++){
      const c = this.coordForPiece(cur.color, pcs[i], i);
      if(Math.hypot(c.x-x,c.y-y) <= R*1.2) return i;
    }
    return -1;
  }

  gx(c){ return this.geom.ox + c*this.geom.t; }
  gy(r){ return this.geom.oy + r*this.geom.t; }
}
function norm(v){ const m=Math.hypot(v.x,v.y)||1; return {x:v.x/m,y:v.y/m}; }
function roundRect(ctx,x,y,w,h,r){
  const rr=Math.min(r,w/2,h/2); ctx.beginPath();
  ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr); ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr); ctx.closePath();
}
function drawHome(ctx,x,y,w,h,color){
  ctx.save();
  ctx.fillStyle = hexA(color, .18);
  roundRect(ctx,x,y,w,h,12); ctx.fill();
  ctx.strokeStyle = hexA(color, .75); ctx.lineWidth=3;
  ctx.strokeRect(x+10,y+10,w-20,h-20);
  ctx.restore();
}
function drawCenterStar(ctx,cx,cy,r){
  drawTri(ctx,cx,cy, cx-r,cy, COLORS[0]);
  drawTri(ctx,cx,cy, cx+r,cy, COLORS[1]);
  drawTri(ctx,cx,cy, cx,cy+r, COLORS[2]);
  drawTri(ctx,cx,cy, cx,cy-r, COLORS[3]);
}
function drawTri(ctx,x1,y1,x2,y2,color){
  const midx=(x1+x2)/2, midy=(y1+y2)/2;
  const dx=x2-x1, dy=y2-y1, nx=-dy, ny=dx, f=0.6;
  ctx.beginPath();
  ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(midx+nx*f, midy+ny*f);
  ctx.closePath(); ctx.fillStyle=hexA(color,.7); ctx.fill(); ctx.strokeStyle=hexA(color,.9); ctx.stroke();
}
function star(ctx,x,y,r,spikes){
  ctx.beginPath();
  for(let i=0;i<spikes*2;i++){
    const ang=(Math.PI/spikes)*i - Math.PI/2;
    const rad=i%2===0 ? r : r*0.5;
    ctx.lineTo(x+Math.cos(ang)*rad,y+Math.sin(ang)*rad);
  }
  ctx.closePath(); ctx.fill();
}
function drawToken(ctx,x,y,color,t){
  const R=Math.max(10,t*0.45);
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,.35)'; ctx.shadowBlur=6;
  ctx.beginPath(); ctx.arc(x,y,R,0,Math.PI*2);
  ctx.fillStyle=color; ctx.fill();
  ctx.lineWidth=2; ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.stroke();
  ctx.restore();
}
function getCss(v){ return getComputedStyle(document.body).getPropertyValue(v).trim(); }

/* ========================== Rules / Engine ========================== */
function occupancy(){
  const map = {};
  for(const P of State.players){
    const arr = State.pieces[P.id];
    for(let k=0;k<4;k++){
      const s = arr[k];
      if(s<0 || s===57) continue;
      if(s<=51){
        const idx = (P.color*13 + s) % 52;
        const key = 'T'+idx;
        map[key] = map[key] || {count:0, owners:{}};
        map[key].count++; map[key].owners[P.id]=(map[key].owners[P.id]||0)+1;
      }else{
        const key = 'H'+P.color+'-'+(s-52);
        map[key] = map[key] || {count:0, owners:{}};
        map[key].count++; map[key].owners[P.id]=(map[key].owners[P.id]||0)+1;
      }
    }
  }
  return map;
}
function isSafeTile(trackIndex){
  return START_INDEX.includes(trackIndex) || SAFE_EXTRA.includes(trackIndex);
}
function blockedOnEnter(player){
  if(!State.options.blockade) return false;
  const startIdx = (player.color*13) % 52;
  const occ = occupancy()['T'+startIdx];
  return !!(occ && (occ.owners[player.id]||0)>=2);
}
function pathBlocked(player, from, to){
  if(!State.options.blockade) return false;
  const occMap = occupancy();
  for(let s=from+1;s<=to;s++){
    const ti = (player.color*13 + s) % 52;
    const occ = occMap['T'+ti];
    if(occ){
      for(const [,cnt] of Object.entries(occ.owners)){ if(cnt>=2) return true; }
    }
  }
  return false;
}
function legalMoves(player, dice){
  const pcs = State.pieces[player.id];
  const mv=[];
  for(let i=0;i<4;i++){
    const s = pcs[i];
    if(s===57) continue;
    if(s<0){
      if(dice===6 && !blockedOnEnter(player)) mv.push({piece:i, from:s, to:0});
      continue;
    }
    const to = s + dice;
    if(to>57) continue; // exact finish
    if(to<=51 && pathBlocked(player, s, to)) continue;
    mv.push({piece:i, from:s, to});
  }
  return mv;
}
function rollDice(){
  if(State.winner) return null;
  const d = randInt(1,6);
  State.dice = d;
  return d;
}
function applyMove(player, m){
  const pcs = State.pieces[player.id];
  pcs[m.piece] = m.to;

  // capture on landing (track only, not safe)
  if(m.to<=51){
    const tileIdx = (player.color*13 + m.to) % 52;
    if(!isSafeTile(tileIdx)){
      for(const E of State.players){
        if(E.id===player.id) continue;
        const ep = State.pieces[E.id];
        for(let i=0;i<4;i++){
          const s = ep[i];
          if(s<0 || s===57) continue;
          const eTile = (E.color*13 + s) % 52;
          if(eTile===tileIdx){
            ep[i] = -1; // back to base
          }
        }
      }
    }
  }

  // win?
  if(State.pieces[player.id].every(s=> s===57)) State.winner = player.id;
}
function nextTurn(){ if(!State.winner) State.turnIndex = (State.turnIndex+1) % State.players.length; }
function tryMove(player, pieceIdx){
  const dice = State.dice; if(dice===null) return false;
  const mv = legalMoves(player, dice).find(m => m.piece===pieceIdx);
  if(!mv) return false;

  applyMove(player, mv);

  if(dice===6){
    State.chain6++;
    if(State.chain6>=3){ State.chain6=0; State.dice=null; nextTurn(); }
    else { State.dice=null; /* same player's extra roll */ }
  }else{
    State.chain6=0; State.dice=null; nextTurn();
  }
  return true;
}
function currentPlayer(){ return State.players[State.turnIndex]; }

/* ========================== AI ========================== */
function pickAIMove(player, dice){
  const moves = legalMoves(player, dice);
  if(moves.length===0) return null;

  let best=null, bestScore=-Infinity;
  for(const m of moves){
    let s = 0;
    if(m.to===57) s += 1000; // finishing move
    if(m.from<=51 && m.to>51) s += 200; // enter home lane
    // capture potential
    if(m.to<=51){
      const tile = (player.color*13 + m.to) % 52;
      for(const E of State.players){
        if(E.id===player.id) continue;
        for(const st of State.pieces[E.id]){
          if(st>=0 && st<=51){
            const e = (E.color*13 + st) % 52;
            if(e===tile) s += 500;
          }
        }
      }
      s += m.to*2; // progress
      // danger next turn
      for(const E of State.players){
        if(E.id===player.id) continue;
        for(let d=1; d<=6; d++){
          for(const st of State.pieces[E.id]){
            if(st<0 || st===57) continue;
            const to = st + d; if(to>57) continue;
            if(to<=51){
              const eTile=(E.color*13 + to) % 52;
              if(eTile===tile) s -= 60;
            }
          }
        }
      }
    }
    if(s>bestScore){ best=m; bestScore=s; }
  }
  return best;
}

/* ========================== Animations / Sound ========================== */
async function animateDice(badge, to){
  // quick jitter animation
  for(let i=0;i<10;i++){ badge.textContent = 1 + Math.floor(Math.random()*6); await sleep(60); }
  badge.textContent = to;
}
async function animateTokenStep(board, fromSteps, toSteps, colorIdx, pieceIdx, onFrame){
  // simple stepping animation: call onFrame at each intermediate step
  const stepCount = toSteps - fromSteps;
  const delay = Math.max(60, 280 - stepCount*20);
  for(let s=fromSteps+1; s<=toSteps; s++){
    onFrame(s); await sleep(delay);
  }
}

// Sounds (beeps using WebAudio)
let AC = null;
function audio(){ AC = AC || new (window.AudioContext||window.webkitAudioContext)(); return AC; }
function beep(freq=440, dur=80, vol=0.07){
  try{
    const ac = audio(); const o = ac.createOscillator(); const g = ac.createGain();
    o.type='sine'; o.frequency.value=freq; o.connect(g); g.connect(ac.destination);
    g.gain.value = vol; o.start();
    setTimeout(()=>{ g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime+dur/1000); o.stop(ac.currentTime+dur/1000); }, 10);
  }catch{}
}
const sRoll = ()=> State.options.sound && beep(520, 60, 0.05);
const sMove = ()=> State.options.sound && beep(420, 70, 0.06);
const sWin  = ()=> State.options.sound && beep(880, 200, 0.08);

/* ========================== Main UI Wiring ========================== */
const canvas = document.getElementById('board');
const board = new Board(canvas);

const nameInput = document.getElementById('nameInput');
const localBtn = document.getElementById('localBtn');
const aiBtn = document.getElementById('aiBtn');
const themeBtn = document.getElementById('themeBtn');

const turnBadge = document.getElementById('turnBadge');
const diceBadge = document.getElementById('diceBadge');
const rollBtn = document.getElementById('rollBtn');

const modeLbl = document.getElementById('modeLbl');
const playersLbl = document.getElementById('playersLbl');
const turnLbl = document.getElementById('turnLbl');

const boardTheme = document.getElementById('boardTheme');
const safeChk = document.getElementById('safeChk');
const blockChk = document.getElementById('blockChk');
const soundChk = document.getElementById('soundChk');
const restartBtn = document.getElementById('restartBtn');
const statusEl = document.getElementById('status');

// Theme toggle
themeBtn.addEventListener('click', ()=>{
  const light = document.body.getAttribute('data-theme')==='light';
  document.body.setAttribute('data-theme', light? 'dark' : 'light');
  render();
});

// Board / window sizing
function resizeAll(){
  board.resize();
  render();
}
window.addEventListener('resize', resizeAll);
resizeAll();

// Options
boardTheme.addEventListener('change', ()=> {
  State.options.theme = boardTheme.value;
  board.setTheme(State.options.theme);
  render();
});
safeChk.addEventListener('change', ()=> {
  State.options.showSafe = safeChk.checked; board.setShowSafe(State.options.showSafe); render();
});
blockChk.addEventListener('change', ()=> { State.options.blockade = blockChk.checked; });
soundChk.addEventListener('change', ()=> { State.options.sound = soundChk.checked; });

// Start buttons
localBtn.addEventListener('click', async ()=>{
  const n = clamp(parseInt(prompt('How many players? (2–4)','2')||'2',10),2,4);
  const players = [];
  for(let i=0;i<n;i++){
    const def = i===0 ? (nameInput.value.trim() || 'You') : `Player ${i+1}`;
    const name = prompt(`Name for Player ${i+1} (${COLORNAMES[i]})`, def) || def;
    players.push({ id:'P'+i, name, color:i });
  }
  State.mode = 'Local';
  resetMatch(players);
  updateLabels(); render();
  statusEl.textContent = 'Local match started.';
  rollBtn.disabled = false;
});

aiBtn.addEventListener('click', ()=>{
  const me = nameInput.value.trim() || 'You';
  const players = [
    { id:'P0', name: me, color: 0 },
    { id:'P1', name: 'AI', color: 2, isAI:true }
  ];
  State.mode = 'AI';
  resetMatch(players);
  updateLabels(); render();
  statusEl.textContent = 'VS AI match started.';
  rollBtn.disabled = false;
});

// Dice roll
rollBtn.addEventListener('click', async ()=>{
  if(State.winner) return;
  const cur = currentPlayer(); if(!cur) return;
  if(cur.isAI) return; // AI rolls itself
  const val = rollDice();
  sRoll();
  await animateDice(diceBadge, val);

  updateLabels(); render();
  maybeAI();
});

// Board click to move
canvas.addEventListener('click', async (e)=>{
  if(State.winner) return;
  const cur = currentPlayer(); if(!cur || cur.isAI) return;
  if(State.dice===null){ pulse(rollBtn); return; }

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const idx = board.pickPiece(State, x,y);
  if(idx<0) return;

  const from = State.pieces[cur.id][idx];
  const ok = tryMove(cur, idx);
  if(!ok){ statusEl.textContent = 'Illegal move.'; return; }

  await animateTokenStep(board, from, State.pieces[cur.id][idx], cur.color, idx, ()=> render());
  if(State.winner){ sWin(); statusEl.textContent = `${cur.name} wins!`; } else { sMove(); }
  updateLabels(); render();
  maybeAI();
});

// Restart
restartBtn.addEventListener('click', ()=>{
  if(!State.mode || State.players.length===0) return;
  const players = State.players.map(p=> ({...p}));
  resetMatch(players);
  diceBadge.textContent = '—';
  statusEl.textContent = 'Match restarted.';
  updateLabels(); render();
});

// AI loop
async function maybeAI(){
  const cur = currentPlayer();
  if(!cur || !cur.isAI || State.winner) return;

  await sleep(400);
  const val = rollDice();
  sRoll();
  await animateDice(diceBadge, val);
  await sleep(350);

  const mv = pickAIMove(cur, val);
  if(!mv){
    // no move
    if(val===6){
      State.chain6++;
      if(State.chain6>=3){ State.chain6=0; State.dice=null; nextTurn(); }
      else { State.dice=null; } // will roll again
    }else{
      State.chain6=0; State.dice=null; nextTurn();
    }
    updateLabels(); render();
    await sleep(350);
    maybeAI();
    return;
  }

  const from = State.pieces[cur.id][mv.piece];
  // Set dice and apply via tryMove to keep rules consistent
  State.dice = val;
  tryMove(cur, mv.piece);
  await animateTokenStep(board, from, State.pieces[cur.id][mv.piece], cur.color, mv.piece, ()=> render());
  if(State.winner) sWin(); else sMove();
  updateLabels(); render();
  await sleep(350);
  maybeAI();
}

/* ========================== UI helpers ========================== */
function updateLabels(){
  const cur = currentPlayer();
  modeLbl.textContent = State.mode || '—';
  playersLbl.textContent = State.players.map(p=> p.name).join(', ') || '—';
  turnLbl.textContent = cur ? cur.name : '—';
  turnBadge.innerHTML = State.winner
    ? `🏆 ${winnerName()}`
    : (cur ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLORS[cur.color]};margin-right:6px"></span>Turn: <b>${cur.name}</b>` : '—');
  diceBadge.textContent = State.dice ?? '—';
}
function winnerName(){
  const p = State.players.find(x=> x.id===State.winner);
  return p ? `${p.name} wins!` : '—';
}
function render(){ board.render(State); }
function pulse(el){ el.style.transform='scale(1.06)'; setTimeout(()=> el.style.transform='', 140); }

/* ========================== Init ========================== */
board.setTheme(State.options.theme);
board.setShowSafe(State.options.showSafe);
updateLabels();
render();
