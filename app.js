// app.js — Ludo Playground (Local + AI) with true 15×15 boxed track

/* ========== Utils ========== */
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const lerp = (a, b, t) => a + (b - a) * t;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hexA = (hex, a) => {
  const c = hex.replace('#','');
  const r=parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
};
const randInt = (a,b) => a + Math.floor(Math.random()*(b-a+1));

/* ========== Game constants / state ========== */
const COLORS = ['#2fbe3a','#f5c400','#1e88e5','#e53935']; // G,Y,B,R
const COLORNAMES = ['Green','Yellow','Blue','Red'];
const START_INDEX = [0,13,26,39];   // safe start tiles (path indices)
const SAFE_EXTRA  = [5,18,31,44];   // star safe tiles (path indices)

const State = {
  mode: null,
  options: { theme: 'classic', showSafe: true, blockade: false, sound: true },
  players: [],         // [{id,name,color,isAI?}]
  pieces: {},          // id -> [-1..57]*4
  turnIndex: 0,
  dice: null,
  chain6: 0,
  winner: null
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

/* ========== Board (with boxed track) ========== */
class Board {
  constructor(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.geom = null;        // {W,H,S,ox,oy,n,t}
    this.path = [];          // 52 step positions (pixels)
    this.home = [[],[],[],[]]; // 6 home steps per color (pixels)
    this.base = [[],[],[],[]]; // 4 base parking per color (pixels)
    this.rcTrack = [];       // [{r,c}] mapped from path to grid cells
    this.rcHome  = [[],[],[],[]]; // per color home lane cells [{r,c}]
    this.theme = 'classic';
    this.showSafe = true;
  }
  setTheme(v){ this.theme = v; }
  setShowSafe(v){ this.showSafe = v; }

  resize(){
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * devicePixelRatio);
    this.canvas.height = Math.floor(rect.height * devicePixelRatio);
    this.ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);

    const W = rect.width, H = rect.height;
    const S = Math.min(W,H) - 24*2;
    const ox = (W - S)/2, oy = (H - S)/2;
    const n = 15, t = S/n;
    this.geom = {W,H,S,ox,oy,n,t};
    this.computeGeometry();
  }

  /* ---------- geometry + mapping to grid cells ---------- */
  computeGeometry(){
    const {S,ox,oy,t} = this.geom;

    // Build 52-step rectangular loop (like earlier minimal version)
    const left = ox + t, right = ox + S - t, top = oy + t, bottom = oy + S - t;
    const per = 13;
    const P=[];
    for(let i=0;i<per;i++) P.push({x: lerp(left,right,i/(per-1)), y: top});
    for(let i=1;i<per;i++) P.push({x: right, y: lerp(top,bottom,i/(per-1))});
    for(let i=1;i<per;i++) P.push({x: lerp(right,left,i/(per-1)), y: bottom});
    for(let i=1;i<per-1;i++) P.push({x: left, y: lerp(bottom,top,i/(per-1))});
    this.path = P;

    // Home lanes towards center
    const cx = ox + S/2, cy = oy + S/2;
    this.home = [0,1,2,3].map(p=>{
      const entry = P[p*13];
      const v = unit({x: cx - entry.x, y: cy - entry.y});
      const H = [];
      for(let k=1;k<=6;k++){
        H.push({ x: entry.x + v.x*t*k*1.25, y: entry.y + v.y*t*k*1.25 });
      }
      return H;
    });

    // Bases in four quadrants
    const g = { x: this.gx(3),  y: this.gy(3)  };
    const y = { x: this.gx(12), y: this.gy(3)  };
    const b = { x: this.gx(12), y: this.gy(12) };
    const r = { x: this.gx(3),  y: this.gy(12) };
    const mk = c => [
      {x:c.x - t*1.4, y:c.y - t*1.4},
      {x:c.x + t*1.4, y:c.y - t*1.4},
      {x:c.x - t*1.4, y:c.y + t*1.4},
      {x:c.x + t*1.4, y:c.y + t*1.4},
    ];
    this.base = [mk(g), mk(y), mk(b), mk(r)];

    // Map 52 path points to nearest grid cells (for drawing boxes)
    const uniq = new Set();
    this.rcTrack = [];
    for(const pt of this.path){
      const rc = this.xyToRC(pt.x, pt.y);
      if(rc && rc.r>=0 && rc.r<15 && rc.c>=0 && rc.c<15){
        const key = rc.r+','+rc.c;
        if(!uniq.has(key)){ uniq.add(key); this.rcTrack.push(rc); }
      }
    }
    // Map home lanes (6 cells per color)
    this.rcHome = [[],[],[],[]];
    for(let p=0;p<4;p++){
      const H = [];
      const seen = new Set();
      for(const pt of this.home[p]){
        const rc = this.xyToRC(pt.x, pt.y);
        if(!rc) continue; const key=rc.r+','+rc.c;
        if(!seen.has(key)){ seen.add(key); H.push(rc); }
      }
      this.rcHome[p]=H;
    }
  }

  // convert grid (r,c) -> cell rect
  cellRect(r,c){
    const {ox,oy,t} = this.geom;
    return { x: ox + c*t, y: oy + r*t, w: t, h: t };
  }
  // center of a cell
  cellCenter(r,c){
    const {ox,oy,t} = this.geom;
    return { x: ox + (c+0.5)*t, y: oy + (r+0.5)*t };
  }
  // convert pixel to nearest cell index
  xyToRC(x,y){
    const {ox,oy,t} = this.geom;
    const c = Math.round((x - (ox + t/2)) / t);
    const r = Math.round((y - (oy + t/2)) / t);
    if(r<0||r>14||c<0||c>14) return null;
    return {r,c};
  }

  /* ---------- render classic grid with boxes ---------- */
  render(state){
    const {W,H,ox,oy,S,t} = this.geom; const ctx = this.ctx;
    ctx.clearRect(0,0,W,H);

    // Board background
    roundRect(ctx, ox,oy,S,S,16);
    ctx.fillStyle = getCss('--panel'); ctx.fill();

    // Draw 15x15 faint grid
    ctx.save();
    ctx.lineWidth = Math.max(1, t*0.05);
    ctx.strokeStyle = getCss('--grid');
    for(let r=0;r<15;r++){
      for(let c=0;c<15;c++){
        const {x,y,w,h} = this.cellRect(r,c);
        ctx.strokeRect(x,y,w,h);
      }
    }
    ctx.restore();

    // Fill cross track bars (3 cells thick)
    this.fillBarRows(6,8, 'var(--track)');
    this.fillBarCols(6,8, 'var(--track)');

    // Homes (corner quadrants)
    this.fillRectRC(0,0,6,6, hexA(COLORS[0],0.20));   // Green TL
    this.fillRectRC(0,9,6,6, hexA(COLORS[1],0.20));   // Yellow TR
    this.fillRectRC(9,9,6,6, hexA(COLORS[2],0.20));   // Blue BR
    this.fillRectRC(9,0,6,6, hexA(COLORS[3],0.20));   // Red BL

    // Home lanes (6 cells to center) — colored
    for(let p=0;p<4;p++){
      for(const {r,c} of this.rcHome[p]){
        const {x,y,w,h} = this.cellRect(r,c);
        ctx.fillStyle = hexA(COLORS[p], 0.55);
        ctx.fillRect(x,y,w,h);
      }
    }

    // Track boxes (52 cells) — neutral light boxes
    ctx.save();
    ctx.fillStyle = getCss('--track');
    for(const {r,c} of this.rcTrack){
      const {x,y,w,h} = this.cellRect(r,c);
      ctx.fillRect(x,y,w,h);
    }
    ctx.restore();

    // Center star
    this.drawCenterStar();

    // Start tiles (safe) — stronger color overlay
    for(let i=0;i<4;i++){
      const rc = this.rcForPathIndex(START_INDEX[i]);
      if(rc){
        const {x,y,w,h} = this.cellRect(rc.r,rc.c);
        ctx.fillStyle = hexA(COLORS[i], 0.85);
        ctx.fillRect(x,y,w,h);
      }
    }

    // Extra safe stars
    if(this.showSafe){
      for(const idx of SAFE_EXTRA){
        const rc = this.rcForPathIndex(idx);
        if(!rc) continue;
        const ctr = this.cellCenter(rc.r, rc.c);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        star(ctx, ctr.x, ctr.y, t*0.35, 5);
      }
    }

    // Tokens on top
    for(const P of state.players){
      const pcs = state.pieces[P.id] || [-1,-1,-1,-1];
      for(let k=0;k<4;k++){
        const pos = this.coordForPiece(P.color, pcs[k], k);
        drawToken(ctx, pos.x, pos.y, COLORS[P.color], t);
      }
    }
  }

  // helpers to fill bars and rects in grid coords
  fillBarRows(r1, r2, color){
    const ctx = this.ctx;
    for(let r=r1;r<=r2;r++){
      for(let c=0;c<15;c++){
        const {x,y,w,h} = this.cellRect(r,c);
        ctx.fillStyle = color; ctx.fillRect(x,y,w,h);
      }
    }
  }
  fillBarCols(c1, c2, color){
    const ctx = this.ctx;
    for(let c=c1;c<=c2;c++){
      for(let r=0;r<15;r++){
        const {x,y,w,h} = this.cellRect(r,c);
        ctx.fillStyle = color; ctx.fillRect(x,y,w,h);
      }
    }
  }
  fillRectRC(r,c,h,w,color){
    const ctx = this.ctx;
    for(let i=0;i<h;i++){
      for(let j=0;j<w;j++){
        const R=r+i, C=c+j;
        const {x,y,w:ww,h:hh} = this.cellRect(R,C);
        ctx.fillStyle=color; ctx.fillRect(x,y,ww,hh);
      }
    }
  }
  drawCenterStar(){
    const {ox,oy,S,t} = this.geom;
    const cx = ox + S/2, cy = oy + S/2, r = t*2.1;
    drawTri(this.ctx,cx,cy, cx-r,cy, COLORS[0]);
    drawTri(this.ctx,cx,cy, cx+r,cy, COLORS[1]);
    drawTri(this.ctx,cx,cy, cx,cy+r, COLORS[2]);
    drawTri(this.ctx,cx,cy, cx,cy-r, COLORS[3]);
  }

  // map path index -> rc via rcTrack order
  rcForPathIndex(i){
    const idx = (i%this.rcTrack.length + this.rcTrack.length) % this.rcTrack.length;
    return this.rcTrack[idx];
  }

  // Coordinates for tokens (pixels)
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
function unit(v){ const m=Math.hypot(v.x,v.y)||1; return {x:v.x/m,y:v.y/m}; }
function roundRect(ctx,x,y,w,h,r){
  const rr=Math.min(r,w/2,h/2); ctx.beginPath();
  ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr); ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr); ctx.closePath();
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

