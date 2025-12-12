// Inclui: layout configurável com CSS vars, listeners dos botões e persistência no localStorage.

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

const $feeBuy = document.getElementById('feeBuy');
const $feeSell = document.getElementById('feeSell');
const $spread = document.getElementById('spread');
const $slippage = document.getElementById('slippage');
const $applyCosts = document.getElementById('applyCosts');
const $totalCost = document.getElementById('totalCost');
const $breakeven = document.getElementById('breakeven');
const $breakevenNote = document.getElementById('breakevenNote');

const $helpTour = document.getElementById('helpTour');

// Layout controls
const $inputWidth = document.getElementById('inputWidth');
const $cardWidth = document.getElementById('cardWidth');
const $rightColWidth = document.getElementById('rightColWidth');
const $applyLayout = document.getElementById('applyLayout');
const $resetLayout = document.getElementById('resetLayout');

// Tabela de picos
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

let peaks = []; // { id, ts, price, origin, maxDdAbs }
let nextPeakId = 1;

let lastPingAt = null;
let lastMessageAt = null;
let heartbeatTimer = null;

// Chart.js initialization (defensive)
let priceChart = null;
let chartData = {
  labels: [],
  prices: []
};
const MAX_CHART_POINTS = 100; // Keep last 100 data points

function initChart() {
  try {
    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
      console.warn('Chart.js not loaded, chart will not be available');
      logEvent('warn', 'Chart.js não carregado - gráfico desabilitado');
      return;
    }

    const canvas = document.getElementById('priceChart');
    if (!canvas) {
      console.warn('Canvas element #priceChart not found');
      logEvent('warn', 'Elemento canvas não encontrado - gráfico desabilitado');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('Cannot get 2D context from canvas');
      return;
    }

    priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [{
          label: 'Preço (USD)',
          data: chartData.prices,
          borderColor: '#00d084',
          backgroundColor: 'rgba(0, 208, 132, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: '#e5e9f0',
              font: { size: 12 }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 18, 24, 0.9)',
            titleColor: '#e5e9f0',
            bodyColor: '#e5e9f0',
            borderColor: '#333',
            borderWidth: 1,
            displayColors: false,
            callbacks: {
              label: function(context) {
                return 'Preço: $' + context.parsed.y.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                });
              }
            }
          }
        },
        scales: {
          x: {
            display: true,
            grid: {
              color: 'rgba(255, 255, 255, 0.05)',
              drawBorder: false
            },
            ticks: {
              color: '#9aa0a6',
              maxRotation: 0,
              autoSkipPadding: 20,
              font: { size: 10 }
            }
          },
          y: {
            display: true,
            position: 'right',
            grid: {
              color: 'rgba(255, 255, 255, 0.05)',
              drawBorder: false
            },
            ticks: {
              color: '#9aa0a6',
              callback: function(value) {
                return '$' + value.toLocaleString('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0
                });
              },
              font: { size: 10 }
            }
          }
        },
        animation: {
          duration: 0 // Disable animations for better performance
        }
      }
    });

    logEvent('info', 'Gráfico de preços inicializado');
  } catch (error) {
    console.error('Error initializing chart:', error);
    logEvent('error', `Erro ao inicializar gráfico: ${error.message}`);
  }
}

function updateChart(price) {
  if (!priceChart) return; // Chart not initialized or failed to initialize

  try {
    const now = new Date();
    const timeLabel = now.toLocaleTimeString('pt-BR', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });

    chartData.labels.push(timeLabel);
    chartData.prices.push(price);

    // Keep only last MAX_CHART_POINTS
    if (chartData.labels.length > MAX_CHART_POINTS) {
      chartData.labels.shift();
      chartData.prices.shift();
    }

    priceChart.update('none'); // Update without animation
  } catch (error) {
    console.error('Error updating chart:', error);
  }
}

