// Dashboard dark + Chart.js + Tooltips + Tendência (regressão linear) com score e tempo gráfico
// Permite trocar o tipo de gráfico: Linha, Área, Barra

// --------- UI refs ---------
const $price = document.getElementById('price');
const $peak = document.getElementById('peak');
const $peakAge = document.getElementById('peakAge');
const $drawdown = document.getElementById('drawdown');
const $lastAlert = document.getElementById('lastAlert');
const $events = document.getElementById('events');

const $minThreshold = document.getElementById('minThreshold');
const $maxThreshold = document.getElementById('maxThreshold');
const $resetWindow = document.getElementById('resetWindow');
const $symbolInput = document.getElementById('symbol');

const $apply = document.getElementById('apply');
const $resetPeakBtn = document.getElementById('resetPeak');
const $muteBtn = document.getElementById('mute');

const beep = document.getElementById('beep');

const $wsStatus = document.getElementById('wsStatus');
const $latency = document.getElementById('latency');
const $lastTick = document.getElementById('lastTick');

// Costs
const $feeBuy = document.getElementById('feeBuy');
const $feeSell = document.getElementById('feeSell');
const $spread = document.getElementById('spread');
const $slippage = document.getElementById('slippage');
const $applyCosts = document.getElementById('applyCosts');
const $totalCost = document.getElementById('totalCost');
const $breakeven = document.getElementById('breakeven');
const $breakevenNote = document.getElementById('breakevenNote');

// Trend (regressão)
const $trendLabel = document.getElementById('trendLabel');
const $trendScore = document.getElementById('trendScore');
const $trendWindowInfo = document.getElementById('trendWindowInfo');

// Chart options
const chartCanvas = document.getElementById('priceChart');
const $chartType = document.getElementById('chartType');
const $trendWindowSelect = document.getElementById('trendWindow');
let priceChart = null;

// --------- State ---------
let ws;
let symbol = 'btcusdt';
let minPct = 2.5;
let maxPct = 3.0;
let resetMinutes = 60;
let muted = false;

let peakPrice = null;
let lastPrice = null;
let lastPeakResetAt = Date.now();

let currentPeak = null; // { ts, price, origin, maxDdAbs }
let peaks = []; // [{ id, ts, price, origin, maxDdAbs, durationMs, endedAt }]
let nextPeakId = 1;

let lastPingAt = null;
let lastMessageAt = null;
let heartbeatTimer = null;

// Buffers
let priceBuffer = []; // todos os preços recentes (limitado)
let timeLabels = [];  // labels para gráfico
const MAX_BUFFER = 400;

// Tendência config (regressão linear)
let trendCfg = { window: 60, threshold: 0.0002 }; // 0.02% por amostra

// --------- Tooltips ---------
const tooltip = document.createElement('div');
tooltip.id = 'tooltip';
tooltip.className = 'tooltip';
document.body.appendChild(tooltip);

