// Dashboard com Chart.js + Lightweight Charts (Candle), MAs na barra do gráfico, tendência e Diagnóstico
// Fallback: Binance -> Proxy local -> Demo (Demo é desligado assim que chegar dado live)

const $price = document.getElementById('price');
const $peak = document.getElementById('peak');
const $peakAge = document.getElementById('peakAge');
const $drawdown = document.getElementById('drawdown');
const $events = document.getElementById('events');
const $lastAlert = document.getElementById('lastAlert');

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

const $trendLabel = document.getElementById('trendLabel');
const $trendScore = document.getElementById('trendScore');
const $trendWindowInfo = document.getElementById('trendWindowInfo');

const chartCanvas = document.getElementById('priceChart');
const $chartType = document.getElementById('chartType');
const $trendWindowSelect = document.getElementById('trendWindow');
const $candleTf = document.getElementById('candleTf');
const $maPreset = document.getElementById('maPreset');
let priceChart = null;

const candleContainer = document.getElementById('candleContainer');
let lwChart = null;
let candleSeries = null;
let timeframeSec = 5;
let candleData = [];
let currentBar = null;

const $diagEndpoint = document.getElementById('diagEndpoint');
const $diagState = document.getElementById('diagState');
const $diagError = document.getElementById('diagError');
const $diagEvent = document.getElementById('diagEvent');
const $diagAttempts = document.getElementById('diagAttempts');
const $diagLastTick = document.getElementById('diagLastTick');

const $peaksBody = document.getElementById('peaksBody');
const $exportPeaks = document.getElementById('exportPeaks');
const $clearPeaks = document.getElementById('clearPeaks');
const $savePeaks = document.getElementById('savePeaks');

let ws;
let symbol = 'btcusdt';
let minPct = 2.5;
let maxPct = 3.0;
let resetMinutes = 60;
let muted = false;

let peakPrice = null;
let lastPrice = null;
let lastPeakResetAt = Date.now();

let currentPeak = null;
let peaks = [];
let nextPeakId = 1;

let lastPingAt = null;
let lastMessageAt = null;
let heartbeatTimer = null;

let priceBuffer = [];
let timeLabels = [];
const MAX_BUFFER = 400;

let trendCfg = { window: 60, threshold: 0.0002 };

let demoMode = false;
let demoTimer = null;

let diag = { endpoint:'-', state:'Offline', lastError:'-', lastEvent:'-', attempts:0, lastTickText:'-' };

// Tooltips
const tooltip = document.createElement('div');
tooltip.id = 'tooltip';
tooltip.className = 'tooltip';
document.body.appendChild(tooltip);
function attachTooltips(root = document) {
  root.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mouseenter', e => showTip(e.currentTarget));
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('mousemove', moveTip);
    el.addEventListener('touchstart', e => { showTip(e.currentTarget); moveTip(e.touches[0]); });
    el.addEventListener('touchend', hideTip);
  });
}
function showTip(el){ const tip=el.getAttribute('data-tip'); if(!tip) return; tooltip.innerHTML=tip; tooltip.classList.add('show'); }
function hideTip(){ tooltip.classList.remove('show'); }
function moveTip(e){ const x=(e.clientX||0), y=(e.clientY||0); tooltip.style.left=`${x}px`; tooltip.style.top=`${y-18}px`; }
attachTooltips();

// Utils
function pad(n){return n.toString().padStart(2,'0')}
function formatDuration(ms){ const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; if(h>0)return`${pad(h)}h ${pad(m)}m ${pad(sec)}s`; if(m>0)return`${pad(m)}m ${pad(sec)}s`; return`${pad(sec)}s`; }
function formatPrice(p){return `$ ${p.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`}
function logEvent(level,msg,tip){ if(!$events) return; const li=document.createElement('li'); li.className=level; li.textContent=`[${new Date().toLocaleTimeString()}] ${msg}`; if(tip) li.title=tip; $events.prepend(li); setDiagEvent(msg); }
function setDiagState(text){ diag.state=text; $diagState && ($diagState.textContent=text); }
function setDiagEndpoint(text){ diag.endpoint=text; $diagEndpoint && ($diagEndpoint.textContent=text); }
function setDiagError(text){ diag.lastError=text; $diagError && ($diagError.textContent=text||'-'); }
function setDiagEvent(text){ diag.lastEvent=text; $diagEvent && ($diagEvent.textContent=text||'-'); }
function incDiagAttempts(){ diag.attempts++; $diagAttempts && ($diagAttempts.textContent=String(diag.attempts)); }
function setDiagLastTick(text){ diag.lastTickText=text; $diagLastTick && ($diagLastTick.textContent=text||'-'); }

