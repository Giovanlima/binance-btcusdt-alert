// Ajuste: defaults quando inputs não existem e sempre conecta; remove listeners duplicados

// ... [cabeçalhos e refs iguais ao seu arquivo atual] ...

// Defaults seguros quando UI não existe
const DEFAULTS = { minPct: 2.5, maxPct: 3.0, resetMinutes: 60, symbol: 'btcusdt' };

// [funções utilitárias e helpers iguais ao atual]

// ---- applySettings com fallback e sempre chamando connect()
function applySettings(){
  const minVal = Number($minThreshold?.value ?? DEFAULTS.minPct);
  const maxVal = Number($maxThreshold?.value ?? DEFAULTS.maxPct);
  const resetVal = parseInt($resetWindow?.value ?? DEFAULTS.resetMinutes, 10);
  const symVal = ($symbolInput?.value ?? DEFAULTS.symbol).toLowerCase();

  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal) || minVal<=0 || maxVal<=0 || minVal>maxVal) {
    logEvent('warn','Thresholds inválidos; usando padrão 2.5%–3.0%');
    minPct = DEFAULTS.minPct; maxPct = DEFAULTS.maxPct;
  } else { minPct = minVal; maxPct = maxVal; }

  resetMinutes = Number.isFinite(resetVal) ? resetVal : DEFAULTS.resetMinutes;
  symbol = /^[a-z0-9]+$/.test(symVal) ? symVal : DEFAULTS.symbol;

  logEvent('info',`Aplicado: ${symbol}, min=${minPct}%, max=${maxPct}%, reset=${resetMinutes}min`);
  connect();
}

// ---- applyCosts com fallback (não bloqueia boot)
function applyCosts(){
  const feeBuy = Number($feeBuy?.value ?? 0.10);
  const feeSell = Number($feeSell?.value ?? 0.10);
  const spread = Number($spread?.value ?? 0.01);
  const slippage = Number($slippage?.value ?? 0.05);
  const vals = [feeBuy, feeSell, spread, slippage].map(v => Number.isFinite(v) && v>=0 ? v : 0);
  const total = vals.reduce((a,b)=>a+b,0);
  $totalCost && ($totalCost.textContent = total.toFixed(3)+' %');
  $breakeven && ($breakeven.textContent = total.toFixed(3)+' %');
  $breakevenNote && ($breakevenNote.textContent = 'Use ordens limit para reduzir slippage.');
  logEvent('info',`Custos: total=${total.toFixed(3)}%`);
}

// ---- listeners (sem duplicados)
$apply?.addEventListener('click',applySettings);
$resetPeakBtn?.addEventListener('click',()=>{ if(lastPrice!=null){ setPeak(lastPrice,'manual'); logEvent('info','Pico resetado manualmente'); } });
$muteBtn?.addEventListener('click',()=>{ muted=!muted; if($muteBtn) $muteBtn.textContent = muted ? 'Som ativar' : 'Silenciar'; });

$trendWindowSelect?.addEventListener('change',()=>{ const v=parseInt($trendWindowSelect.value,10); if(!isNaN(v)&&v>10&&v<=MAX_BUFFER) trendCfg.window=v; computeAndRenderTrend(); rebuildChart(); });
$chartType?.addEventListener('change',()=>{ rebuildChart(); });
$candleTf?.addEventListener('change',()=>{ timeframeSec=tfToSeconds($candleTf.value); resetCandleAggregation(); if(isCandleMode()&&lwChart&&candleSeries) candleSeries.setData([]); });
$maPreset?.addEventListener('change',()=>{ applyMaPreset($maPreset.value); });

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

// ---- boot
initChartsOnLoad();
applySettings();        // agora sempre conecta, mesmo sem inputs
applyCosts();
computeAndRenderTrend();
updatePeakAge();
renderPeaks();
setTimeout(()=>{ if(!lastMessageAt && !demoMode){ setDiagError('Sem dados nos primeiros 5s'); enableDemo('Sem dados do WS nos primeiros 5s'); } },5000);

// [restante do arquivo igual ao seu (conexão, candle, trend, etc.)]