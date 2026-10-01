// Страница калькулятора: собирает настройки, отправляет на сервер, рисует графики (Plotly).

const COLORS = ['#7f7f7f', '#1f77b4', '#17becf', '#2ca02c', '#bcbd22', '#ff7f0e', '#9467bd', '#d62728', '#e377c2', '#8c564b'];
// Общие настройки графиков: без логотипа Plotly, подстраиваются под ширину окна
const PLOT_CONFIG = { displaylogo: false, responsive: true };
const FONT = { family: 'Segoe UI, Arial, sans-serif', size: 13, color: '#222' };
let meta = null;       // список индикаторов с сервера
let current = null;    // последний рассчитанный портфель
let saved = [];        // портфели, добавленные в сравнение

const $ = (id) => document.getElementById(id);
const pct = (x) => (x * 100).toFixed(1).replace('.', ',') + '%';
const assetName = (id) => meta.assets.find((a) => a.id === id).name;
const assetColor = (id) => COLORS[meta.assets.findIndex((a) => a.id === id)];
const criterion = () => document.querySelector('input[name=criterion]:checked').value;
const CRITERION_NAMES = {
  min_vol: 'Мин. волатильность', max_sharpe: 'Макс. Шарп',
  target_return: 'Эффективный риск', target_risk: 'Эффективная доходность',
};

async function start() {
  meta = await (await fetch('/api/meta')).json();

  // Индикаторы. М2 по умолчанию выключена: в неё нельзя вложить деньги.
  $('assets').innerHTML = meta.assets.map((a, i) =>
    `<label><input type="checkbox" value="${a.id}" ${a.id === 'M2' ? '' : 'checked'}>
     ${i + 1}. ${a.name} <span class="note">(${a.source}, с ${meta.first_month[a.id]})</span></label>`).join('');

  const options = meta.months.map((m) => `<option>${m}</option>`).join('');
  $('start').innerHTML = options;
  $('end').innerHTML = options;
  $('end').value = meta.months[meta.months.length - 1];

  document.querySelectorAll('input[name=criterion]').forEach((r) => r.addEventListener('change', showTarget));
  $('form').addEventListener('submit', (e) => { e.preventDefault(); calculate(); });
  $('save').addEventListener('click', savePortfolio);
  $('clear').addEventListener('click', () => { saved = []; drawCurve(); drawCompare(); });
  calculate();
}

// Поле «целевое значение» нужно только для критериев 3 и 4
function showTarget() {
  const c = criterion();
  $('targetRow').hidden = !(c === 'target_return' || c === 'target_risk');
  $('targetLabel').textContent = c === 'target_return'
    ? 'Желаемая доходность, % годовых ' : 'Допустимый риск (волатильность), % годовых ';
}

async function calculate() {
  const c = criterion();
  const body = {
    assets: [...document.querySelectorAll('#assets input:checked')].map((i) => i.value),
    start: $('start').value,
    end: $('end').value,
    criterion: c,
    rf: parseFloat($('rf').value) / 100,
    target: (c === 'target_return' || c === 'target_risk') ? parseFloat($('target').value) / 100 : null,
  };
  const response = await fetch('/api/optimize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();

  const text = result.error || result.note;
  $('message').hidden = !text;
  $('message').textContent = text || '';
  if (result.error) return;

  current = result;
  current.name = CRITERION_NAMES[c];
  drawMetrics();
  drawFrontier();
  drawPie();
  drawCurve();
}

function metricsRow(name, r) {
  const m = r.metrics;
  const recovery = m.max_recovery_months + ' мес.' + (m.recovered ? '' : ' (ещё не восстановился)');
  return `<tr><td>${name}</td><td>${pct(m.mean_return)}</td><td>${pct(m.volatility)}</td>
          <td>${pct(m.max_drawdown)}</td><td>${recovery}</td><td>${r.sharpe.toFixed(2).replace('.', ',')}</td></tr>`;
}
const METRICS_HEAD = `<tr><th>Портфель</th><th>Ожидаемый доход, в год</th><th>Ожидаемая волатильность</th>
  <th>Макс. просадка</th><th>Макс. период восстановления</th><th>Коэф. Шарпа</th></tr>`;

function drawMetrics() {
  $('period').textContent = `(период ${current.period[0]} — ${current.period[1]}, ${current.period[2]} мес.)`;
  $('metrics').innerHTML = METRICS_HEAD + metricsRow(current.name, current);
}

function drawFrontier() {
  const m = current.metrics;
  const traces = [{
    x: current.frontier.map((p) => p[0] * 100), y: current.frontier.map((p) => p[1] * 100),
    mode: 'lines', name: 'Эффективная граница', line: { color: '#2f6fb5', width: 3 },
  }, {
    x: current.assets.map((a) => a.risk * 100), y: current.assets.map((a) => a.ret * 100),
    text: current.assets.map((a) => a.id), mode: 'markers+text', textposition: 'top center',
    name: 'Индикаторы', marker: { color: '#888', size: 8 },
  }, {
    x: [m.volatility * 100], y: [m.mean_return * 100], mode: 'markers', name: 'Выбранный портфель',
    marker: { color: '#d62728', size: 14, symbol: 'star' },
  }];
  Plotly.react('frontier', traces, {
    xaxis: { title: 'Риск (волатильность), % годовых', rangemode: 'tozero' },
    yaxis: { title: 'Ожидаемая доходность, % годовых' },
    margin: { t: 20, r: 20 }, legend: { orientation: 'h', y: -0.25 }, font: FONT,
  }, PLOT_CONFIG);
}

function drawPie() {
  const ids = Object.keys(current.weights).filter((id) => current.weights[id] > 0.0005);
  Plotly.react('pie', [{
    type: 'pie', labels: ids.map(assetName), values: ids.map((id) => current.weights[id]),
    marker: { colors: ids.map(assetColor) }, sort: false,
    textinfo: 'percent', hovertemplate: '%{label}: %{percent}<extra></extra>',
  }], { margin: { t: 20, b: 20 }, font: FONT }, PLOT_CONFIG);
}

function drawCurve() {
  const line = (r, width) => ({ x: r.curve.months, y: r.curve.values, mode: 'lines', name: r.name, line: { width } });
  const traces = saved.map((r) => line(r, 1.5));
  if (current) traces.push(line({ ...current, name: current.name + ' (текущий)' }, 3));
  Plotly.react('curve', traces, {
    yaxis: { title: 'Стоимость 1 рубля' }, margin: { t: 20, r: 20 }, font: FONT,
    legend: { orientation: 'h', y: -0.2 }, hovermode: 'x unified',
  }, PLOT_CONFIG);
}

function savePortfolio() {
  if (!current) return;
  saved.push({ ...current, name: `${saved.length + 1}. ${current.name}` });
  drawCurve();
  drawCompare();
}

function drawCompare() {
  $('compare').innerHTML = saved.length ? METRICS_HEAD + saved.map((r) => metricsRow(r.name, r)).join('') : '';
}

start();