/* ========== Rules / Engine ========== */
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
    if(occ){ for(const [,cnt] of Object.entries(occ.owners)){ if(cnt>=2) return true; } }
  }
  return false;
}
function legalMoves(player, dice){
  const pcs = State.pieces[player.id];
  const mv=[];
  for(let i=0;i<4;i++){
    const s = pcs[i];
    if(s===57) continue;
    if(s<0){ if(dice===6 && !blockedOnEnter(player)) mv.push({piece:i, from:s, to:0}); continue; }
    const to = s + dice; if(to>57) continue;
    if(to<=51 && pathBlocked(player, s, to)) continue;
    mv.push({piece:i, from:s, to});
  }
  return mv;
}
function rollDice(){ if(State.winner) return null; const d=randInt(1,6); State.dice=d; return d; }
function applyMove(player, m){
  const pcs = State.pieces[player.id]; pcs[m.piece] = m.to;
  if(m.to<=51){
    const tileIdx = (player.color*13 + m.to) % 52;
    if(!isSafeTile(tileIdx)){
      for(const E of State.players){
        if(E.id===player.id) continue;
        const ep = State.pieces[E.id];
        for(let i=0;i<4;i++){
          const s = ep[i]; if(s<0 || s===57) continue;
          const eTile = (E.color*13 + s) % 52;
          if(eTile===tileIdx) ep[i] = -1;
        }
      }
    }
  }
  if(State.pieces[player.id].every(s=> s===57)) State.winner = player.id;
}
function nextTurn(){ if(!State.winner) State.turnIndex = (State.turnIndex+1)%State.players.length; }
function tryMove(player, pieceIdx){
  const dice = State.dice; if(dice===null) return false;
  const mv = legalMoves(player, dice).find(m=> m.piece===pieceIdx);
  if(!mv) return false;
  applyMove(player, mv);
  if(dice===6){
    State.chain6++;
    if(State.chain6>=3){ State.chain6=0; State.dice=null; nextTurn(); }
    else { State.dice=null; }
  }else{
    State.chain6=0; State.dice=null; nextTurn();
  }
  return true;
}
function currentPlayer(){ return State.players[State.turnIndex]; }

