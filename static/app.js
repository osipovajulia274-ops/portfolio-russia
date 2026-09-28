/* Портфельный калькулятор — клиентская часть.
   Сервер (Flask) считает оптимизацию, здесь — интерфейс и графики (Plotly). */
'use strict';

const S = { meta: null, result: null, criterion: 'max_sharpe', cmp: [], lastFrontier: null };
const CMP_COLORS_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const CMP_COLORS_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const CRIT_DESC = {
  min_vol: 'наименьший риск при любой доходности',
  max_sharpe: 'лучшее соотношение доходность / риск',
  target_return: 'задаю доходность → минимальный риск',
  target_risk: 'задаю допустимый риск → максимум доходности',
};
const CRIT_SHORT = {
  min_vol: 'Мин. волатильность', max_sharpe: 'Макс. Шарп',
  target_return: 'Эффективный риск', target_risk: 'Эффективная доходность',
};

// ---------------------------------------------------------------- утилиты
const $ = (id) => document.getElementById(id);
const pct = (x, d = 1) => (x == null || isNaN(x)) ? '—' : (x * 100).toFixed(d).replace('.', ',') + '%';
const num = (x, d = 2) => (x == null || isNaN(x)) ? '—' : x.toFixed(d).replace('.', ',');
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const isDark = () => css('color-scheme') === 'dark' || document.documentElement.dataset.theme === 'dark';
const cmpColor = (i) => (isDark() ? CMP_COLORS_DARK : CMP_COLORS_LIGHT)[i % 8];
const asset = (id) => S.meta.assets.find((a) => a.id === id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function months(n) {
  if (n == null) return '—';
  const y = n / 12;
  return n + ' мес.' + (n >= 12 ? ` (≈${num(y, 1)} г.)` : '');
}

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || ('Ошибка ' + r.status));
  return j;
}

function busy(on) { $('loading').classList.toggle('hidden', !on); }
function showMsg(text, isErr) {
  const m = $('msg');
  if (!text) { m.classList.add('hidden'); return; }
  m.textContent = text;
  m.classList.remove('hidden');
  m.classList.toggle('err', !!isErr);
}

function baseLayout(extra = {}) {
  return Object.assign({
    paper_bgcolor: css('--surface'), plot_bgcolor: css('--surface'),
    font: { family: 'system-ui, -apple-system, Segoe UI, sans-serif', size: 12, color: css('--ink2') },
    margin: { l: 56, r: 16, t: 10, b: 44 },
    separators: ', ',
    hoverlabel: { bgcolor: css('--surface'), bordercolor: css('--axis'), font: { color: css('--ink') } },
    legend: { orientation: 'h', y: -0.18, font: { size: 11 } },
    xaxis: { gridcolor: css('--grid'), linecolor: css('--axis'), zerolinecolor: css('--axis') },
    yaxis: { gridcolor: css('--grid'), linecolor: css('--axis'), zerolinecolor: css('--axis') },
  }, extra);
}
const PCFG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

// ---------------------------------------------------------------- настройки
function selectedAssets() {
  return [...document.querySelectorAll('#assetList input:checked')].map((i) => i.value);
}

function settings() {
  const crit = S.criterion;
  const t = parseFloat($('target').value);
  return {
    assets: selectedAssets(),
    start: $('start').value,
    end: $('end').value,
    deflator: document.querySelector('input[name=deflator]:checked').value,
    criterion: crit,
    target: (crit === 'target_return' || crit === 'target_risk') ? t / 100 : null,
    rf: parseFloat($('rf').value) / 100,
    max_weight: parseInt($('maxW').value, 10) / 100,
    rebalance: $('rebalance').checked,
  };
}