// Layout persistence
const defaultLayout = { inputMax: 140, cardMax: 220, rightCol: 520 };
function clamp(n, min, max) { return Math.min(max, Math.max(min, n || min)); }
function applyLayoutVars(cfg) {
  const root = document.documentElement;
  root.style.setProperty('--input-max', `${cfg.inputMax}px`);
  root.style.setProperty('--card-max', `${cfg.cardMax}px`);
  root.style.setProperty('--right-col', `${cfg.rightCol}px`);
}
function loadLayout() {
  const saved = JSON.parse(localStorage.getItem('layoutConfig') || 'null') || defaultLayout;
  $inputWidth.value = saved.inputMax;
  $cardWidth.value = saved.cardMax;
  $rightColWidth.value = saved.rightCol;
  applyLayoutVars(saved);
}
function doApplyLayout() {
  const cfg = {
    inputMax: clamp(parseInt($inputWidth.value, 10), 90, 240),
    cardMax: clamp(parseInt($cardWidth.value, 10), 160, 320),
    rightCol: clamp(parseInt($rightColWidth.value, 10), 380, 800),
  };
  applyLayoutVars(cfg);
  localStorage.setItem('layoutConfig', JSON.stringify(cfg));
  logEvent('info', `Layout aplicado: inputs=${cfg.inputMax}px, cards=${cfg.cardMax}px, coluna=${cfg.rightCol}px`);
}
function doResetLayout() {
  applyLayoutVars(defaultLayout);
  $inputWidth.value = defaultLayout.inputMax;
  $cardWidth.value = defaultLayout.cardMax;
  $rightColWidth.value = defaultLayout.rightCol;
  localStorage.removeItem('layoutConfig');
  logEvent('info', 'Layout restaurado para padrão');
}
$applyLayout.addEventListener('click', doApplyLayout);
$resetLayout.addEventListener('click', doResetLayout);
// aplicação ao digitar
$inputWidth.addEventListener('input', doApplyLayout);
$cardWidth.addEventListener('input', doApplyLayout);
$rightColWidth.addEventListener('input', doApplyLayout);

function logEvent(level, msg, tip) {
  const li = document.createElement('li');
  li.className = level;
  li.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  if (tip) { li.setAttribute('data-tip', tip); li.classList.add('tip-target'); }
  $events.prepend(li);
}

function setWsStatus(online) {
  if (online) { $wsStatus.textContent = 'Online'; $wsStatus.classList.remove('offline'); $wsStatus.classList.add('online'); }
  else { $wsStatus.textContent = 'Offline'; $wsStatus.classList.remove('online'); $wsStatus.classList.add('offline'); }
}

function connect() {
  if (ws) ws.close();
  const streamUrl = `wss://stream.binance.com:9443/ws/${symbol}@aggTrade`;
  ws = new WebSocket(streamUrl);
  ws.onopen = () => { setWsStatus(true); logEvent('info', `Conectado ao stream ${symbol}@aggTrade`); startHeartbeat(); };
  ws.onmessage = (msg) => {
    lastMessageAt = Date.now();
    const data = JSON.parse(msg.data);
    const price = parseFloat(data.p);
    onPrice(price);
    updateLatency();
    $lastTick.textContent = new Date(lastMessageAt).toLocaleTimeString();
  };
  ws.onclose = () => { setWsStatus(false); logEvent('warn', 'Conexão encerrada. Tentando reconectar em 3s...'); stopHeartbeat(); setTimeout(connect, 3000); };
  ws.onerror = (err) => { setWsStatus(false); logEvent('error', `Erro WS: ${err.message || err}`); };
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    lastPingAt = Date.now();
    setWsStatus(lastMessageAt && Date.now() - lastMessageAt <= 10000);
    updateLatency();
  }, 3000);
}
function stopHeartbeat() { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } }
function updateLatency() { if (!lastPingAt) { $latency.textContent = '-'; return; } $latency.textContent = Math.max(0, Date.now() - lastPingAt).toString(); }

function onPrice(price) {
  lastPrice = price;
  $price.textContent = formatPrice(price);

  // Update chart with new price
  updateChart(price);

  if (Date.now() - lastPeakResetAt > resetMinutes * 60 * 1000) { setPeak(price, 'auto'); logEvent('info', 'Pico resetado por janela'); }
  if (peakPrice === null || price > peakPrice) { setPeak(price, 'new-top'); }

  let ddAbs = 0, ddSigned = 0;
  if (peakPrice) { ddAbs = ((peakPrice - price) / peakPrice) * 100; ddSigned = ((price - peakPrice) / peakPrice) * 100; }
  setDrawdownDisplay(ddSigned);
  updateCurrentPeakMaxDd(ddAbs);

  if (ddAbs >= minPct && ddAbs <= maxPct) triggerAlert(price, ddAbs);
}