/* ========== AI ========== */
function pickAIMove(player, dice){
  const moves = legalMoves(player, dice);
  if(moves.length===0) return null;
  let best=null, score=-Infinity;
  for(const m of moves){
    let s=0;
    if(m.to===57) s+=1000;
    if(m.from<=51 && m.to>51) s+=200;
    if(m.to<=51){
      const tile = (player.color*13 + m.to) % 52;
      for(const E of State.players){
        if(E.id===player.id) continue;
        for(const st of State.pieces[E.id]){
          if(st>=0 && st<=51){
            const e=(E.color*13 + st)%52;
            if(e===tile) s+=500;
          }
        }
      }
      s += m.to*2;
      for(const E of State.players){
        if(E.id===player.id) continue;
        for(let d=1; d<=6; d++){
          for(const st of State.pieces[E.id]){
            if(st<0 || st===57) continue;
            const to = st + d; if(to>57) continue;
            if(to<=51){
              const eTile=(E.color*13 + to)%52;
              if(eTile===tile) s-=60;
            }
          }
        }
      }
    }
    if(s>score){ score=s; best=m; }
  }
  return best;
}

/* ========== Animations & Sound ========== */
async function animateDice(badge, to){
  for(let i=0;i<10;i++){ badge.textContent = 1 + Math.floor(Math.random()*6); await sleep(60); }
  badge.textContent = to;
}
async function animateTokenStep(board, fromSteps, toSteps, colorIdx, pieceIdx, onFrame){
  const stepCount = toSteps - fromSteps;
  const delay = Math.max(60, 280 - stepCount*20);
  for(let s=fromSteps+1; s<=toSteps; s++){ onFrame(s); await sleep(delay); }
}
let AC = null; const audio = ()=> AC||(AC=new (window.AudioContext||window.webkitAudioContext)());
function beep(freq=440, dur=80, vol=0.07){ try{ const ac=audio(); const o=ac.createOscillator(), g=ac.createGain();
  o.type='sine'; o.frequency.value=freq; o.connect(g); g.connect(ac.destination);
  g.gain.value=vol; o.start(); setTimeout(()=>{ g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime+dur/1000); o.stop(ac.currentTime+dur/1000); },10);
}catch{}}
const sRoll = ()=> State.options.sound && beep(520, 60, 0.05);
const sMove = ()=> State.options.sound && beep(420, 70, 0.06);
const sWin  = ()=> State.options.sound && beep(880, 200, 0.08);