// ---------------------------------------------------------------- инициализация
async function init() {
  S.meta = await api('/api/meta');
  const m = S.meta;
  $('dataRange').textContent = `данные: ${m.months[0]} — ${m.months[m.months.length - 1]}, ${m.months.length} мес.`;

  // список индикаторов
  $('assetList').innerHTML = m.assets.map((a, i) => {
    const av = m.availability[a.id];
    return `<label class="asset" title="${esc(a.note)}">
      <input type="checkbox" value="${a.id}" ${m.default_selected.includes(a.id) ? 'checked' : ''}>
      <span class="dot" style="background:${a.color}"></span>
      <span><span class="nm">${i + 1}. ${esc(a.name)}</span>
      <span class="av">${esc(a.class)} · ${esc(a.source)} · с ${av.from}</span></span></label>`;
  }).join('');
  $('assetList').addEventListener('change', buildManual);

  // период
  const opts = m.months.map((x) => `<option value="${x}">${x}</option>`).join('');
  $('start').innerHTML = opts; $('end').innerHTML = opts;
  $('start').value = m.months[0]; $('end').value = m.months[m.months.length - 1];

  // критерии
  $('criteria').innerHTML = Object.entries(m.criteria).map(([k, v], i) =>
    `<div class="crit ${k === S.criterion ? 'on' : ''}" data-k="${k}">
       <input type="radio" name="crit" value="${k}" ${k === S.criterion ? 'checked' : ''}>
       <div><b>${i + 1}. ${esc(CRIT_SHORT[k])}</b><span>${esc(CRIT_DESC[k])}</span></div></div>`).join('');
  document.querySelectorAll('.crit').forEach((el) => el.addEventListener('click', () => {
    S.criterion = el.dataset.k;
    document.querySelectorAll('.crit').forEach((e) => {
      e.classList.toggle('on', e === el);
      e.querySelector('input').checked = e === el;
    });
    updateTargetBox();
  }));
  updateTargetBox();

  $('rfAvg').textContent = `Подставить среднюю реальную ключевую ставку за период (${pct(m.avg_real_key_rate)})`;
  $('rfAvg').onclick = () => { $('rf').value = (m.avg_real_key_rate * 100).toFixed(2); };
  $('maxW').oninput = () => { $('maxWVal').textContent = $('maxW').value + '%'; };

  $('selAll').onclick = () => { document.querySelectorAll('#assetList input').forEach((i) => { i.checked = true; }); buildManual(); };
  $('selNone').onclick = () => { document.querySelectorAll('#assetList input').forEach((i) => { i.checked = false; }); buildManual(); };
  $('selDefault').onclick = () => { document.querySelectorAll('#assetList input').forEach((i) => { i.checked = m.default_selected.includes(i.value); }); buildManual(); };

  $('runBtn').onclick = run;
  $('runAllBtn').onclick = runAll;
  $('addCmp').onclick = addCurrentToCmp;
  $('clearCmp').onclick = () => { S.cmp = []; renderCmp(); };
  $('evalManual').onclick = evalManual;
  $('equalW').onclick = () => {
    const ins = document.querySelectorAll('#manualWeights input');
    ins.forEach((i) => { i.value = (100 / ins.length).toFixed(1); });
  };
  $('logScale').onchange = () => S.result && renderCurve(S.result);
  $('showBench').onchange = () => S.result && renderCurve(S.result);
  $('themeBtn').onclick = toggleTheme;

  buildManual();
  await run();
}

function toggleTheme() {
  const root = document.documentElement;
  root.dataset.theme = isDark() ? 'light' : 'dark';
  if (S.result) renderAll(S.result, S.resultTitle);
  renderCmp();
}

function updateTargetBox() {
  const c = S.criterion;
  const on = c === 'target_return' || c === 'target_risk';
  $('targetBox').classList.toggle('hidden', !on);
  if (c === 'target_return') {
    $('targetLabel').textContent = 'Желаемая доходность (реальная), % годовых';
    if (!$('target').dataset.touchedR) $('target').value = 5;
  } else if (c === 'target_risk') {
    $('targetLabel').textContent = 'Допустимая волатильность (риск), % годовых';
    if (!$('target').dataset.touchedV) $('target').value = 10;
  }
  updateTargetHint();
}

function updateTargetHint() {
  const f = S.lastFrontier;
  if (!f || !f.length) { $('targetHint').textContent = ''; return; }
  const rs = f.map((p) => p.ret), vs = f.map((p) => p.vol);
  $('targetHint').textContent = S.criterion === 'target_return'
    ? `На эффективной границе доходность от ${pct(Math.min(...rs))} до ${pct(Math.max(...rs))}.`
    : `На эффективной границе риск от ${pct(Math.min(...vs))} до ${pct(Math.max(...vs))}.`;
}