function setPeak(price, origin) {
  peakPrice = price;
  lastPeakResetAt = Date.now();
  $peak.textContent = formatPrice(peakPrice);
  updatePeakAge();

  peaks.unshift({ id: nextPeakId++, ts: lastPeakResetAt, price: peakPrice, origin, maxDdAbs: 0 });
  renderPeaks();
}

function updateCurrentPeakMaxDd(ddAbs) {
  if (peaks.length > 0) {
    peaks[0].maxDdAbs = Math.max(peaks[0].maxDdAbs || 0, ddAbs || 0);
    renderPeaksAgeOnly();
  }
}

function renderPeaks() {
  $peaksBody.innerHTML = '';
  const now = Date.now();
  for (const p of peaks) {
    const ageMs = now - p.ts;
    const ageSec = Math.floor(ageMs / 1000);
    if (ageSec <= 10) continue;

    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.classList.add('editable'); tdDate.contentEditable = 'true';
    tdDate.dataset.field = 'ts'; tdDate.dataset.id = p.id;
    tdDate.textContent = new Date(p.ts).toLocaleString();

    const tdPrice = document.createElement('td');
    tdPrice.classList.add('editable'); tdPrice.contentEditable = 'true';
    tdPrice.dataset.field = 'price'; tdPrice.dataset.id = p.id;
    tdPrice.textContent = p.price.toFixed(2);

    const tdAge = document.createElement('td');
    tdAge.dataset.age = p.ts; tdAge.textContent = formatDuration(ageMs);

    const tdDd = document.createElement('td');
    tdDd.textContent = (p.maxDdAbs || 0).toFixed(3) + ' %';

    const tdOrigin = document.createElement('td');
    tdOrigin.classList.add('editable'); tdOrigin.contentEditable = 'true';
    tdOrigin.dataset.field = 'origin'; tdOrigin.dataset.id = p.id;
    tdOrigin.textContent = formatOrigin(p.origin);

    tr.append(tdDate, tdPrice, tdAge, tdDd, tdOrigin);
    $peaksBody.appendChild(tr);
  }
}

function renderPeaksAgeOnly() {
  const rows = $peaksBody.querySelectorAll('td[data-age]');
  rows.forEach(td => { const ts = parseInt(td.getAttribute('data-age'), 10); td.textContent = formatDuration(Date.now() - ts); });
}

function formatOrigin(origin) { switch (origin) { case 'manual': return 'Manual'; case 'auto': return 'Auto'; case 'new-top': return 'Novo topo'; default: return origin; } }
function parseOrigin(text) { const t = text.trim().toLowerCase(); if (['manual','auto','novo topo','new-top'].includes(t)) return t === 'novo topo' ? 'new-top' : t; return 'manual'; }

function setDrawdownDisplay(ddSigned) {
  const val = ddSigned.toFixed(3);
  const text = (ddSigned > 0 ? '+' : '') + val + ' %';
  $drawdown.textContent = text;
  $drawdown.classList.remove('pos', 'neg');
  if (ddSigned > 0) $drawdown.classList.add('pos'); else if (ddSigned < 0) $drawdown.classList.add('neg');
}