/* ========== UI Wiring ========== */
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

// Resize
function resizeAll(){ board.resize(); render(); }
window.addEventListener('resize', resizeAll);
resizeAll();

// Options
boardTheme.addEventListener('change', ()=> { State.options.theme = boardTheme.value; board.setTheme(State.options.theme); render(); });
safeChk.addEventListener('change', ()=> { State.options.showSafe = safeChk.checked; board.setShowSafe(State.options.showSafe); render(); });
blockChk.addEventListener('change', ()=> { State.options.blockade = blockChk.checked; });
soundChk.addEventListener('change', ()=> { State.options.sound = soundChk.checked; });

// Start: Local & AI
localBtn.addEventListener('click', async ()=>{
  const n = clamp(parseInt(prompt('How many players? (2–4)','2')||'2',10),2,4);
  const players=[];
  for(let i=0;i<n;i++){
    const def = i===0 ? (nameInput.value.trim() || 'You') : `Player ${i+1}`;
    const name = prompt(`Name for Player ${i+1} (${COLORNAMES[i]})`, def) || def;
    players.push({ id:'P'+i, name, color:i });
  }
  State.mode = 'Local';
  resetMatch(players);
  updateLabels(); render(); statusEl.textContent = 'Local match started.'; rollBtn.disabled = false;
});
aiBtn.addEventListener('click', ()=>{
  const me = nameInput.value.trim() || 'You';
  const players = [
    { id:'P0', name: me, color: 0 },
    { id:'P1', name: 'AI', color: 2, isAI:true }
  ];
  State.mode = 'AI';
  resetMatch(players);
  updateLabels(); render(); statusEl.textContent = 'VS AI match started.'; rollBtn.disabled = false;
});

// Dice
rollBtn.addEventListener('click', async ()=>{
  if(State.winner) return;
  const cur = currentPlayer(); if(!cur || cur.isAI) return;
  const val = rollDice(); sRoll(); await animateDice(diceBadge, val);
  updateLabels(); render(); maybeAI();
});

// Click token to move
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
  updateLabels(); render(); maybeAI();
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
  const val = rollDice(); sRoll(); await animateDice(diceBadge, val);
  await sleep(350);

  const mv = pickAIMove(cur, val);
  if(!mv){
    if(val===6){
      State.chain6++;
      if(State.chain6>=3){ State.chain6=0; State.dice=null; nextTurn(); }
      else { State.dice=null; } // extra roll
    }else{
      State.chain6=0; State.dice=null; nextTurn();
    }
    updateLabels(); render();
    await sleep(350); maybeAI();
    return;
  }

  const from = State.pieces[cur.id][mv.piece];
  State.dice = val; // ensure engine has the current dice
  tryMove(cur, mv.piece);
  await animateTokenStep(board, from, State.pieces[cur.id][mv.piece], cur.color, mv.piece, ()=> render());
  if(State.winner) sWin(); else sMove();
  updateLabels(); render(); await sleep(350); maybeAI();
}

/* ========== UI helpers ========== */
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
function winnerName(){ const p = State.players.find(x=> x.id===State.winner); return p ? `${p.name} wins!` : '—'; }
function render(){ board.render(State); }
function pulse(el){ el.style.transform='scale(1.06)'; setTimeout(()=> el.style.transform='', 140); }

/* ========== Init ========== */
board.setTheme(State.options.theme);
board.setShowSafe(State.options.showSafe);
updateLabels();
render();