// Aceita números com vírgula ou ponto
function parseLocaleNumber(v, fallback){
  if (v == null) return fallback;
  const s = String(v).trim().replace(/\./g,'').replace(',','.');
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

// Timeframe
const TF_MAP = {
  '1s':1,'2s':2,'3s':3,'4s':4,'5s':5,'10s':10,'15s':15,'20s':20,'30s':30,
  '1m':60,'2m':120,'3m':180,'4m':240,'5m':300,'10m':600,'15m':900,'30m':1800,
  '1h':3600,'2h':7200,'3h':10800,'4h':14400,'5h':18000,'6h':21600,'7h':25200,'8h':28800,'9h':32400,'10h':36000,'12h':43200,'14h':50400,'18h':64800,
  '1d':86400,'2d':172800,'3d':259200,'4d':345600,'5d':432000,'10d':864000,'15d':1296000,
  '1w':604800,'2w':1209600,'1mo':2592000,'6mo':15552000,'1y':31536000
};
function tfToSeconds(tf){ return TF_MAP[tf] ?? 5; }
function resetCandleAggregation(){ candleData=[]; currentBar=null; if(candleSeries) candleSeries.setData([]); rebuildCandleMAs(); }

// MAs (SMA/EMA)
function sma(values, period){
  const out=Array(values.length).fill(null); let sum=0;
  for(let i=0;i<values.length;i++){ sum+=values[i]; if(i>=period) sum-=values[i-period]; if(i>=period-1) out[i]=sum/period; }
  return out;
}
function ema(values, period){
  const out=Array(values.length).fill(null); const k=2/(period+1); let e=values[0];
  for(let i=0;i<values.length;i++){ const v=values[i]; e=i===0?v:(v*k+e*(1-k)); if(i>=period-1) out[i]=e; }
  return out;
}
function computeMA(values,type,period){ return (type==='EMA'? ema(values,period): sma(values,period)); }

// Presets de MAs
let chartOpts = { grid:true, lastPriceLine:true, mas:[
  {enabled:true,type:'EMA',period:20,color:'#f59e0b'},
  {enabled:true,type:'EMA',period:50,color:'#3b82f6'},
  {enabled:false,type:'EMA',period:200,color:'#a855f7'},
]};
function applyMaPreset(val){
  switch((val||'').toLowerCase()){
    case 'off': chartOpts.mas=[{enabled:false},{enabled:false},{enabled:false}]; break;
    case 'ema20': chartOpts.mas=[
      {enabled:true,type:'EMA',period:20,color:'#f59e0b'},
      {enabled:false},{enabled:false}
    ]; break;
    case 'ema2050': chartOpts.mas=[
      {enabled:true,type:'EMA',period:20,color:'#f59e0b'},
      {enabled:true,type:'EMA',period:50,color:'#3b82f6'},
      {enabled:false}
    ]; break;
    case 'ema2050200': chartOpts.mas=[
      {enabled:true,type:'EMA',period:20,color:'#f59e0b'},
      {enabled:true,type:'EMA',period:50,color:'#3b82f6'},
      {enabled:true,type:'EMA',period:200,color:'#a855f7'}
    ]; break;
    case 'sma2050200': chartOpts.mas=[
      {enabled:true,type:'SMA',period:20,color:'#f59e0b'},
      {enabled:true,type:'SMA',period:50,color:'#3b82f6'},
      {enabled:true,type:'SMA',period:200,color:'#a855f7'}
    ]; break;
    default: break;
  }
  if(isCandleMode()) rebuildCandleMAs(); else updateChart();
}

// Chart helpers
function isCandleMode(){ return ($chartType?.value||'').toLowerCase()==='candle'; }

// Chart.js
function mapChartType(val){ const v=(val||'line').toLowerCase(); return v==='bar'?'bar':'line'; }
function chartJsDatasets(){
  const datasets=[{
    label:'Preço',
    data: priceBuffer,
    borderColor:'#22d3ee',
    backgroundColor:(($chartType?.value||'')==='area')?'rgba(34,211,238,0.15)':'transparent',
    tension:0.25,borderWidth:2,fill:(($chartType?.value||'')==='area'),pointRadius:0,order:1
  }];
  const closes = priceBuffer.slice();
  chartOpts.mas.forEach(ma=>{
    if(!ma?.enabled) return;
    const arr = computeMA(closes, ma.type, Number(ma.period)||1);
    datasets.push({
      label: `${ma.type}${ma.period}`,
      data: arr, borderColor: ma.color, backgroundColor:'transparent',
      tension:0.15, borderWidth:1.5, pointRadius:0, spanGaps:true, order:0
    });
  });
  return datasets;
}
function initChartjs(){
  if(!chartCanvas || typeof Chart==='undefined') return;
  const ctx=chartCanvas.getContext('2d');
  const type=mapChartType($chartType?.value||'line');
  priceChart=new Chart(ctx,{
    type,
    data:{ labels: timeLabels, datasets: chartJsDatasets() },
    options:{
      responsive:true, maintainAspectRatio:false, animation:false,
      plugins:{ legend:{display:false}, tooltip:{mode:'index',intersect:false,callbacks:{
        label:(ctx)=> `$ ${Number(ctx.parsed.y).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`
      }}},
      scales:{
        x:{ ticks:{display:false}, grid:{display:true}},
        y:{ ticks:{ color:'#9fb0c9', callback:(v)=>`$ ${Number(v).toLocaleString('en-US',{maximumFractionDigits:0})}` },
            grid:{ color:'rgba(31,45,65,0.3)'} }
      }
    }
  });
}
function destroyChartjs(){ if(priceChart){ priceChart.destroy(); priceChart=null; } }
function updateChart(){
  if(isCandleMode() || !priceChart) return;
  priceChart.data.labels=timeLabels;
  priceChart.data.datasets=chartJsDatasets();
  try{ priceChart.update(); }catch(e){ console.error(e); }
}

// Lightweight Charts (Candle)
let candleMASeries=[null,null,null];
function initCandle(){
  if(!candleContainer || typeof LightweightCharts==='undefined') return;
  lwChart=LightweightCharts.createChart(candleContainer,{
    width:candleContainer.clientWidth,
    height:candleContainer.clientHeight,
    layout:{ background:{color:'#0d1726'}, textColor:'#9fb0c9' },
    grid:{ vertLines:{color:'rgba(31,45,65,0.3)'}, horzLines:{color:'rgba(31,45,65,0.3)'} },
    rightPriceScale:{ borderColor:'rgba(134,144,160,0.3)' },
    timeScale:{ borderColor:'rgba(134,144,160,0.3)' }
  });
  candleSeries=lwChart.addCandlestickSeries({
    upColor:'#34f5b5', downColor:'#ef476f',
    borderUpColor:'#34f5b5', borderDownColor:'#ef476f',
    wickUpColor:'#34f5b5', wickDownColor:'#ef476f',
    priceLineVisible:true, lastValueVisible:true
  });
  const seed=[...candleData]; if(currentBar) seed.push(currentBar); if(seed.length) candleSeries.setData(seed);
  rebuildCandleMAs();
  const ro=new ResizeObserver(()=>{ lwChart.applyOptions({width:candleContainer.clientWidth,height:candleContainer.clientHeight}); });
  ro.observe(candleContainer); candleContainer._ro=ro;
}
function destroyCandle(){
  try{ candleContainer?._ro?.disconnect(); }catch(_){}
  if(lwChart){ lwChart.remove(); lwChart=null; candleSeries=null; candleMASeries=[null,null,null]; }
}
function rebuildCandleMAs(){
  if(!lwChart) return;
  candleMASeries.forEach(s=>{ try{ s && lwChart.removeSeries(s);}catch(_){}}); candleMASeries=[null,null,null];
  chartOpts.mas.forEach((ma,i)=>{
    if(!ma?.enabled) return;
    candleMASeries[i]=lwChart.addLineSeries({ color:ma.color, lineWidth:2, priceLineVisible:false, lastValueVisible:false });
  });
  recalcCandleMAs();
}
function recalcCandleMAs(){
  if(!lwChart) return;
  const raw=[...candleData]; if(currentBar) raw.push(currentBar);
  const times=raw.map(r=>r.time), closes=raw.map(r=>r.close);
  chartOpts.mas.forEach((ma,i)=>{
    const s=candleMASeries[i]; if(!ma?.enabled || !s) return;
    const arr=computeMA(closes, ma.type, Number(ma.period)||1);
    const data=[]; for(let k=0;k<arr.length;k++){ if(arr[k]!=null) data.push({time:times[k], value:arr[k]}); }
    s.setData(data);
  });
}
function updateCandle(price, ts=Date.now()){
  if(!isCandleMode() || !candleSeries) return;
  const tSec=Math.floor(ts/1000);
  const bucket=Math.floor(tSec/timeframeSec)*timeframeSec;
  if(!currentBar || bucket>currentBar.time){
    if(currentBar){ candleData.push(currentBar); if(candleData.length>MAX_BUFFER) candleData=candleData.slice(candleData.length-MAX_BUFFER); }
    currentBar={time:bucket, open:price, high:price, low:price, close:price};
  }else{
    currentBar.high=Math.max(currentBar.high, price);
    currentBar.low=Math.min(currentBar.low, price);
    currentBar.close=price;
  }
  candleSeries.update(currentBar);
  recalcCandleMAs();
}

// Rebuild
function rebuildChart(){
  const type=($chartType?.value||'line').toLowerCase();
  if(type==='candle'){
    chartCanvas.style.display='none';
    candleContainer.setAttribute('aria-hidden','false');
    destroyChartjs(); initCandle();
  }else{
    candleContainer.setAttribute('aria-hidden','true');
    chartCanvas.style.display='block';
    destroyCandle(); initChartjs(); updateChart();
  }
}

// WebSocket / status
function setWsStatus(text){ if($wsStatus) $wsStatus.textContent=text; setDiagState(text); }
function startHeartbeat(){ stopHeartbeat(); heartbeatTimer=setInterval(()=>{ lastPingAt=Date.now(); const online=(lastMessageAt && Date.now()-lastMessageAt<=10000); setWsStatus(demoMode?'Demo':(online?'Online':'Offline')); updateLatency(); },3000); }
function stopHeartbeat(){ if(heartbeatTimer){ clearInterval(heartbeatTimer); heartbeatTimer=null; } }
function updateLatency(){ if(!$latency) return; if(!lastPingAt){ $latency.textContent='-'; return; } $latency.textContent=String(Math.max(0,Date.now()-lastPingAt)); }

// Conexão: Binance -> Proxy local -> Demo
async function connect(){
  demoMode=false; clearDemo();
  if(ws){ try{ ws.close(); }catch(_){ } ws=null; }
  diag.attempts=0; $diagAttempts && ($diagAttempts.textContent='0');

  const proto=(location.protocol==='https:'?'wss':'ws');
  const endpoints=[
    {url:`wss://stream.binance.com:9443/ws/${symbol}@aggTrade`, label:'Binance'},
    {url:`${proto}://${location.host}/ws?symbol=${symbol}&stream=aggTrade`, label:'Proxy local'}
  ];
  for(const ep of endpoints){
    incDiagAttempts(); setDiagEndpoint(ep.label);
    if(await tryEndpoint(ep.url,ep.label)) return;
  }
  setDiagError('Falha nos endpoints. Ativando Demo.');
  enableDemo('Nenhum endpoint respondeu em 5s');
}
function tryEndpoint(url,label){
  return new Promise((resolve)=>{
    let settled=false, gotMessage=false;
    try{ ws=new WebSocket(url); }catch(e){ setDiagError(`Criar WS (${label}): ${e.message||e}`); logEvent('error',`Falha ao criar WS (${label}): ${e.message||e}`); return resolve(false); }
    const watchdog=setTimeout(()=>{ if(!settled && !gotMessage){ settled=true; setDiagError(`Sem dados de ${label} em 5s`); logEvent('warn',`Sem dados de ${label} em 5s. Tentando próximo…`); try{ws.close();}catch(_){ } resolve(false); } },5000);
    ws.onopen=()=>{ setWsStatus('Online'); setDiagEvent(`Conectado via ${label}`); logEvent('info',`Conectado via ${label}`); startHeartbeat(); };
    ws.onmessage=(ev)=>{
      lastMessageAt=Date.now(); gotMessage=true;
      if(demoMode){ demoMode=false; clearDemo(); setWsStatus('Online'); setDiagEvent('Recebendo dados (live)'); }
      try{
        const d=JSON.parse(ev.data);
        const price=parseFloat(d.p ?? d.price ?? d.c ?? d);
        if(!isNaN(price)) onPrice(price);
      }catch(e){ setDiagError(`Payload inválido (${label}): ${e.message||e}`); }
      updateLatency(); const ts=new Date(lastMessageAt).toLocaleTimeString(); if($lastTick) $lastTick.textContent=ts; setDiagLastTick(ts);
      if(!settled){ settled=true; clearTimeout(watchdog); resolve(true); }
    };
    ws.onerror=(err)=>{ setWsStatus('Offline'); const msg=`Erro ${label}: ${err?.message||err}`; setDiagError(msg); logEvent('error',msg); if(!settled){ settled=true; clearTimeout(watchdog); resolve(false);} };
    ws.onclose=()=>{ setWsStatus('Offline'); setDiagEvent(`Fechado (${label})`); if(!settled){ settled=true; clearTimeout(watchdog); resolve(false);} };
  });
}

// Demo
function enableDemo(reason){
  if(demoMode) return;
  demoMode=true; setWsStatus('Demo'); setDiagEvent(`Modo DEMO (${reason})`);
  logEvent('warn',`Modo DEMO ativado (${reason}). Dados simulados serão exibidos.`);
  let base=lastPrice || 50000;
  clearDemo();
  demoTimer=setInterval(()=>{
    base = base + Math.sin(Date.now()/5000)*10 + (Math.random()-0.5)*5;
    onPrice(base);
    const ts=new Date().toLocaleTimeString(); if($lastTick) $lastTick.textContent=ts; setDiagLastTick(ts);
    lastMessageAt=Date.now();
  },1000);
  startHeartbeat();
}
function clearDemo(){ if(demoTimer){ clearInterval(demoTimer); demoTimer=null; } }

// Pico / drawdown
function setDrawdownDisplay(ddSigned){
  if(!$drawdown) return;
  const val=ddSigned.toFixed(3);
  const text=(ddSigned>0?'+':'')+val+' %';
  $drawdown.textContent=text;
  $drawdown.style.color = ddSigned>0 ? '#34f5b5' : ddSigned<0 ? '#ff7b9b' : '#e5e7eb';
}
function triggerAlert(price,ddAbs){
  const ts=new Date().toLocaleString();
  if($lastAlert) $lastAlert.textContent=`${ts} | preço ${formatPrice(price)} | drawdown ${ddAbs.toFixed(3)}%`;
  if(!muted && beep){ try{beep.currentTime=0; beep.play();}catch(_){ } }
  document.body.classList.add('alert'); setTimeout(()=>document.body.classList.remove('alert'),1000);
  fetch('/alert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'drawdown-range',message:`Queda ${minPct}%–${maxPct}%`,price,drawdownPct:Number(ddAbs.toFixed(3)),timestamp:Date.now()})}).catch(()=>{});
}
function updatePeakAge(){ if(!$peakAge) return; const ms=Date.now()-lastPeakResetAt; $peakAge.textContent=formatDuration(ms); }

function finalizeCurrentPeak(nowTs){
  if(!currentPeak) return;
  const ageMs=nowTs-currentPeak.ts;
  if(ageMs>10000){
    peaks.unshift({id:nextPeakId++, ts:currentPeak.ts, price:currentPeak.price, origin:currentPeak.origin, maxDdAbs:currentPeak.maxDdAbs||0, durationMs:ageMs, endedAt:nowTs});
    renderPeaks();
  }
}
function setPeak(price,origin){
  const now=Date.now();
  finalizeCurrentPeak(now);
  currentPeak={ ts:now, price, origin, maxDdAbs:0 };
  peakPrice=price; lastPeakResetAt=now;
  if($peak) $peak.textContent=formatPrice(peakPrice);
  updatePeakAge();
}
function onPrice(price){
  lastPrice=price; if($price) $price.textContent=formatPrice(price);

  pushPrice(price);
  updateCandle(price);
  updateChart();

  if(Date.now()-lastPeakResetAt > resetMinutes*60*1000){ setPeak(price,'auto'); logEvent('info','Pico resetado por janela'); }
  if(peakPrice===null || price>peakPrice){ setPeak(price,'new-top'); }

  let ddAbs=0, ddSigned=0;
  if(peakPrice){ ddAbs=((peakPrice-price)/peakPrice)*100; ddSigned=((price-peakPrice)/peakPrice)*100; }
  setDrawdownDisplay(ddSigned);
  if(currentPeak) currentPeak.maxDdAbs=Math.max(currentPeak.maxDdAbs||0, ddAbs||0);
  if(ddAbs>=minPct && ddAbs<=maxPct) triggerAlert(price,ddAbs);

  computeAndRenderTrend();
}

// Buffer
function pushPrice(price){
  priceBuffer.push(price);
  timeLabels.push(new Date().toLocaleTimeString());
  if(priceBuffer.length>MAX_BUFFER) priceBuffer=priceBuffer.slice(priceBuffer.length-MAX_BUFFER);
  if(timeLabels.length>MAX_BUFFER) timeLabels=timeLabels.slice(timeLabels.length-MAX_BUFFER);
}

// Tendência
function computeLinearSlope(values){
  const n=values.length; if(n<2) return 0;
  let sumX=0,sumY=0,sumXY=0,sumXX=0;
  for(let i=0;i<n;i++){ const x=i,y=values[i]; sumX+=x; sumY+=y; sumXY+=x*y; sumXX+=x*x; }
  const denom=(n*sumXX - sumX*sumX); if(denom===0) return 0;
  return (n*sumXY - sumX*sumY)/denom;
}
function computeAndRenderTrend(){
  const N=trendCfg.window;
  if($trendWindowInfo) $trendWindowInfo.textContent=`Janela: ${N}`;
  const series=priceBuffer.slice(Math.max(0,priceBuffer.length-N));
  if(series.length<2){
    if($trendLabel) $trendLabel.textContent='Neutra';
    $trendLabel?.classList.remove('up','down');
    if($trendScore) $trendScore.textContent='0.0000';
    return;
  }
  const slope=computeLinearSlope(series);
  const base=series[0];
  const pctPerSample= base ? (slope/base) : 0;
  const thr=trendCfg.threshold;
  let label='Neutra', cls='';
  if(pctPerSample>thr){ label='Alta ⬆'; cls='up'; }
  else if(pctPerSample<-thr){ label='Baixa ⬇'; cls='down'; }
  if($trendLabel){ $trendLabel.textContent=label; $trendLabel.classList.remove('up','down'); if(cls) $trendLabel.classList.add(cls); }
  if($trendScore) $trendScore.textContent=pctPerSample.toFixed(4);
}

// Tabela de picos
function renderPeaks(){
  if(!$peaksBody) return;
  $peaksBody.innerHTML='';
  for(const p of peaks){
    const tr=document.createElement('tr');
    const tdDate=document.createElement('td'); tdDate.classList.add('editable'); tdDate.contentEditable='true'; tdDate.dataset.field='ts'; tdDate.dataset.id=p.id; tdDate.textContent=new Date(p.ts).toLocaleString();
    const tdPrice=document.createElement('td'); tdPrice.classList.add('editable'); tdPrice.contentEditable='true'; tdPrice.dataset.field='price'; tdPrice.dataset.id=p.id; tdPrice.textContent=p.price.toFixed(2);
    const tdAge=document.createElement('td'); tdAge.dataset.fixed='true'; tdAge.textContent=formatDuration(p.durationMs || (p.endedAt ? (p.endedAt - p.ts) : 0));
    const tdDd=document.createElement('td'); tdDd.textContent=(p.maxDdAbs||0).toFixed(3)+' %';
    const tdOrigin=document.createElement('td'); tdOrigin.classList.add('editable'); tdOrigin.contentEditable='true'; tdOrigin.dataset.field='origin'; tdOrigin.dataset.id=p.id; tdOrigin.textContent=formatOrigin(p.origin);
    tr.append(tdDate,tdPrice,tdAge,tdDd,tdOrigin); $peaksBody.appendChild(tr);
  }
}
function formatOrigin(o){ switch(o){ case 'manual': return 'Manual'; case 'auto': return 'Auto'; case 'new-top': return 'Novo topo'; default: return o; } }
function parseOrigin(t){ const x=(t||'').trim().toLowerCase(); if(['manual','auto','novo topo','new-top'].includes(x)) return x==='novo topo'?'new-top':x; return 'manual'; }

// Export/Clear/Save
$exportPeaks?.addEventListener('click',()=>{
  const rows=[['Data/Hora','Preço','Duração (s)','DD máx (%)','Origem']];
  peaks.forEach(p=>{ const durSec=Math.floor((p.durationMs || (p.endedAt ? (p.endedAt - p.ts) : 0))/1000);
    rows.push([new Date(p.ts).toLocaleString(),p.price.toFixed(2),durSec,(p.maxDdAbs||0).toFixed(3),formatOrigin(p.origin)]);
  });
  const csv=rows.map(r=>r.join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`picos_${symbol}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
});
$clearPeaks?.addEventListener('click',()=>{peaks=[]; renderPeaks(); logEvent('warn','Histórico de picos limpo');});
$savePeaks?.addEventListener('click',()=>{
  if(!$peaksBody) return;
  const edits=$peaksBody.querySelectorAll('td.editable'); const updates=new Map(); let ok=true;
  edits.forEach(td=>{ const id=parseInt(td.dataset.id,10); const field=td.dataset.field; const value=td.textContent.trim(); if(!updates.has(id)) updates.set(id,{}); updates.get(id)[field]=value; });
  peaks=peaks.map(p=>{
    if(updates.has(p.id)){
      const u=updates.get(p.id); const c={...p};
      if(u.ts){ const parsed=Date.parse(u.ts); if(!isNaN(parsed)){ c.ts=parsed; c.durationMs=(c.endedAt||c.ts)-c.ts; } else { ok=false; logEvent('error',`Data/Hora inválida id=${p.id}`); } }
      if(u.price){ const n=parseFloat(u.price.replace(',','.')); if(!isNaN(n)&&n>0){ c.price=n; } else { ok=false; logEvent('error',`Preço inválido id=${p.id}`); } }
      if(u.origin) c.origin=parseOrigin(u.origin);
      return c;
    }
    return p;
  });
  if(ok){ renderPeaks(); logEvent('info','Edições salvas'); }
});

// Settings com fallback e sempre conectando
function applySettings(){
  const DEFAULTS = { minPct: 2.5, maxPct: 3.0, resetMinutes: 60, symbol: 'btcusdt' };

  const minVal = parseLocaleNumber($minThreshold?.value, DEFAULTS.minPct);
  const maxVal = parseLocaleNumber($maxThreshold?.value, DEFAULTS.maxPct);
  const resetVal = parseLocaleNumber($resetWindow?.value, DEFAULTS.resetMinutes);
  const symVal = ($symbolInput?.value ?? DEFAULTS.symbol).toLowerCase();

  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal) || minVal<=0 || maxVal<=0 || minVal>maxVal) {
    logEvent('warn','Thresholds inválidos; usando padrão 2.5%–3.0%');
    minPct = DEFAULTS.minPct; maxPct = DEFAULTS.maxPct;
  } else { minPct = minVal; maxPct = maxVal; }

  resetMinutes = Number.isFinite(resetVal) ? resetVal : DEFAULTS.resetMinutes;
  symbol = /^[a-z0-9]+$/.test(symVal) ? symVal : DEFAULTS.symbol;

  logEvent('info',`Aplicado: ${symbol}, min=${minPct}%, max=${maxPct}%, reset=${resetMinutes}min`);
  connect(); // SEMPRE conecta
}
function resetPeak(){ if(lastPrice!=null){ setPeak(lastPrice,'manual'); logEvent('info','Pico resetado manualmente'); } }
function toggleMute(){ muted=!muted; if($muteBtn) $muteBtn.textContent = muted ? 'Som ativar' : 'Silenciar'; }

// Custos (fallback, não bloqueia boot)
const $feeBuy = document.getElementById('feeBuy');
const $feeSell = document.getElementById('feeSell');
const $spread = document.getElementById('spread');
const $slippage = document.getElementById('slippage');
const $applyCosts = document.getElementById('applyCosts');
const $totalCost = document.getElementById('totalCost');
const $breakeven = document.getElementById('breakeven');
const $breakevenNote = document.getElementById('breakevenNote');

function applyCosts(){
  const feeBuy = parseLocaleNumber($feeBuy?.value, 0.10);
  const feeSell = parseLocaleNumber($feeSell?.value, 0.10);
  const spread = parseLocaleNumber($spread?.value, 0.01);
  const slippage = parseLocaleNumber($slippage?.value, 0.05);
  const vals = [feeBuy, feeSell, spread, slippage].map(v => Number.isFinite(v) && v>=0 ? v : 0);
  const total = vals.reduce((a,b)=>a+b,0);
  $totalCost && ($totalCost.textContent = total.toFixed(3)+' %');
  $breakeven && ($breakeven.textContent = total.toFixed(3)+' %');
  $breakevenNote && ($breakevenNote.textContent = 'Use ordens limit para reduzir slippage.');
  logEvent('info',`Custos: total=${total.toFixed(3)}%`);
}

// Listeners
setInterval(()=>{ updatePeakAge(); },1000);
$apply?.addEventListener('click',applySettings);
$resetPeakBtn?.addEventListener('click',resetPeak);
$muteBtn?.addEventListener('click',toggleMute);
$applyCosts?.addEventListener('click',applyCosts);
$trendWindowSelect?.addEventListener('change',()=>{ const v=parseInt($trendWindowSelect.value,10); if(!isNaN(v)&&v>10&&v<=MAX_BUFFER) trendCfg.window=v; computeAndRenderTrend(); rebuildChart(); });
$chartType?.addEventListener('change',()=>{ rebuildChart(); });
$candleTf?.addEventListener('change',()=>{ timeframeSec=tfToSeconds($candleTf.value); resetCandleAggregation(); if(isCandleMode()&&lwChart&&candleSeries) candleSeries.setData([]); });
$maPreset?.addEventListener('change',()=>{ applyMaPreset($maPreset.value); });

// Init
function initChartsOnLoad(){
  timeframeSec=tfToSeconds($candleTf?.value || '5s');
  applyMaPreset($maPreset?.value || 'ema2050');
  const type=($chartType?.value||'line').toLowerCase();
  if(type==='candle'){ chartCanvas.style.display='none'; candleContainer.setAttribute('aria-hidden','false'); initCandle(); }
  else{ candleContainer.setAttribute('aria-hidden','true'); chartCanvas.style.display='block'; initChartjs(); }
}
initChartsOnLoad();
applySettings();        // agora SEMPRE conecta, mesmo se houver vírgula
applyCosts();
computeAndRenderTrend();
updatePeakAge();
renderPeaks();
setTimeout(()=>{ if(!lastMessageAt && !demoMode){ setDiagError('Sem dados nos primeiros 5s'); enableDemo('Sem dados do WS nos primeiros 5s'); } },5000);