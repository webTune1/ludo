(() => {
  // ======= Elements =======
  const board = document.getElementById('board');
  const ctx = board.getContext('2d');

  const nameInput = document.getElementById('nameInput');
  const enableBtn = document.getElementById('enableBtn');
  const createRoomBtn = document.getElementById('createRoomBtn');
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  const leaveBtn = document.getElementById('leaveBtn');
  const themeBtn = document.getElementById('themeBtn');

  const rollBtn = document.getElementById('rollBtn');
  const diceBadge = document.getElementById('diceBadge');
  const turnBadge = document.getElementById('turnBadge');
  const roomBadge = document.getElementById('roomBadge');
  const overlayMsg = document.getElementById('overlayMsg');

  const statusLbl = document.getElementById('statusLbl');
  const meLbl = document.getElementById('meLbl');
  const opLbl = document.getElementById('opLbl');
  const roomLbl = document.getElementById('roomLbl');
  const resetBtn = document.getElementById('resetBtn');
  const soundsChk = document.getElementById('soundsChk');

  // ======= Theme =======
  themeBtn.addEventListener('click', () => {
    const light = document.body.getAttribute('data-theme') === 'light';
    document.body.setAttribute('data-theme', light ? 'dark' : 'light');
  });

  // ======= Firebase bootstrap =======
  let FB = { app:null, auth:null, db:null, uid:null, name:null, connected:false };
  function assertConfig(){
    if(!window.firebaseConfig || !window.firebaseConfig.apiKey){
      alert('Please open firebase-config.js and paste your Firebase config.');
      throw new Error('Missing firebaseConfig');
    }
  }

  // ======= Online enable =======
  enableBtn.addEventListener('click', async ()=>{
    try{
      const name = (nameInput.value || '').trim();
      if(!name) return alert('Enter your name first.');
      assertConfig();

      FB.app = firebase.initializeApp(firebaseConfig);
      FB.auth = firebase.auth();
      FB.db = firebase.database();
      const cred = await FB.auth.signInAnonymously();
      FB.uid = cred.user.uid; FB.name = name; FB.connected = true;

      statusLbl.textContent = 'Online';
      enableBtn.disabled = true;
      createRoomBtn.disabled = false;
      leaveBtn.disabled = false;

      // Presence (optional)
      const presenceRef = FB.db.ref('.info/connected');
      const meRef = FB.db.ref('presence/'+FB.uid);
      presenceRef.on('value', snap=>{
        if(snap.val()){
          meRef.onDisconnect().remove();
          meRef.set({ uid: FB.uid, name: FB.name, ts: Date.now() });
        }
      });
      meRef.update({ name: FB.name });

      meLbl.textContent = `${FB.name}`;

      // If URL has room, join
      const params = new URLSearchParams(location.search);
      const room = params.get('room');
      if(room) {
        await joinRoom(room);
      }
    }catch(e){
      console.error(e);
      alert('Failed to enable online: '+e.message);
    }
  });

  // ======= Room management =======
  let roomId = null;
  let roomRef = null;
  let unsubRoom = null;

  createRoomBtn.addEventListener('click', async ()=>{
    if(!FB.connected) return;
    const id = genId('room');
    await createRoom(id);
    await joinRoom(id);
    copyLinkBtn.disabled = false;
    updateLinkUI();
  });

  copyLinkBtn.addEventListener('click', ()=>{
    const url = makeRoomLink(roomId);
    navigator.clipboard.writeText(url).then(()=> {
      copyLinkBtn.textContent = 'Copied!';
      setTimeout(()=> copyLinkBtn.textContent = 'Copy Link', 1200);
    });
  });

  leaveBtn.addEventListener('click', async ()=>{
    await leaveRoom();
  });

  resetBtn.addEventListener('click', async ()=>{
    if(!roomId) return;
    // Only allow reset if there are 2 players
    const snap = await FB.db.ref('rooms/'+roomId).get();
    if(!snap.exists()) return;
    const R = snap.val();
    if(Object.keys(R.players||{}).length < 2){ alert('Need opponent to start.'); return; }
    await FB.db.ref('rooms/'+roomId).update({
      status: 'active',
      turnIndex: 0,
      dice: null,
      chain6: 0,
      state: JSON.stringify(defaultGameState(R.players))
    });
  });

  function makeRoomLink(id){
    const base = location.origin + location.pathname.replace(/index\.html$/i,'');
    return base + '?room=' + id;
  }
  function updateLinkUI(){
    const url = roomId ? makeRoomLink(roomId) : '—';
    roomLbl.textContent = roomId || '—';
    roomBadge.textContent = `Room: ${roomId || '—'}`;
    copyLinkBtn.disabled = !roomId;
  }

  async function createRoom(id){
    const ref = FB.db.ref('rooms/'+id);
    const hostColor = 0;      // Green
    await ref.set({
      createdAt: Date.now(),
      status: 'waiting',
      players: {
        [FB.uid]: { uid:FB.uid, name:FB.name, color:hostColor }
      },
      turnIndex: 0,
      dice: null,
      chain6: 0,
      state: null
    });
  }

  async function joinRoom(id){
    roomId = id; updateLinkUI();
    roomRef = FB.db.ref('rooms/'+roomId);

    const snap = await roomRef.get();
    if(!snap.exists()){ alert('Room not found.'); roomId=null; updateLinkUI(); return; }
    const R = snap.val();

    // Add me if not in players
    const players = R.players || {};
    if(!players[FB.uid]){
      // assign second color = Red(3)
      let color = 3;
      // If Green taken, give Red; if Red taken, give Blue (fallback)
      const used = new Set(Object.values(players).map(p=> p.color));
      if(used.has(3) && !used.has(2)) color = 2;
      await roomRef.child('players/'+FB.uid).set({ uid:FB.uid, name:FB.name, color });
    }

    // Activate when >=2 players and no state
    const snap2 = await roomRef.get();
    const R2 = snap2.val();
    const count = Object.keys(R2.players||{}).length;
    if(count>=2 && !R2.state){
      await roomRef.update({
        status: 'active',
        turnIndex: 0,
        dice: null,
        chain6: 0,
        state: JSON.stringify(defaultGameState(R2.players))
      });
    }else{
      await roomRef.update({ status: count>=2 ? 'active' : 'waiting' });
    }

    // Subscribe to updates
    if(unsubRoom){ roomRef.off('value', unsubRoom); }
    unsubRoom = roomRef.on('value', (s)=>{
      const data = s.val(); if(!data) return;
      applyServer(data);
    });

    overlayMsg.classList.toggle('hidden', false);
    rollBtn.disabled = true;
    resetBtn.disabled = false;
  }

  async function leaveRoom(){
    if(!roomId) return;
    try{
      // Remove me from players
      await FB.db.ref(`rooms/${roomId}/players/${FB.uid}`).remove();
      // If room empty, remove it
      const ps = (await FB.db.ref(`rooms/${roomId}/players`).get()).val() || {};
      if(Object.keys(ps).length===0){
        await FB.db.ref(`rooms/${roomId}`).remove();
      }
    }catch{}
    // Unsub
    if(roomRef && unsubRoom){ roomRef.off('value', unsubRoom); }
    roomRef = null; roomId = null; unsubRoom=null;
    roomLbl.textContent = '—'; roomBadge.textContent = 'Room: —';
    rollBtn.disabled = true; resetBtn.disabled = true; copyLinkBtn.disabled = true;
    opLbl.textContent = '—';
    overlayMsg.classList.add('hidden');
    statusLbl.textContent = 'Online';
    // Reset local
    state.players = []; state.pieces={}; state.turnIndex=0; state.dice=null; state.winner=null;
    render();
  }

  // ======= Game model =======
  const COLORS = ['#2fbe3a','#f5c400','#1e88e5','#e53935']; // G,Y,B,R
  const COLORNAMES = ['Green','Yellow','Blue','Red'];

  const state = {
    players: [], // [{uid,name,color}]
    pieces: {},  // uid -> [steps,steps,steps,steps] (-1..57)
    turnIndex: 0,
    dice: null,
    chain6: 0,
    winner: null, // uid
  };

  function defaultGameState(playersObj){
    const ids = Object.keys(playersObj);
    const pieces = {};
    ids.forEach(uid => { pieces[uid] = [-1,-1,-1,-1]; });
    return { pieces, winner:null };
  }

  function myPlayer(){ return state.players.find(p=> p.uid===FB.uid); }
  function opponent(){ return state.players.find(p=> p.uid!==FB.uid); }
  function isMyTurn(){
    const cur = state.players[state.turnIndex];
    return !!cur && cur.uid === FB.uid && !state.winner;
  }

  // ======= Geometry / Board =======
  let geom = null, path=[], home=[[],[],[],[]], base=[[],[],[],[]];

  function setupCanvas(){
    const pad = 16;
    const rect = board.parentElement.getBoundingClientRect();
    board.width = Math.floor(rect.width * devicePixelRatio);
    board.height = Math.floor(rect.height * devicePixelRatio);
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);

    const W = rect.width, H = rect.height;
    const S = Math.min(W,H) - pad*2;
    const ox = (W - S)/2, oy = (H - S)/2;
    const n = 15, t = S / n;
    geom = { W,H,S,ox,oy,n,t };
  }
  setupCanvas();
  window.addEventListener('resize', ()=>{ const snap = snapshot(); setupCanvas(); computePath(); restore(snap); render(); });

  function snapshot(){ try{ return ctx.getImageData(0,0,board.width,board.height); }catch(e){ return null; } }
  function restore(img){ if(img) ctx.putImageData(img,0,0); }
  function gx(c){ return geom.ox + c*geom.t; }
  function gy(r){ return geom.oy + r*geom.t; }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function norm(v){ const m = Math.hypot(v.x,v.y)||1; return {x:v.x/m,y:v.y/m}; }

  function computePath(){
    const {S, ox, oy, t} = geom;
    path = [];
    const margin = t; 
    const left = ox + margin, right = ox + S - margin;
    const top  = oy + margin, bottom = oy + S - margin;
    const per = 13;
    for(let i=0;i<per;i++){ path.push({ x: lerp(left, right, i/(per-1)), y: top }); }
    for(let i=1;i<per;i++){ path.push({ x: right, y: lerp(top, bottom, i/(per-1)) }); }
    for(let i=1;i<per;i++){ path.push({ x: lerp(right, left, i/(per-1)), y: bottom }); }
    for(let i=1;i<per-1;i++){ path.push({ x: left, y: lerp(bottom, top, i/(per-1)) }); }

    const cx = ox + S/2, cy = oy + S/2;
    home = [0,1,2,3].map(p=>{
      const entry = path[p*13];
      const v = norm({ x: cx - entry.x, y: cy - entry.y });
      const lanes = [];
      for(let k=1;k<=6;k++){
        lanes.push({ x: entry.x + v.x * t * k * 1.25, y: entry.y + v.y * t * k * 1.25 });
      }
      return lanes;
    });

    // Base centers
    const g = { x: gx(3),  y: gy(3)  };
    const y = { x: gx(12), y: gy(3)  };
    const b = { x: gx(12), y: gy(12) };
    const r = { x: gx(3),  y: gy(12) };
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
  computePath();

  // ======= Rendering =======
  function render(){
    const {W,H, ox,oy,S,t} = geom;
    ctx.clearRect(0,0,W,H);

    // Board bg
    roundRect(ox,oy,S,S,16); ctx.fillStyle = getCss('--panel'); ctx.fill();

    // Homes
    drawHome(ox,oy,S/2,S/2, '#2fbe3a');          // Green TL
    drawHome(ox+S/2,oy,S/2,S/2, '#f5c400');      // Yellow TR
    drawHome(ox+S/2,oy+S/2,S/2,S/2, '#1e88e5');  // Blue BR
    drawHome(ox,oy+S/2,S/2,S/2, '#e53935');      // Red BL

    // Center star
    drawCenterStar();

    // Safe start circles
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
      const pcs = state.pieces[P.uid] || [-1,-1,-1,-1];
      for(let k=0;k<4;k++){
        const pos = coordFor(P.color, pcs[k], k);
        drawToken(pos.x, pos.y, P.color);
      }
    }

    // HUD
    roomBadge.textContent = `Room: ${roomId || '—'}`;
    const cur = state.players[state.turnIndex];
    turnBadge.innerHTML = state.winner
      ? `🏆 ${nameOfUid(state.winner)} wins!`
      : (cur ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLORS[cur.color]};margin-right:6px"></span>Turn: <b>${cur.name}</b>` : '—');
    diceBadge.textContent = state.dice ?? '—';

    // Side labels
    const me = myPlayer(), op = opponent();
    meLbl.textContent = me ? `${me.name} (${COLORNAMES[me.color]})` : '—';
    opLbl.textContent = op ? `${op.name} (${COLORNAMES[op.color]})` : '—';
  }

  function drawHome(x,y,w,h,color){
    ctx.save();
    ctx.fillStyle = hexA(color, .2);
    roundRect(x,y,w,h,12); ctx.fill();
    ctx.strokeStyle = hexA(color, .8); ctx.lineWidth = 3;
    ctx.strokeRect(x+10,y+10,w-20,h-20);
    ctx.restore();
  }
  function drawCenterStar(){
    const {ox,oy,S,t} = geom;
    const cx = ox + S/2, cy = oy + S/2;
    const r = t*2.1;
    drawTri(cx,cy, cx-r,cy, '#2fbe3a');
    drawTri(cx,cy, cx+r,cy, '#f5c400');
    drawTri(cx,cy, cx,cy+r, '#1e88e5');
    drawTri(cx,cy, cx,cy-r, '#e53935');
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
  function drawToken(x,y,colorIdx){
    const R = Math.max(10, geom.t*0.45);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(x,y,R,0,Math.PI*2);
    ctx.fillStyle = COLORS[colorIdx]; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
    ctx.restore();
  }
  function getCss(v){ return getComputedStyle(document.body).getPropertyValue(v).trim(); }
  function hexA(hex,a){
    const c = hex.replace('#','');
    const r=parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ======= Coordinates & Rules =======
  function coordFor(colorIdx, steps, kIdx){
    if(steps < 0)  return base[colorIdx][kIdx];
    if(steps <= 51){
      const idx = (colorIdx*13 + steps) % 52;
      return path[idx];
    }
    if(steps <= 57) return home[colorIdx][steps-52];
    return home[colorIdx][5];
  }

  function occupancy(){
    const map = {};
    for(const P of state.players){
      const arr = state.pieces[P.uid] || [-1,-1,-1,-1];
      for(let k=0;k<4;k++){
        const s = arr[k];
        if(s<0 || s===57) continue;
        if(s<=51){
          const idx = (P.color*13 + s) % 52;
          const key = 'T'+idx;
          map[key] = map[key] || {count:0, owners:{}};
          map[key].count++; map[key].owners[P.uid]=(map[key].owners[P.uid]||0)+1;
        }else{
          const key = 'H'+P.color+'-'+(s-52);
          map[key] = map[key] || {count:0, owners:{}};
          map[key].count++; map[key].owners[P.uid]=(map[key].owners[P.uid]||0)+1;
        }
      }
    }
    return map;
  }

  function legalMoves(P, dice){
    const pcs = state.pieces[P.uid] || [-1,-1,-1,-1];
    const mv = [];
    for(let i=0;i<4;i++){
      const s = pcs[i];
      if(s===57) continue;
      if(s<0){ if(dice===6) mv.push({piece:i, from:s, to:0}); continue; }
      const to = s + dice; if(to>57) continue;
      mv.push({piece:i, from:s, to});
    }
    return mv;
  }

  function applyMove(P, m){
    const pcs = state.pieces[P.uid];
    pcs[m.piece] = m.to;

    // Capture on landing if on track and not on safe entry tiles
    if(m.to<=51){
      const lidx = (P.color*13 + m.to) % 52;
      const safe = [0,13,26,39].includes(lidx);
      if(!safe){
        for(const E of state.players){
          if(E.uid===P.uid) continue;
          const ep = state.pieces[E.uid];
          for(let i=0;i<4;i++){
            const s = ep[i];
            if(s<0 || s===57) continue;
            const eidx = (E.color*13 + s) % 52;
            if(eidx===lidx) ep[i] = -1; // send back to base
          }
        }
      }
    }
    // Win check
    if( (state.pieces[P.uid]||[]).every(s=> s===57) ){
      state.winner = P.uid;
    }
  }

  // ======= Turn & Dice (Online-safe) =======
  rollBtn.addEventListener('click', async ()=>{
    if(!isMyTurn() || state.dice!==null || state.winner) return;
    const d = 1 + Math.floor(Math.random()*6);
    await pushRoomPatch({ dice: d });
  });

  board.addEventListener('click', async (e)=>{
    if(!isMyTurn() || state.dice===null || state.winner) return;
    const rect = board.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;

    const me = myPlayer(); if(!me) return;
    const pcs = state.pieces[me.uid];
    const R = Math.max(10, geom.t*0.45);

    let pick = -1;
    for(let i=0;i<4;i++){
      const c = coordFor(me.color, pcs[i], i);
      if(Math.hypot(c.x-x,c.y-y) <= R*1.2){ pick = i; break; }
    }
    if(pick<0) return;

    // Calculate legal move server-side-ish (we recompute locally and push)
    const moves = legalMoves(me, state.dice);
    const mv = moves.find(m=> m.piece===pick);
    if(!mv) return;

    // Apply locally then push to server
    const snapshot = deepClone({ state });
    const myPieces = deepClone(state.pieces);
    applyMove(me, mv);

    let nextTurnIndex = state.turnIndex;
    let nextDice = null;
    let nextChain = state.chain6;

    if(state.dice===6){
      nextChain++;
      if(nextChain>=3){ nextChain=0; nextTurnIndex = (state.turnIndex+1)%state.players.length; }
      else { nextDice = null; /* same turn continues */ }
    }else{
      nextChain=0; nextTurnIndex = (state.turnIndex+1)%state.players.length;
    }

    // Push to server
    await pushRoomPatch({
      state: JSON.stringify({ pieces: state.pieces, winner: state.winner || null }),
      turnIndex: nextTurnIndex,
      dice: nextDice,
      chain6: nextChain
    });

    // Sounds
    if(soundsChk.checked){
      if(state.winner) beep(880, 220); else beep(420, 70);
    }
  });

  function deepClone(o){ return JSON.parse(JSON.stringify(o)); }

  async function pushRoomPatch(patch){
    if(!roomRef) return;
    try{ await roomRef.update(patch); }catch(e){ console.error(e); }
  }

  // ======= Server → Client state =======
  function applyServer(R){
    // Players (sorted by color for deterministic order)
    const list = Object.values(R.players || {}).sort((a,b)=> a.color-b.color);
    state.players = list.map(p=> ({ uid:p.uid, name:p.name, color:p.color }));

    // Game core
    state.turnIndex = R.turnIndex || 0;
    state.dice = (R.dice===null || R.dice===undefined) ? null : R.dice;
    state.chain6 = R.chain6 || 0;

    // Decode pieces/winner
    if(R.state){
      try{
        const st = JSON.parse(R.state);
        state.pieces = st.pieces || {};
        state.winner = st.winner || null;
      }catch{
        // if invalid, reinit when possible
        if(state.players.length>=2){
          state.pieces = defaultGameState(mapByUid(state.players)).pieces;
          state.winner = null;
        }
      }
    }else{
      // Waiting state
      if(state.players.length>=2){
        state.pieces = defaultGameState(mapByUid(state.players)).pieces;
        state.winner = null;
      }
    }

    // UI: waiting overlay / controls
    const twoReady = state.players.length>=2 && R.status==='active';
    overlayMsg.classList.toggle('hidden', twoReady);
    rollBtn.disabled = !twoReady || !isMyTurn() || state.winner || state.dice!==null? true:false;
    statusLbl.textContent = twoReady ? 'In match' : (roomId ? 'Waiting' : 'Online');

    render();
  }

  function mapByUid(arr){ const o={}; arr.forEach(p=> o[p.uid]=p); return o; }
  function nameOfUid(uid){ const p = state.players.find(x=>x.uid===uid); return p ? p.name : 'Player'; }

  // ======= Sounds =======
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

  // ======= Helpers =======
  function genId(prefix){ return prefix + '_' + Math.random().toString(36).slice(2,10); }

  // ======= Board click (prevent default context menu) =======
  board.addEventListener('contextmenu', e=> e.preventDefault());

  // ======= Geometry helpers =======
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

  // Initial render
  render();

})();
