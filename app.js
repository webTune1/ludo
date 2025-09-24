(() => {
  // =============== Elements ===============
  const board = document.getElementById('board');
  const ctx = board.getContext('2d');

  const nameInput = document.getElementById('nameInput');
  const localBtn = document.getElementById('localBtn');
  const aiBtn = document.getElementById('aiBtn');
  const themeBtn = document.getElementById('themeBtn');

  const rollBtn = document.getElementById('rollBtn');
  const diceBadge = document.getElementById('diceBadge');
  const turnBadge = document.getElementById('turnBadge');

  const modeLbl = document.getElementById('modeLbl');
  const playersLbl = document.getElementById('playersLbl');
  const turnLbl = document.getElementById('turnLbl');

  const restartBtn = document.getElementById('restartBtn');
  const soundsChk = document.getElementById('soundsChk');
  const blockChk = document.getElementById('blockChk');
  const status = document.getElementById('status');

  // =============== Theme ===============
  themeBtn.addEventListener('click', () => {
    const light = document.body.getAttribute('data-theme') === 'light';
    document.body.setAttribute('data-theme', light ? 'dark' : 'light');
  });

  // =============== Geometry & Board ===============
  let geom = null;
  function setupCanvas(){
    const pad = 16;
    const rect = board.parentElement.getBoundingClientRect();
    board.width = Math.floor(rect.width * devicePixelRatio);
    board.height = Math.floor(rect.height * devicePixelRatio);
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);

    const W = rect.width, H = rect.height;
    const S = Math.min(W,H) - pad*2;         // square area for the board
    const ox = (W - S)/2, oy = (H - S)/2;    // origin
    const n = 15;                             // 15x15 grid
    const t = S / n;                          // tile size
    geom = { W,H,S, ox,oy, n,t };
  }
  setupCanvas();
  window.addEventListener('resize', ()=> { const snap = snapshot(); setupCanvas(); restore(snap); render(); });

  function snapshot(){ try{ return ctx.getImageData(0,0,board.width,board.height); }catch(e){ return null; } }
  function restore(img){ if(img) ctx.putImageData(img,0,0); }

  function gx(c){ return geom.ox + c*geom.t; }
  function gy(r){ return geom.oy + r*geom.t; }

  // =============== Game Model ===============
  const MODE = { LOCAL:'Local', AI:'AI' };
  const COLORS = ['#2fbe3a','#f5c400','#1e88e5','#e53935']; // G, Y, B, R
  const COLORNAMES = ['Green', 'Yellow', 'Blue', 'Red'];

  const state = {
    mode: null,
    players: [], // [{id,name,color,isAI}]
    pieces: {},  // id -> [steps,steps,steps,steps] (-1..57)
    turnIndex: 0,
    dice: null,
    canRoll: true,
    chain6: 0,
    winner: null,
  };

  // Path (52) + home lanes (6). We use a loop around the board with 52 points,
  // then 6 steps into center for each color. Tokens snap to those coordinates.
  // This keeps logic clean & performs well, while the board still looks clearly Ludo.
  let path = [];      // 52 track coordinates (pixel)
  let home = [[],[],[],[]]; // 4 arrays of 6 coordinates into center
  let base = [[],[],[],[]]; // 4 base parking spots (4 each)

  function computePath(){
    const {S, ox, oy, t} = geom;
    path = [];
    const margin = t; // inset a bit from the board edge
    const left = ox + margin, right = ox + S - margin;
    const top  = oy + margin, bottom = oy + S - margin;

    // Build a smooth rectangular loop of 52 points (13 per side)
    const per = 13;
    for(let i=0;i<per;i++){  // top L->R
      const u = i/(per-1); path.push({ x: lerp(left, right, u), y: top });
    }
    for(let i=1;i<per;i++){  // right T->B
      const u = i/(per-1); path.push({ x: right, y: lerp(top, bottom, u) });
    }
    for(let i=1;i<per;i++){  // bottom R->L
      const u = i/(per-1); path.push({ x: lerp(right, left, u), y: bottom });
    }
    for(let i=1;i<per-1;i++){ // left B->T
      const u = i/(per-1); path.push({ x: left, y: lerp(bottom, top, u) });
    }
    // Home lanes into center (6 steps each), starting from each color's start tile (0,13,26,39)
    const cx = ox + S/2, cy = oy + S/2;
    const r = t*0.9;
    home = [0,1,2,3].map(p=>{
      const entry = path[p*13];
      const v = norm({ x: cx - entry.x, y: cy - entry.y });
      const lanes = [];
      for(let k=1;k<=6;k++){
        lanes.push({ x: entry.x + v.x * t * k * 1.25, y: entry.y + v.y * t * k * 1.25 });
      }
      return lanes;
    });

    // Base spots (corners)
    const g = { x: gx(3),  y: gy(3)  };   // Green TL
    const y = { x: gx(12), y: gy(3)  };   // Yellow TR
    const b = { x: gx(12), y: gy(12) };   // Blue BR
    const r = { x: gx(3),  y: gy(12) };   // Red BL
    base = [
      makeBaseSpots(g, t*1.4),
      makeBaseSpots(y, t*1.4),
      makeBaseSpots(b, t*1.4),
      makeBaseSpots(r, t*1.4),
    ];
  }
  function makeBaseSpots(c, d){
    return [
      {x:c.x-d, y:c.y-d},{x:c.x+d, y:c.y-d},{x:c.x-d, y:c.y+d},{x:c.x+d, y:c.y+d}
    ];
  }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function norm(v){ const m = Math.hypot(v.x,v.y)||1; return {x:v.x/m,y:v.y/m}; }

  computePath();

  // =============== Rendering (Ludo theme UI) ===============
  function render(){
    const {W,H, ox,oy,S,t} = geom;
    ctx.clearRect(0,0,W,H);

    // Board background
    roundRect(ox,oy,S,S,16);
    ctx.fillStyle = getCss('--panel'); ctx.fill();

    // Corners (homes)
    drawHome(ox,oy,S/2,S/2, '#2fbe3a');          // Green (TL)
    drawHome(ox+S/2,oy,S/2,S/2, '#f5c400');      // Yellow (TR)
    drawHome(ox+S/2,oy+S/2,S/2,S/2, '#1e88e5');  // Blue (BR)
    drawHome(ox,oy+S/2,S/2,S/2, '#e53935');      // Red (BL)

    // Center star
    drawCenterStar();

    // Start circles (entry/safe)
    const rNode = Math.max(6, t*0.35);
    [0,1,2,3].forEach(p=>{
      const c = path[p*13];
      ctx.beginPath(); ctx.arc(c.x, c.y, rNode, 0, Math.PI*2);
      ctx.fillStyle = hexA(COLORS[p], 0.85); ctx.fill();
      ctx.lineWidth=2; ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.stroke();
    });

    // Tokens
    const occ = occupancy();
    for(const P of state.players){
      const pcs = state.pieces[P.id];
      for(let k=0;k<4;k++){
        const pos = coordFor(P.color, pcs[k], k);
        drawToken(pos.x, pos.y, P.color, state.selected && state.selected.playerId===P.id && state.selected.pieceIdx===k);
      }
    }

    // HUD
    const T = state.players[state.turnIndex];
    turnBadge.innerHTML = state.winner
      ? `🏆 ${state.winner.name} wins!`
      : (T ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLORS[T.color]};margin-right:6px"></span>Turn: <b>${T.name}</b>` : '—');
    diceBadge.textContent = state.dice ?? '—';
    modeLbl.textContent = state.mode || '—';
    playersLbl.textContent = state.players.map(p=>p.name).join(', ') || '—';
    turnLbl.textContent = T ? T.name : '—';
  }

  function drawHome(x,y,w,h,color){
    // Fill
    ctx.save();
    ctx.fillStyle = hexA(color, .2);
    roundRect(x,y,w,h,12); ctx.fill();
    // Yard circle
    ctx.strokeStyle = hexA(color, .8); ctx.lineWidth = 3;
    ctx.strokeRect(x+10,y+10,w-20,h-20);
    ctx.restore();
  }

  function drawCenterStar(){
    const {ox,oy,S,t} = geom;
    const cx = ox + S/2, cy = oy + S/2;
    const r = t*2.1;

    ctx.save();
    ctx.lineWidth = 2;
    // Triangles pointing to each color home
    drawTri(cx,cy, cx-r,cy, '#2fbe3a');
    drawTri(cx,cy, cx+r,cy, '#f5c400');
    drawTri(cx,cy, cx,cy+r, '#1e88e5');
    drawTri(cx,cy, cx,cy-r, '#e53935');
    ctx.restore();
  }
  function drawTri(x1,y1,x2,y2,color){
    const midx = (x1+x2)/2, midy = (y1+y2)/2;
    const dx = x2-x1, dy=y2-y1;
    const nx = -dy, ny = dx;
    const f = 0.6;
    ctx.beginPath();
    ctx.moveTo(x1,y1);
    ctx.lineTo(x2,y2);
    ctx.lineTo(midx + nx*f, midy + ny*f);
    ctx.closePath();
    ctx.fillStyle = hexA(color, .65);
    ctx.fill();
    ctx.strokeStyle = hexA(color, .9);
    ctx.stroke();
  }

  function roundRect(x,y,w,h,r){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr,y);
    ctx.arcTo(x+w,y,x+w,y+h,rr);
    ctx.arcTo(x+w,y+h,x,y+h,rr);
    ctx.arcTo(x,y+h,x,y,rr);
    ctx.arcTo(x,y,x+w,y,rr);
    ctx.closePath();
  }

  function drawToken(x,y,colorIdx, selected){
    const {t} = geom;
    const R = Math.max(10, t*0.45);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 6;
    // body
    ctx.beginPath(); ctx.arc(x,y,R,0,Math.PI*2);
    ctx.fillStyle = COLORS[colorIdx]; ctx.fill();
    // glossy
    const grad = ctx.createRadialGradient(x-R*0.5,y-R*0.5, R*0.1, x,y,R);
    grad.addColorStop(0,'rgba(255,255,255,.8)');
    grad.addColorStop(1,'rgba(255,255,255,0)');
    ctx.beginPath(); ctx.arc(x,y,R*0.85,0,Math.PI*2); ctx.fillStyle = grad; ctx.fill();
    // stroke
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
    // selection
    if(selected){
      ctx.beginPath(); ctx.arc(x,y,R+4,0,Math.PI*2);
      ctx.strokeStyle = getCss('--accent'); ctx.lineWidth = 3; ctx.stroke();
    }
    ctx.restore();
  }

  function hexA(hex,a){
    const c = hex.replace('#','');
    const r=parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }
  function getCss(v){ return getComputedStyle(document.body).getPropertyValue(v).trim(); }

  // =============== Rules / Positions ===============
  function coordFor(color, steps, kIdx){
    if(steps < 0){
      return base[color][kIdx];
    }
    if(steps <= 51){
      const idx = (color*13 + steps) % 52;
      return path[idx];
    }
    if(steps <= 57){
      return home[color][steps-52];
    }
    return home[color][5];
  }

  // =============== Game Management ===============
  function setupMatch(mode, players){
    state.mode = mode;
    state.players = players;
    state.pieces = {};
    for(const p of players) state.pieces[p.id] = [-1,-1,-1,-1];
    state.turnIndex = 0;
    state.dice = null;
    state.canRoll = true;
    state.chain6 = 0;
    state.winner = null;
    status.textContent = `New ${mode} match`;
    render();
    maybeAI();
  }

  localBtn.addEventListener('click', async ()=>{
    const n = clamp(parseInt(prompt('How many players? (2–4)','2')||'2',10),2,4);
    const arr = [];
    for(let i=0;i<n;i++){
      const def = i===0 ? (nameInput.value.trim() || 'You') : `Player ${i+1}`;
      const name = prompt(`Name for Player ${i+1} (${COLORNAMES[i]})`, def) || def;
      arr.push({ id:'P'+i, name, color:i });
    }
    setupMatch(MODE.LOCAL, arr);
  });

  aiBtn.addEventListener('click', ()=>{
    const me = nameInput.value.trim() || 'You';
    const players = [
      { id:'P0', name: me, color: 0 },
      { id:'P1', name: 'AI', color: 2, isAI:true }
    ];
    setupMatch(MODE.AI, players);
  });

  restartBtn.addEventListener('click', ()=>{
    if(!state.mode) return;
    const players = state.players.map(p => ({...p}));
    setupMatch(state.mode, players);
  });

  // =============== Turn / Dice / Moves ===============
  rollBtn.addEventListener('click', ()=>{
    if(state.winner) return;
    if(!state.canRoll) return;
    const cur = state.players[state.turnIndex];
    if(!cur) return;
    const d = 1 + Math.floor(Math.random()*6);
    state.dice = d; state.canRoll=false; diceBadge.textContent = d;
    const moves = legalMoves(cur, d);
    if(moves.length===0){
      status.textContent = `${cur.name} has no moves.`;
      if(d===6){
        state.chain6++;
        if(state.chain6>=3){ state.chain6=0; state.dice=null; nextTurn(); }
        else { state.dice=null; state.canRoll=true; maybeAI(); }
      }else{
        state.chain6=0; state.dice=null; nextTurn();
      }
    }else{
      render();
      maybeAI();
    }
  });

  board.addEventListener('click', (e)=>{
    if(state.winner) return;
    const rect = board.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const cur = state.players[state.turnIndex];
    if(!cur || cur.isAI) return;
    if(state.dice===null){ pulse(rollBtn); return; }
    const idx = pickPiece(cur, x,y);
    if(idx<0) return;
    tryMove(cur, idx, state.dice);
  });

  function pickPiece(P, x,y){
    const pcs = state.pieces[P.id];
    const R = Math.max(10, geom.t*0.45);
    for(let i=0;i<4;i++){
      const c = coordFor(P.color, pcs[i], i);
      if(Math.hypot(c.x-x,c.y-y) <= R*1.2) return i;
    }
    return -1;
  }

  function legalMoves(P, dice){
    const pcs = state.pieces[P.id];
    const mv = [];
    for(let i=0;i<4;i++){
      const s = pcs[i];
      if(s===57) continue;
      if(s<0){
        if(dice===6 && !blockedOnEnter(P)) mv.push({piece:i, from:s, to:0});
        continue;
      }
      const to = s + dice;
      if(to>57) continue;
      if(to<=51 && pathBlocked(P, s, to)) continue;
      mv.push({piece:i, from:s, to});
    }
    return mv;
  }

  function blockedOnEnter(P){
    if(!blockChk.checked) return false;
    // if start tile has two of own tokens
    const idx = (P.color*13) % 52;
    const occ = occupancy()['T'+idx];
    return occ && (occ.owners[P.id]||0)>=2;
  }

  function pathBlocked(P, from, to){
    if(!blockChk.checked) return false;
    for(let s=from+1;s<=to;s++){
      const ti = (P.color*13 + s) % 52;
      const occ = occupancy()['T'+ti];
      if(occ){
        for(const [,cnt] of Object.entries(occ.owners)){ if(cnt>=2) return true; }
      }
    }
    return false;
  }

  function tryMove(P, kIdx, dice){
    const mv = legalMoves(P, dice).find(m=> m.piece===kIdx);
    if(!mv){ status.textContent = 'Illegal move.'; return false; }
    applyMove(P, mv);
    if(dice===6){
      state.chain6++;
      if(state.chain6>=3){ state.chain6=0; state.dice=null; nextTurn(); }
      else { state.dice=null; state.canRoll=true; render(); maybeAI(); }
    }else{
      state.chain6=0; state.dice=null; nextTurn();
    }
    return true;
  }

  function applyMove(P, m){
    const pcs = state.pieces[P.id];
    pcs[m.piece] = m.to;

    // Capture on landing (not on safe starts)
    if(m.to<=51){
      const lidx = (P.color*13 + m.to) % 52;
      const safe = [0,13,26,39].includes(lidx);
      if(!safe){
        for(const E of state.players){
          if(E.id===P.id) continue;
          const ep = state.pieces[E.id];
          for(let i=0;i<4;i++){
            const s = ep[i];
            if(s<0 || s===57) continue;
            const eidx = (E.color*13 + s) % 52;
            if(eidx===lidx){
              ep[i] = -1; // send to base
              if(soundsChk.checked) beep(640, 70);
            }
          }
        }
      }
    }
    // Finished?
    if(state.pieces[P.id].every(s=> s===57)){
      state.winner = P;
      if(soundsChk.checked) beep(880, 200);
    }else{
      if(soundsChk.checked) beep(420, 50);
    }
    render();
  }

  function occupancy(){
    const map = {};
    for(const P of state.players){
      const arr = state.pieces[P.id];
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

  function nextTurn(){
    if(state.winner){ render(); return; }
    state.turnIndex = (state.turnIndex+1) % state.players.length;
    state.canRoll = true; render(); maybeAI();
  }

  // =============== AI ===============
  function maybeAI(){
    const P = state.players[state.turnIndex];
    if(!P || !P.isAI || state.winner) return;

    if(state.dice===null){
      setTimeout(()=> rollBtn.click(), 500);
      return;
    }
    setTimeout(()=>{
      const moves = legalMoves(P, state.dice);
      if(moves.length===0) return;
      const best = moves.map(m=> ({m, score: scoreMove(P,m)}))
                        .sort((a,b)=> b.score-a.score)[0];
      tryMove(P, best.m.piece, state.dice);
    }, 600);
  }
  function scoreMove(P,m){
    let s = 0;
    if(m.to===57) s+=1000;
    if(m.from<=51 && m.to>51) s+=200;
    if(m.to<=51){ // capture chance
      const tile = (P.color*13 + m.to) % 52;
      for(const E of state.players) if(E.id!==P.id){
        const arr = state.pieces[E.id];
        for(const st of arr) if(st>=0 && st<=51){
          const e = (E.color*13 + st) % 52;
          if(e===tile) s+=500;
        }
      }
      s += m.to*2; // progress
      // danger
      for(const E of state.players) if(E.id!==P.id){
        for(let d=1; d<=6; d++){
          for(let i=0;i<4;i++){
            const st = state.pieces[E.id][i];
            if(st<0 || st===57) continue;
            const to = st + d; if(to>57) continue;
            if(to<=51){
              const eTile = (E.color*13 + to) % 52;
              if(eTile===tile) s -= 60;
            }
          }
        }
      }
    }
    return s;
  }

  // =============== Board Input utils ===============
  function pulse(el){ el.style.transform='scale(1.05)'; setTimeout(()=> el.style.transform='', 140); }

  // Simple beeps (no external assets)
  let ac = null;
  function beep(freq=440, dur=60){
    try{
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(); const g = ac.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      o.connect(g); g.connect(ac.destination);
      g.gain.value = 0.06; o.start();
      setTimeout(()=>{ g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime+dur/1000); o.stop(ac.currentTime+dur/1000); }, 10);
    }catch(e){}
  }

  // =============== Init ===============
  render();

})();