function buildManual() {
  const sel = selectedAssets();
  const w = (S.result && S.result.weights) || {};
  $('manualWeights').innerHTML = sel.map((id) => {
    const a = asset(id);
    const v = w[id] != null ? (w[id] * 100).toFixed(1) : (100 / sel.length).toFixed(1);
    return `<label><span class="dot" style="background:${a.color};width:10px;height:10px;border-radius:50%"></span>
      <span>${esc(a.name)}</span><input type="number" step="1" min="0" data-id="${id}" value="${v}"></label>`;
  }).join('');
}

// ---------------------------------------------------------------- расчёт
async function run() {
  showMsg('');
  const st = settings();
  busy(true);
  try {
    const res = await api('/api/optimize', st);
    S.result = res;
    S.lastFrontier = res.frontier;
    S.frontierRes = res;
    S.resultTitle = res.criterion_name;
    renderAll(res, res.criterion_name);
    updateTargetHint();
    buildManual();
    if (res.message) showMsg(res.message);
    await refreshCmp();
  } catch (e) {
    showMsg(e.message, true);
  } finally { busy(false); }
}

async function runAll() {
  showMsg('');
  const base = settings();
  busy(true);
  try {
    // сначала найдём особые точки, чтобы разумно выбрать цели для критериев 3 и 4
    const ms = await api('/api/optimize', { ...base, criterion: 'max_sharpe', target: null });
    const mv = ms.min_vol_point, sp = ms.max_sharpe_point;
    const tRet = base.criterion === 'target_return' && base.target != null ? base.target : (mv.ret + sp.ret) / 2;
    const tRisk = base.criterion === 'target_risk' && base.target != null ? base.target : (mv.vol + sp.vol) / 2;
    const jobs = [
      ['min_vol', null, 'Мин. волатильность'],
      ['max_sharpe', null, 'Макс. Шарп'],
      ['target_return', tRet, `Эфф. риск (μ=${pct(tRet)})`],
      ['target_risk', tRisk, `Эфф. доходность (σ≤${pct(tRisk)})`],
    ];
    S.cmp = [];
    for (const [c, t, name] of jobs) {
      const r = c === 'max_sharpe' ? ms : await api('/api/optimize', { ...base, criterion: c, target: t });
      S.cmp.push({ name, weights: r.weights });
    }
    S.result = ms; S.lastFrontier = ms.frontier; S.frontierRes = ms; S.resultTitle = ms.criterion_name;
    renderAll(ms, ms.criterion_name);
    await refreshCmp();
    showMsg('Все четыре критерия рассчитаны и добавлены в раздел «Сравнение портфелей» ниже.');
    $('cmpChart').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    showMsg(e.message, true);
  } finally { busy(false); }
}

async function evalManual() {
  const weights = {};
  document.querySelectorAll('#manualWeights input').forEach((i) => { weights[i.dataset.id] = parseFloat(i.value) || 0; });
  const st = settings();
  busy(true);
  try {
    const res = await api('/api/evaluate', { ...st, weights });
    S.result = { ...res, frontier: S.frontierRes && S.frontierRes.frontier };
    S.resultTitle = 'Ручной портфель';
    renderAll(S.result, 'Ручной портфель', true);
    showMsg('Показан портфель с ручными весами (веса нормированы к 100%).');
  } catch (e) { showMsg(e.message, true); } finally { busy(false); }
}

// ---------------------------------------------------------------- отрисовка
function renderAll(res, title, manual) {
  $('resTitle').textContent = title;
  $('resPeriod').textContent = `период ${res.period.from} — ${res.period.to} (${res.period.months} мес.), реальные доходности`;
  renderKPIs(res);
  renderFrontier(S.frontierRes || res, manual ? res : null);
  renderPie(res);
  renderCurve(res);
  if (!manual && res.asset_stats) { renderAssetTable(res); renderCorr(res); }
}