function triggerAlert(price, ddAbs) {
  const ts = new Date().toLocaleString();
  $lastAlert.textContent = `${ts} | preço ${formatPrice(price)} | drawdown ${ddAbs.toFixed(3)}%`;
  if (!muted) { try { beep.currentTime = 0; beep.play(); } catch (_) {} }
  document.body.classList.add('alert'); setTimeout(() => document.body.classList.remove('alert'), 1200);
  fetch('/alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'drawdown-range', message: `Queda dentro do intervalo: ${minPct}% - ${maxPct}%`, price, drawdownPct: Number(ddAbs.toFixed(3)), timestamp: Date.now() }) }).catch(() => {});
}

function formatPrice(p) { return `$ ${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function applySettings() {
  minPct = parseFloat($minThreshold.value);
  maxPct = parseFloat($maxThreshold.value);
  resetMinutes = parseInt($resetWindow.value, 10);
  symbol = ($symbolInput.value || 'btcusdt').toLowerCase();

  if (isNaN(minPct) || isNaN(maxPct) || minPct <= 0 || maxPct <= 0 || minPct > maxPct) { logEvent('error', 'Thresholds inválidos.'); return; }
  if (!/^[a-z0-9]+$/.test(symbol)) { logEvent('error', 'Símbolo inválido.'); return; }

  logEvent('info', `Aplicado: símbolo=${symbol}, min=${minPct}%, max=${maxPct}%, reset=${resetMinutes}min`);
  connect();
}

function resetPeak() { if (lastPrice) { setPeak(lastPrice, 'manual'); logEvent('info', 'Pico resetado manualmente'); } }
function toggleMute() { muted = !muted; $muteBtn.textContent = muted ? 'Som ativar' : 'Silenciar'; }

let cost = { feeBuy: 0.10, feeSell: 0.10, spread: 0.01, slippage: 0.05 };
function applyCosts() {
  cost.feeBuy = parseFloat($feeBuy.value);
  cost.feeSell = parseFloat($feeSell.value);
  cost.spread = parseFloat($spread.value);
  cost.slippage = parseFloat($slippage.value);
  for (const k of Object.keys(cost)) { if (isNaN(cost[k]) || cost[k] < 0) { logEvent('error', `Valor inválido em ${k}`); return; } }
  const total = cost.feeBuy + cost.feeSell + cost.spread + cost.slippage;
  $totalCost.textContent = total.toFixed(3) + ' %';
  $breakeven.textContent = total.toFixed(3) + ' %';
}

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

function updatePeakAge() { const ms = Date.now() - lastPeakResetAt; $peakAge.textContent = formatDuration(ms); }
setInterval(() => { updatePeakAge(); renderPeaksAgeOnly(); renderPeaks(); }, 1000);

// Peaks table functions
function exportPeaksToCSV() {
  const rows = [['Data/Hora', 'Preço', 'Idade (s)', 'DD máx (%)', 'Origem']];
  const now = Date.now();
  for (const p of peaks) {
    const ageMs = now - p.ts;
    const ageSec = Math.floor(ageMs / 1000);
    if (ageSec <= 10) continue;
    rows.push([
      new Date(p.ts).toLocaleString(),
      p.price.toFixed(2),
      ageSec.toString(),
      (p.maxDdAbs || 0).toFixed(3),
      formatOrigin(p.origin)
    ]);
  }
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `peaks_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  logEvent('info', 'Picos exportados para CSV');
}

function clearPeaksTable() {
  if (!confirm('Limpar todos os picos registrados?')) return;
  peaks = [];
  renderPeaks();
  logEvent('info', 'Tabela de picos limpa');
}

function savePeaksEdits() {
  const editableCells = $peaksBody.querySelectorAll('.editable');
  editableCells.forEach(cell => {
    const id = parseInt(cell.dataset.id, 10);
    const field = cell.dataset.field;
    const peak = peaks.find(p => p.id === id);
    if (!peak) return;
    
    if (field === 'ts') {
      try {
        const newDate = new Date(cell.textContent.trim());
        if (!isNaN(newDate.getTime())) peak.ts = newDate.getTime();
      } catch (_) {}
    } else if (field === 'price') {
      const newPrice = parseFloat(cell.textContent.trim());
      if (!isNaN(newPrice)) peak.price = newPrice;
    } else if (field === 'origin') {
      peak.origin = parseOrigin(cell.textContent);
    }
  });
  renderPeaks();
  logEvent('info', 'Edições salvas');
}

function showHelpTour() {
  alert('Tour de ajuda:\n\n' +
    '1. Configure os limites de drawdown (Mín/Máx %)\n' +
    '2. Defina o tempo de reset automático do pico\n' +
    '3. Escolha o símbolo Binance (ex: btcusdt, ethusdt)\n' +
    '4. Clique "Aplicar" para conectar\n' +
    '5. Configure custos de negociação na seção abaixo\n' +
    '6. Monitore os picos recentes na tabela à direita\n' +
    '7. Ajuste o layout usando os controles no topo');
}

$exportPeaks.addEventListener('click', exportPeaksToCSV);
$clearPeaks.addEventListener('click', clearPeaksTable);
$savePeaks.addEventListener('click', savePeaksEdits);
$helpTour.addEventListener('click', showHelpTour);

// Listeners principais
$apply.addEventListener('click', applySettings);
$resetPeakBtn.addEventListener('click', resetPeak);
$muteBtn.addEventListener('click', toggleMute);
$applyCosts.addEventListener('click', applyCosts);

// Layout init
loadLayout();

// Initialize chart
initChart();

// Inicialização
applySettings();
applyCosts();
updatePeakAge();
renderPeaks();