function attachTooltips(root = document) {
  const targets = root.querySelectorAll('[data-tip]');
  targets.forEach(el => {
    el.addEventListener('mouseenter', (e) => showTip(e.currentTarget));
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('mousemove', moveTip);
    el.addEventListener('touchstart', (e) => { showTip(e.currentTarget); moveTip(e.touches[0]); });
    el.addEventListener('touchend', hideTip);
  });
}
function showTip(el) {
  const tip = el.getAttribute('data-tip');
  if (!tip) return;
  tooltip.innerHTML = tip;
  tooltip.classList.add('show');
}
function hideTip() { tooltip.classList.remove('show'); }
function moveTip(e) {
  const x = (e.clientX || 0), y = (e.clientY || 0);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y - 18}px`;
}
attachTooltips();

// --------- Utils ---------
function pad(n){return n.toString().padStart(2,'0')}
function formatDuration(ms){ const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; if(h>0)return`${pad(h)}h ${pad(m)}m ${pad(sec)}s`; if(m>0)return`${pad(m)}m ${pad(sec)}s`; return`${pad(sec)}s`; }
function formatPrice(p){return `$ ${p.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`}
function logEvent(level,msg,tip){ if(!$events) return; const li=document.createElement('li'); li.className=level; li.textContent=`[${new Date().toLocaleTimeString()}] ${msg}`; if(tip){li.title=tip;} $events.prepend(li); }

// --------- Chart.js ---------
function initChart(){
  if (!chartCanvas) { logEvent('warn','Canvas do gráfico não encontrado'); return; }
  if (typeof Chart === 'undefined') { logEvent('error','Chart.js não carregado'); return; }

  const ctx = chartCanvas.getContext('2d');

  // escolhe cores conforme tipo
  const baseColor = '#22d3ee';
  const bgGradient = ctx.createLinearGradient(0,0,0,200);
  bgGradient.addColorStop(0,'rgba(34, 211, 238, 0.6)');
  bgGradient.addColorStop(1,'rgba(34, 211, 238, 0.05)');

  const type = mapChartType($chartType?.value || 'line');
  const dataset = {
    label: 'Preço',
    data: priceBuffer,
    borderColor: baseColor,
    backgroundColor: type === 'line' ? 'transparent' : bgGradient,
    tension: 0.25,
    borderWidth: 2,
    fill: type === 'area' ? 'start' : false,
    pointRadius: 0
  };

  priceChart = new Chart(ctx, {
    type: type === 'bar' ? 'bar' : 'line',
    data: { labels: timeLabels, datasets: [dataset] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (ctx) => `$ ${Number(ctx.parsed.y).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`
          }
        }
      },
      scales: {
        x: { ticks: { display: false }, grid: { display: false } },
        y: {
          ticks: { color: '#9fb0c9', callback: (v)=>`$ ${Number(v).toLocaleString('en-US',{maximumFractionDigits:0})}` },
          grid: { color: 'rgba(31,45,65,0.3)' }
        }
      }
    }
  });
}
function updateChart(){
  if (!priceChart) return;
  priceChart.data.labels = timeLabels;
  priceChart.data.datasets[0].data = priceBuffer;
  try { priceChart.update(); } catch(e) { console.error(e); }
}
function rebuildChart(){
  if (!chartCanvas || typeof Chart === 'undefined') return;
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  initChart();
}
function mapChartType(val){
  switch((val||'').toLowerCase()){
    case 'line': return 'line';
    case 'area': return 'area'; // usaremos line com fill
    case 'bar': return 'bar';
    default: return 'line';
  }
}

// --------- WebSocket / status ---------
function setWsStatus(online){ if(!$wsStatus) return; $wsStatus.textContent = online ? 'Online' : 'Offline'; }
function startHeartbeat(){ stopHeartbeat(); heartbeatTimer=setInterval(()=>{ lastPingAt=Date.now(); setWsStatus(lastMessageAt && Date.now()-lastMessageAt<=10000); updateLatency(); },3000); }
function stopHeartbeat(){ if(heartbeatTimer){ clearInterval(heartbeatTimer); heartbeatTimer=null; } }
function updateLatency(){ if(!$latency) return; if(!lastPingAt){ $latency.textContent='-'; return; } $latency.textContent = Math.max(0, Date.now()-lastPingAt).toString(); }

function connect(){
  if(ws) ws.close();
  const url=`wss://stream.binance.com:9443/ws/${symbol}@aggTrade`;
  ws=new WebSocket(url);
  ws.onopen=()=>{ setWsStatus(true); logEvent('info',`Conectado ao stream ${symbol}@aggTrade`); startHeartbeat(); };
  ws.onmessage=(ev)=>{ lastMessageAt=Date.now(); const d=JSON.parse(ev.data); const price=parseFloat(d.p); onPrice(price); updateLatency(); if($lastTick) $lastTick.textContent=new Date(lastMessageAt).toLocaleTimeString(); };
  ws.onclose=()=>{ setWsStatus(false); logEvent('warn','Conexão encerrada. Reconectando em 3s...'); stopHeartbeat(); setTimeout(connect,3000); };
  ws.onerror=(err)=>{ setWsStatus(false); logEvent('error',`Erro WS: ${err.message||err}`); };
}

// --------- Pico / drawdown ---------
function setDrawdownDisplay(ddSigned){
  if(!$drawdown) return;
  const val = ddSigned.toFixed(3);
  const text = (ddSigned>0?'+':'')+val+' %';
  $drawdown.textContent = text;
  $drawdown.style.color = ddSigned>0 ? '#34f5b5' : ddSigned<0 ? '#ff7b9b' : '#e5e7eb';
}
function triggerAlert(price,ddAbs){
  const ts=new Date().toLocaleString();
  if($lastAlert) $lastAlert.textContent=`${ts} | preço ${formatPrice(price)} | drawdown ${ddAbs.toFixed(3)}%`;
  if(!muted && beep){ try{beep.currentTime=0; beep.play();}catch(_){} }
  document.body.classList.add('alert'); setTimeout(()=>document.body.classList.remove('alert'),1000);
  fetch('/alert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'drawdown-range',message:`Queda ${minPct}%–${maxPct}%`,price,drawdownPct:Number(ddAbs.toFixed(3)),timestamp:Date.now()})}).catch(()=>{});
}
function updatePeakAge(){ if(!$peakAge) return; const ms = Date.now()-lastPeakResetAt; $peakAge.textContent = formatDuration(ms); }

function finalizeCurrentPeak(nowTs){
  if(!currentPeak) return;
  const ageMs = nowTs - currentPeak.ts;
  if(ageMs>10000){
    peaks.unshift({id:nextPeakId++, ts:currentPeak.ts, price:currentPeak.price, origin:currentPeak.origin, maxDdAbs:currentPeak.maxDdAbs||0, durationMs:ageMs, endedAt:nowTs});
    renderPeaks();
  }
}
function setPeak(price,origin){
  const now=Date.now();
  finalizeCurrentPeak(now);
  currentPeak = { ts: now, price, origin, maxDdAbs: 0 };
  peakPrice = price; lastPeakResetAt = now;
  if($peak) $peak.textContent = formatPrice(peakPrice);
  updatePeakAge();
}
function onPrice(price){
  // Preço atual
  lastPrice = price; if($price) $price.textContent = formatPrice(price);

  // Buffer para análise & gráfico
  pushPrice(price);
  updateChart();

  // reset por janela
  if(Date.now()-lastPeakResetAt > resetMinutes*60*1000){ setPeak(price,'auto'); logEvent('info','Pico resetado por janela'); }
  // novo topo
  if(peakPrice===null || price>peakPrice){ setPeak(price,'new-top'); }

  // drawdown
  let ddAbs=0, ddSigned=0;
  if(peakPrice){ ddAbs=((peakPrice-price)/peakPrice)*100; ddSigned=((price-peakPrice)/peakPrice)*100; }
  setDrawdownDisplay(ddSigned);
  if(currentPeak) currentPeak.maxDdAbs = Math.max(currentPeak.maxDdAbs||0, ddAbs||0);
  if(ddAbs>=minPct && ddAbs<=maxPct) triggerAlert(price,ddAbs);

  // Tendência (regressão linear)
  computeAndRenderTrend();
}

// --------- Buffer ---------
function pushPrice(price){
  priceBuffer.push(price);
  timeLabels.push(new Date().toLocaleTimeString());
  if(priceBuffer.length>MAX_BUFFER) priceBuffer = priceBuffer.slice(priceBuffer.length - MAX_BUFFER);
  if(timeLabels.length>MAX_BUFFER) timeLabels = timeLabels.slice(timeLabels.length - MAX_BUFFER);
}

// --------- Tendência (regressão linear) ---------
function computeLinearSlope(values){
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = values[i];
    sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
  }
  const denom = (n * sumXX - sumX * sumX);
  if (denom === 0) return 0;
  const a = (n * sumXY - sumX * sumY) / denom; // slope
  return a;
}
function computeAndRenderTrend(){
  const N = trendCfg.window;
  $trendWindowInfo.textContent = `Janela: ${N}`;
  // recorte dos últimos N preços
  const series = priceBuffer.slice(Math.max(0, priceBuffer.length - N));
  if (series.length < 2) {
    $trendLabel.textContent = 'Neutra';
    $trendLabel.classList.remove('up','down');
    $trendScore.textContent = '0.0000';
    return;
  }
  const slope = computeLinearSlope(series);
  const base = series[0];
  const pctPerSample = base ? (slope / base) : 0;

  const thr = trendCfg.threshold;
  let label = 'Neutra', cls = '';
  if (pctPerSample > thr) { label = 'Alta ⬆'; cls = 'up'; }
  else if (pctPerSample < -thr) { label = 'Baixa ⬇'; cls = 'down'; }

  $trendLabel.textContent = label;
  $trendLabel.classList.remove('up','down');
  if (cls) $trendLabel.classList.add(cls);
  $trendScore.textContent = pctPerSample.toFixed(4);
}

// --------- Tabela de picos ---------
function renderPeaks(){
  if(!$peaksBody) return;
  $peaksBody.innerHTML='';
  for(const p of peaks){
    const tr=document.createElement('tr');

    const tdDate=document.createElement('td');
    tdDate.classList.add('editable'); tdDate.contentEditable='true'; tdDate.dataset.field='ts'; tdDate.dataset.id=p.id;
    tdDate.textContent=new Date(p.ts).toLocaleString();

    const tdPrice=document.createElement('td');
    tdPrice.classList.add('editable'); tdPrice.contentEditable='true'; tdPrice.dataset.field='price'; tdPrice.dataset.id=p.id;
    tdPrice.textContent=p.price.toFixed(2);

    const tdAge=document.createElement('td');
    tdAge.dataset.fixed='true'; tdAge.textContent = formatDuration(p.durationMs || (p.endedAt ? (p.endedAt - p.ts) : 0));

    const tdDd=document.createElement('td'); tdDd.textContent=(p.maxDdAbs||0).toFixed(3)+' %';

    const tdOrigin=document.createElement('td');
    tdOrigin.classList.add('editable'); tdOrigin.contentEditable='true'; tdOrigin.dataset.field='origin'; tdOrigin.dataset.id=p.id;
    tdOrigin.textContent=formatOrigin(p.origin);

    tr.append(tdDate,tdPrice,tdAge,tdDd,tdOrigin);
    $peaksBody.appendChild(tr);
  }
}
function formatOrigin(o){ switch(o){ case 'manual': return 'Manual'; case 'auto': return 'Auto'; case 'new-top': return 'Novo topo'; default: return o; } }
function parseOrigin(t){ const x=(t||'').trim().toLowerCase(); if(['manual','auto','novo topo','new-top'].includes(x)) return x==='novo topo'?'new-top':x; return 'manual'; }

// --------- Export/Clear/Save ---------
$exportPeaks?.addEventListener('click',()=>{
  const rows=[['Data/Hora','Preço','Duração (s)','DD máx (%)','Origem']];
  peaks.forEach(p=>{
    const durSec=Math.floor((p.durationMs || (p.endedAt ? (p.endedAt - p.ts) : 0))/1000);
    rows.push([new Date(p.ts).toLocaleString(),p.price.toFixed(2),durSec,(p.maxDdAbs||0).toFixed(3),formatOrigin(p.origin)]);
  });
  const csv=rows.map(r=>r.join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`picos_${symbol}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
});
$clearPeaks?.addEventListener('click',()=>{peaks=[]; renderPeaks(); logEvent('warn','Histórico de picos limpo');});
$savePeaks?.addEventListener('click',()=>{
  const edits=$peaksBody.querySelectorAll('td.editable'); const updates=new Map(); let ok=true;
  edits.forEach(td=>{const id=parseInt(td.dataset.id,10); const field=td.dataset.field; const value=td.textContent.trim(); if(!updates.has(id)) updates.set(id,{}); updates.get(id)[field]=value;});
  peaks=peaks.map(p=>{
    if(updates.has(p.id)){
      const u=updates.get(p.id); const c={...p};
      if(u.ts){const parsed=Date.parse(u.ts); if(!isNaN(parsed)){c.ts=parsed; c.durationMs=(c.endedAt||c.ts)-c.ts;} else {ok=false; logEvent('error',`Data/Hora inválida id=${p.id}`);}}
      if(u.price){const n=parseFloat(u.price.replace(',','.')); if(!isNaN(n)&&n>0){c.price=n;} else {ok=false; logEvent('error',`Preço inválido id=${p.id}`);}}
      if(u.origin) c.origin=parseOrigin(u.origin);
      return c;
    }
    return p;
  });
  if(ok){ renderPeaks(); logEvent('info','Edições salvas'); }
});

// --------- Settings / custos ---------
function applySettings(){
  minPct=parseFloat($minThreshold.value);
  maxPct=parseFloat($maxThreshold.value);
  resetMinutes=parseInt($resetWindow.value,10);
  symbol=($symbolInput.value||'btcusdt').toLowerCase();

  if(isNaN(minPct)||isNaN(maxPct)||minPct<=0||maxPct<=0||minPct>maxPct){logEvent('error','Thresholds inválidos'); return;}
  if(!/^[a-z0-9]+$/.test(symbol)){logEvent('error','Símbolo inválido'); return;}

  logEvent('info',`Aplicado: ${symbol}, min=${minPct}%, max=${maxPct}%, reset=${resetMinutes}min`);
  connect();
}
function resetPeak(){ if(lastPrice!=null){ setPeak(lastPrice,'manual'); logEvent('info','Pico resetado manualmente'); } }
function toggleMute(){ muted=!muted; $muteBtn.textContent = muted ? 'Som ativar' : 'Silenciar'; }

let cost={feeBuy:0.10,feeSell:0.10,spread:0.01,slippage:0.05};
function applyCosts(){
  cost.feeBuy=parseFloat($feeBuy.value);
  cost.feeSell=parseFloat($feeSell.value);
  cost.spread=parseFloat($spread.value);
  cost.slippage=parseFloat($slippage.value);
  for(const k of Object.keys(cost)){ if(isNaN(cost[k])||cost[k]<0){logEvent('error',`Valor inválido em ${k}`); return;} }
  const total=cost.feeBuy+cost.feeSell+cost.spread+cost.slippage;
  $totalCost.textContent=total.toFixed(3)+' %';
  $breakeven.textContent=total.toFixed(3)+' %';
  $breakevenNote.textContent='Use ordens limit para reduzir slippage.';
  logEvent('info',`Custos: total=${total.toFixed(3)}%`);
}

// --------- Listeners ---------
setInterval(()=>{ updatePeakAge(); },1000);

$apply.addEventListener('click',applySettings);
$resetPeakBtn.addEventListener('click',resetPeak);
$muteBtn.addEventListener('click',toggleMute);
$applyCosts.addEventListener('click',applyCosts);

// Troca tipo de gráfico
$chartType?.addEventListener('change', () => {
  rebuildChart();
});

// Troca janela de tendência (tempo gráfico)
$trendWindowSelect?.addEventListener('change', () => {
  const v = parseInt($trendWindowSelect.value, 10);
  if (!isNaN(v) && v > 10 && v <= MAX_BUFFER) {
    trendCfg.window = v;
  }
  // atualizar janela informativa e tendência
  computeAndRenderTrend();
  // ajustar também labels do gráfico para recortar visualmente
  rebuildChart();
});

// --------- Init ---------
initChart();     // gráfico defensivo
applySettings(); // conecta WS
applyCosts();    // custos padrão
computeAndRenderTrend();  // estado inicial
updatePeakAge();
renderPeaks();