function renderKPIs(res) {
  const m = res.metrics, e = res.expected;
  const tiles = [
    ['Ожидаемая доходность', pct(e.ret), 'μ, реальная, % годовых'],
    ['Ожидаемая волатильность', pct(e.vol), 'σ, риск, % годовых'],
    ['Коэффициент Шарпа', num(e.sharpe), `при ставке ${pct(parseFloat($('rf').value) / 100, 2)}`],
    ['Среднегодовая доходность', pct(m.cagr), 'CAGR по кривой доходности'],
    ['Максимальная просадка', pct(m.max_drawdown), 'падение от пика'],
    ['Макс. период восстановления', months(m.max_recovery_months), m.unrecovered ? 'ещё не восстановился' : 'от пика до возврата к нему'],
  ];
  $('kpis').innerHTML = tiles.map(([l, v, d]) =>
    `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
}

function renderFrontier(res, manual) {
  const traces = [];
  const ink = css('--ink');
  if (res.cloud) {
    traces.push({
      x: res.cloud.vol.map((v) => v * 100), y: res.cloud.ret.map((v) => v * 100),
      mode: 'markers', type: 'scattergl', name: 'Случайные портфели',
      marker: { size: 4, color: css('--cloud'), opacity: 0.55 },
      hovertemplate: 'σ %{x:.1f}% · μ %{y:.1f}%<extra>случайный</extra>',
    });
  }
  if (res.frontier) {
    traces.push({
      x: res.frontier.map((p) => p.vol * 100), y: res.frontier.map((p) => p.ret * 100),
      mode: 'lines', name: 'Эффективная граница', line: { color: css('--accent'), width: 3 },
      customdata: res.frontier.map((p) => topWeights(res.assets_points.map((a) => a.id), p.w)),
      hovertemplate: 'σ %{x:.2f}% · μ %{y:.2f}%<br>%{customdata}<extra>граница</extra>',
    });
  }
  if (res.max_sharpe_point) {
    const sp = res.max_sharpe_point, rf = res.rf;
    const xMax = Math.max(...res.frontier.map((p) => p.vol)) * 100;
    const slope = (sp.ret - rf) / sp.vol;
    traces.push({
      x: [0, xMax], y: [rf * 100, (rf + slope * xMax / 100) * 100], mode: 'lines',
      name: 'Линия рынка капитала (CML)', line: { color: css('--muted'), dash: 'dash', width: 1.5 },
      hoverinfo: 'skip',
    });
  }
  if (res.assets_points) {
    res.assets_points.forEach((p) => {
      const a = asset(p.id);
      traces.push({
        x: [p.vol * 100], y: [p.ret * 100], mode: 'markers+text', name: a.name, showlegend: false,
        text: [p.id], textposition: 'top center', textfont: { size: 11, color: css('--ink2') },
        marker: { size: 11, color: a.color, line: { color: css('--surface'), width: 2 } },
        hovertemplate: `<b>${esc(a.name)}</b><br>σ %{x:.1f}% · μ %{y:.1f}%<extra></extra>`,
      });
    });
  }
  if (res.min_vol_point) {
    traces.push({
      x: [res.min_vol_point.vol * 100], y: [res.min_vol_point.ret * 100], mode: 'markers', name: 'Мин. волатильность',
      marker: { symbol: 'diamond', size: 14, color: css('--good'), line: { color: css('--surface'), width: 2 } },
      hovertemplate: 'Мин. волатильность<br>σ %{x:.2f}% · μ %{y:.2f}%<extra></extra>',
    });
    traces.push({
      x: [res.max_sharpe_point.vol * 100], y: [res.max_sharpe_point.ret * 100], mode: 'markers', name: 'Макс. Шарп',
      marker: { symbol: 'star', size: 17, color: '#eda100', line: { color: css('--surface'), width: 1.5 } },
      hovertemplate: 'Макс. коэффициент Шарпа<br>σ %{x:.2f}% · μ %{y:.2f}%<extra></extra>',
    });
  }
  const cur = manual || S.result;
  if (cur && cur.expected) {
    traces.push({
      x: [cur.expected.vol * 100], y: [cur.expected.ret * 100], mode: 'markers',
      name: manual ? 'Ручной портфель' : 'Выбранный портфель',
      marker: { symbol: 'circle-open', size: 20, color: ink, line: { width: 3, color: ink } },
      hovertemplate: 'Выбранный портфель<br>σ %{x:.2f}% · μ %{y:.2f}%<extra></extra>',
    });
  }
  // сравниваемые портфели — на ту же плоскость
  S.cmp.forEach((c, i) => {
    if (!c.res) return;
    traces.push({
      x: [c.res.expected.vol * 100], y: [c.res.expected.ret * 100], mode: 'markers', name: c.name,
      marker: { symbol: 'square', size: 10, color: cmpColor(i), line: { color: css('--surface'), width: 2 } },
      hovertemplate: `${esc(c.name)}<br>σ %{x:.2f}% · μ %{y:.2f}%<extra></extra>`,
    });
  });
  Plotly.react('frontierChart', traces, baseLayout({
    xaxis: { title: 'Риск — волатильность σ, % годовых', ticksuffix: '%', gridcolor: css('--grid'), zerolinecolor: css('--axis'), rangemode: 'tozero' },
    yaxis: { title: 'Ожидаемая доходность μ, %', ticksuffix: '%', gridcolor: css('--grid'), zerolinecolor: css('--axis') },
    legend: { orientation: 'h', y: -0.22, font: { size: 11 } },
    margin: { l: 60, r: 16, t: 10, b: 60 },
  }), PCFG);
}

function topWeights(ids, w) {
  return ids.map((id, i) => [id, w[i]]).filter((x) => x[1] > 0.005)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, v]) => `${asset(id).name}: ${pct(v, 0)}`).join('<br>');
}

function renderPie(res) {
  const items = Object.entries(res.weights).filter(([, v]) => v > 0.0005).sort((a, b) => b[1] - a[1]);
  const data = [{
    type: 'pie', hole: 0.5, sort: false, direction: 'clockwise',
    labels: items.map(([id]) => asset(id).name), values: items.map(([, v]) => v),
    customdata: items.map(([id]) => id),
    marker: { colors: items.map(([id]) => asset(id).color), line: { color: css('--surface'), width: 2 } },
    textinfo: 'percent', textposition: 'inside', insidetextorientation: 'horizontal',
    hovertemplate: '<b>%{label}</b><br>доля %{percent}<extra></extra>',
    pull: items.map(() => 0),
  }];
  const layout = baseLayout({
    margin: { l: 10, r: 10, t: 10, b: 10 }, showlegend: true,
    legend: { orientation: 'v', x: 1, y: 0.5, font: { size: 11 } },
    annotations: [{ text: `${items.length}<br><span style="font-size:11px">актив(ов)</span>`, showarrow: false, font: { size: 18, color: css('--ink') } }],
  });
  Plotly.react('pieChart', data, layout, PCFG).then((gd) => {
    gd.removeAllListeners && gd.removeAllListeners('plotly_click');
    gd.on('plotly_click', (ev) => {
      const pt = ev.points[0];
      const id = pt.customdata;
      const a = asset(id);
      const st = (S.frontierRes && S.frontierRes.asset_stats || []).find((x) => x.id === id);
      $('sliceInfo').innerHTML = `<b>${esc(a.name)}</b> — доля ${pct(res.weights[id])}. ${esc(a.note)}` +
        (st ? `<br>Сам по себе: μ ${pct(st.mean_return)}, σ ${pct(st.volatility)}, просадка ${pct(st.max_drawdown)}.` : '');
      const pull = items.map((_, i) => (i === pt.pointNumber ? 0.08 : 0));
      Plotly.restyle('pieChart', { pull: [pull] });
    });
  });
  $('sliceInfo').textContent = 'Нажмите на сектор диаграммы, чтобы увидеть описание актива.';
}

function renderCurve(res) {
  const x = res.curve.months;
  const log = $('logScale').checked;
  const traces = [{
    x, y: res.curve.values, name: 'Портфель', mode: 'lines',
    line: { color: css('--accent'), width: 3 },
    hovertemplate: '%{y:.3f} ₽<extra>Портфель</extra>',
  }];
  if ($('showBench').checked && res.benchmarks) {
    const bm = [['M2', 'Денежная масса М2', 'dot'], ['MCFTR', 'Акции (MCFTR)', 'dash'], ['DEPOSIT', 'Депозит', 'dashdot']];
    bm.forEach(([id, nm, dash]) => traces.push({
      x, y: res.benchmarks[id], name: nm, mode: 'lines',
      line: { color: asset(id).color, width: 1.5, dash },
      hovertemplate: `%{y:.3f} ₽<extra>${nm}</extra>`,
    }));
  }
  Plotly.react('curveChart', traces, baseLayout({
    hovermode: 'x unified',
    yaxis: { title: 'Стоимость 1 ₽ (реальная)', type: log ? 'log' : 'linear', gridcolor: css('--grid'), zerolinecolor: css('--axis') },
    xaxis: { gridcolor: css('--grid'), linecolor: css('--axis') },
    shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 1, y1: 1, line: { color: css('--axis'), width: 1 } }],
  }), PCFG);

  const m = res.metrics;
  const span = m.recovery_span;
  const shapes = [];
  if (m.max_recovery_months > 0) {
    shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: x[span[0]], x1: x[span[1]], y0: 0, y1: 1,
      fillcolor: css('--grid'), opacity: 0.6, line: { width: 0 }, layer: 'below' });
  }
  Plotly.react('ddChart', [{
    x, y: res.curve.drawdown.map((v) => v * 100), name: 'Просадка', mode: 'lines', fill: 'tozeroy',
    line: { color: css('--bad'), width: 1.5 }, fillcolor: 'rgba(208,59,59,0.18)',
    hovertemplate: '%{y:.1f}%<extra>Просадка</extra>',
  }], baseLayout({
    hovermode: 'x unified', showlegend: false, shapes,
    margin: { l: 56, r: 16, t: 24, b: 30 },
    title: { text: 'Просадка от максимума (серым — самый долгий период восстановления)', font: { size: 12, color: css('--ink2') }, x: 0, xanchor: 'left' },
    yaxis: { ticksuffix: '%', gridcolor: css('--grid'), zerolinecolor: css('--axis') },
  }), PCFG);
}

function renderAssetTable(res) {
  const rows = res.asset_stats.map((s) => {
    const a = asset(s.id);
    return `<tr><td><span class="sw" style="background:${a.color}"></span>${esc(a.name)}</td>
      <td class="${s.mean_return >= 0 ? 'pos' : 'neg'}">${pct(s.mean_return)}</td><td>${pct(s.cagr)}</td>
      <td>${pct(s.volatility)}</td><td>${num(s.sharpe)}</td><td>${pct(s.max_drawdown)}</td>
      <td>${s.max_recovery_months}${s.unrecovered ? '*' : ''}</td></tr>`;
  }).join('');
  $('assetTable').innerHTML = `<thead><tr><th>Индикатор</th><th>μ</th><th>CAGR</th><th>σ</th><th>Шарп</th><th>Просадка</th><th>Восст., мес.</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="7" class="muted small" style="text-align:left">Реальные доходности, % годовых. * — к концу периода ещё не восстановился.</td></tr></tfoot>`;
}

function renderCorr(res) {
  const ids = res.corr.assets;
  const z = res.corr.matrix;
  const lbl = ids;
  const annotations = [];
  z.forEach((row, i) => row.forEach((v, j) => annotations.push({
    x: lbl[j], y: lbl[i], text: num(v, 2), showarrow: false,
    font: { size: 10, color: Math.abs(v) > 0.6 ? '#ffffff' : css('--ink') },
  })));
  Plotly.react('corrChart', [{
    type: 'heatmap', z, x: lbl, y: lbl, zmin: -1, zmax: 1,
    colorscale: [[0, '#2a78d6'], [0.5, isDark() ? '#383835' : '#f0efec'], [1, '#e34948']],
    hovertemplate: '%{y} × %{x}: %{z:.2f}<extra></extra>', xgap: 2, ygap: 2,
    colorbar: { thickness: 10, outlinewidth: 0 },
  }], baseLayout({ annotations, margin: { l: 70, r: 10, t: 10, b: 70 }, yaxis: { autorange: 'reversed' } }), PCFG);
}

// ---------------------------------------------------------------- сравнение портфелей
function addCurrentToCmp() {
  if (!S.result) return;
  if (S.cmp.length >= 8) { showMsg('В сравнении максимум 8 портфелей — удалите лишние.', true); return; }
  const name = $('cmpName').value.trim() || `${S.resultTitle && CRIT_SHORT[S.result.criterion] || S.resultTitle || 'Портфель'} #${S.cmp.length + 1}`;
  S.cmp.push({ name, weights: { ...S.result.weights } });
  $('cmpName').value = '';
  refreshCmp();
}

async function refreshCmp() {
  if (!S.cmp.length) { renderCmp(); return; }
  const st = settings();
  try {
    let res = await Promise.all(S.cmp.map((c) => api('/api/evaluate', { ...st, weights: c.weights })));
    // у портфелей из разных активов может отличаться начало данных — выравниваем по общему периоду
    const from = res.map((r) => r.period.from).sort().pop();
    if (res.some((r) => r.period.from !== from)) {
      res = await Promise.all(S.cmp.map((c) => api('/api/evaluate', { ...st, start: from, weights: c.weights })));
    }
    S.cmp.forEach((c, i) => { c.res = res[i]; });
  } catch (e) { showMsg(e.message, true); }
  renderCmp();
  if (S.frontierRes) renderFrontier(S.frontierRes);
}

function renderCmp() {
  const has = S.cmp.filter((c) => c.res);
  if (!has.length) {
    Plotly.react('cmpChart', [], baseLayout({
      annotations: [{ text: 'Добавьте портфели кнопкой «+ Добавить текущий в сравнение» или «Сравнить все 4 критерия»', showarrow: false, font: { color: css('--muted') } }],
      xaxis: { visible: false }, yaxis: { visible: false },
    }), PCFG);
    $('cmpTable').innerHTML = '';
    return;
  }
  const traces = S.cmp.map((c, i) => c.res && ({
    x: c.res.curve.months, y: c.res.curve.values, name: c.name, mode: 'lines',
    line: { color: cmpColor(i), width: 2.2 },
    hovertemplate: `%{y:.3f} ₽<extra>${esc(c.name)}</extra>`,
  })).filter(Boolean);
  const r0 = has[0].res;
  traces.push({ x: r0.curve.months, y: r0.benchmarks.M2, name: 'Денежная масса М2', mode: 'lines',
    line: { color: css('--muted'), width: 1.5, dash: 'dot' }, hovertemplate: '%{y:.3f} ₽<extra>М2</extra>' });
  Plotly.react('cmpChart', traces, baseLayout({
    hovermode: 'x unified',
    yaxis: { title: 'Стоимость 1 ₽ (реальная)', type: $('logScale').checked ? 'log' : 'linear', gridcolor: css('--grid'), zerolinecolor: css('--axis') },
    shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 1, y1: 1, line: { color: css('--axis'), width: 1 } }],
  }), PCFG);

  const rows = S.cmp.map((c, i) => {
    if (!c.res) return '';
    const m = c.res.metrics, e = c.res.expected;
    const w = Object.entries(c.res.weights).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1])
      .map(([id, v]) => `${id} ${pct(v, 0)}`).join(', ');
    return `<tr><td><span class="sw" style="background:${cmpColor(i)}"></span>${esc(c.name)}</td>
      <td>${pct(e.ret)}</td><td>${pct(e.vol)}</td><td>${num(e.sharpe)}</td><td>${pct(m.cagr)}</td>
      <td>${pct(m.max_drawdown)}</td><td>${m.max_recovery_months}${m.unrecovered ? '*' : ''}</td>
      <td style="text-align:left;white-space:normal;min-width:220px" class="small">${esc(w)}</td>
      <td><button class="ghost" data-del="${i}" title="Убрать">✕</button></td></tr>`;
  }).join('');
  $('cmpTable').innerHTML = `<thead><tr><th>Портфель</th><th>μ</th><th>σ</th><th>Шарп</th><th>CAGR</th><th>Просадка</th><th>Восст., мес.</th><th style="text-align:left">Веса</th><th></th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="9" class="muted small" style="text-align:left">Период ${r0.period.from} — ${r0.period.to}. Реальные доходности, % годовых.</td></tr></tfoot>`;
  document.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    S.cmp.splice(parseInt(b.dataset.del, 10), 1);
    renderCmp();
    if (S.frontierRes) renderFrontier(S.frontierRes);
  });
}

$('target') && $('target').addEventListener('input', () => {
  if (S.criterion === 'target_return') $('target').dataset.touchedR = 1; else $('target').dataset.touchedV = 1;
});

window.addEventListener('DOMContentLoaded', () => {
  if (typeof Plotly === 'undefined') {
    showMsg('Не загрузилась библиотека графиков Plotly (нужен интернет). Обновите страницу.', true);
    return;
  }
  init().catch((e) => showMsg('Ошибка загрузки: ' + e.message, true));
});
