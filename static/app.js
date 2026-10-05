// Страница калькулятора: собирает настройки, отправляет на сервер, рисует результат (графики — Plotly).
// Все расчёты делает сервер. Здесь только показ: числа, графики, пояснения к этапам расчёта.

// Цвет закреплён за индикатором: на диаграмме и в списке он всегда один и тот же
const ASSET_COLORS = {
  M2: '#8a8f98', MCFTR: '#2a78d6', MESMTR: '#86b6ef', RGBITR: '#008300', CORP: '#1baf7a',
  GOLD: '#eda100', SILVER: '#a8a69e', CNY: '#e34948', USD: '#eb6834', REALTY: '#4a3aa7',
};
// Цвета для индикаторов из своего файла: назначаются по порядку столбцов
const CUSTOM_COLORS = ['#2a78d6', '#eda100', '#1baf7a', '#e34948', '#4a3aa7', '#eb6834', '#86b6ef', '#008300', '#e87ba4', '#a8a69e',
                       '#1c5aa6', '#b87b00', '#0f7f58', '#a82e2d', '#8478d1', '#f29a73', '#4f8fd9', '#55ad55', '#c2507c', '#6f6d66'];
// Цвета линий сохранённых портфелей в сравнении (текущий портфель всегда фиолетовый)
const LINE_COLORS = ['#ff8a3d', '#19c39a', '#22b8e0', '#eda100', '#e87ba4', '#008300', '#e34948', '#86b6ef'];
const CURRENT_COLOR = '#6d5efc';
const STAR_COLOR = '#ff4d8d';       // звезда выбранного портфеля на эффективной границе
const LOSS_COLOR = '#ff8a3d';       // то, что уменьшает результат: инфляция, комиссии, налог, просадка
const WAIT_COLOR = '#12a9cf';       // ожидание: период восстановления
const INK = '#1a1433';
const CRITERION_NAMES = {
  min_vol: 'Минимальная волатильность', max_sharpe: 'Максимальный коэффициент Шарпа',
  target_return: 'Эффективный риск', target_risk: 'Эффективная доходность',
};
// Шесть этапов расчёта — в том порядке, в каком их проходит сервер
const STAGES = [['data', 'Данные'], ['period', 'Общий период'], ['inflation', 'Инфляция'],
                ['stats', 'Статистика'], ['optimize', 'Оптимизация'], ['result', 'Результат']];
// Словарь: пояснения к терминам. Показываются при наведении на подчёркнутое слово
const GLOSSARY = {
  real: ['Доходность после инфляции', 'Показывает, на сколько выросла покупательная способность денег, а не их количество. 10% в рублях при инфляции 6% — это около 3,8% после инфляции.'],
  vol: ['Волатильность', 'Размах колебаний доходности за год (стандартное отклонение). Чем она выше, тем сильнее результат может отличаться от среднего — в обе стороны. В теории портфеля это и есть риск.'],
  sharpe: ['Коэффициент Шарпа', '(доходность − безрисковая ставка) / волатильность. Сколько дохода сверх ставки приходится на единицу риска. Больше — лучше; ниже нуля — выгоднее была бы сама ставка.'],
  frontier: ['Эффективная граница', 'Линия лучших портфелей: для каждого уровня риска — портфель с наибольшей доходностью. Ниже и правее линии — портфели хуже, выше и левее — недостижимо.'],
  drawdown: ['Просадка', 'На сколько процентов стоимость портфеля опускалась ниже своей прошлой вершины. Максимальная просадка — самое глубокое такое падение за период.'],
  recovery: ['Период восстановления', 'Сколько месяцев подряд портфель оставался ниже своей прошлой вершины. Максимальный — самое долгое такое ожидание.'],
  corr: ['Корреляция', 'Число от −1 до +1: насколько два индикатора движутся вместе. +1 — одинаково, 0 — независимо, −1 — в противоположные стороны.'],
  sortino: ['Риск потерь и коэффициент Сортино', 'Риск потерь — колебания только вниз: прибыльные месяцы не считаются риском. Сортино — как Шарп, но делится на риск потерь.'],
  m2: ['Денежная масса М2', 'Все рубли страны: наличные и деньги на счетах и вкладах. Вложить в неё нельзя, но с её ростом можно сравнивать портфель.'],
};
// Общие настройки графиков
const PLOT_CONFIG = { displaylogo: false, responsive: true };
const AXIS = { gridcolor: 'rgba(109,94,252,0.10)', zerolinecolor: 'rgba(26,20,51,0.25)', linecolor: 'rgba(26,20,51,0.25)' };
const axisTitle = (text) => ({ text, font: { size: 13 } });
// Куда ставить подпись точки на графике границы, чтобы близкие точки не закрывали друг друга
const LABEL_SIDE = { USD: 'bottom center', CORP: 'middle right', RGBITR: 'middle right', MESMTR: 'bottom center' };
const LAYOUT = {
  font: { family: 'Manrope, "Segoe UI", system-ui, Arial, sans-serif', size: 13, color: '#4b4668' },
  paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
  margin: { t: 10, r: 16, l: 56, b: 44 },
  separators: ', ',                 // десятичная запятая на осях и в подсказках
  hoverlabel: { bgcolor: INK, bordercolor: INK, font: { color: '#ffffff', size: 13 } },
};

let meta = null;          // список индикаторов и месяцев того набора данных, с которым идёт работа
let builtinMeta = null;   // то же для встроенных данных
let custom = null;        // загруженный файл: номер таблицы на сервере, сама таблица, отчёт о чтении, выбранные файлы
let source = 'builtin';   // откуда данные: 'builtin' — встроенные, 'file' — свой файл
let current = null;       // последний рассчитанный портфель
let previous = null;      // показатели прошлого расчёта — чтобы показать, что изменилось
let last = null;          // прошлый расчёт целиком — для карточки «что изменилось» и кнопки «вернуть как было»
let quiet = false;        // true — карточку «что изменилось» не показывать (сменили данные или нажали «вернуть»)
let toastTimer = null;    // когда спрятать карточку «что изменилось»
let saved = [];           // портфели, добавленные в сравнение
let tab = 'portfolio';    // открытая вкладка результатов
let curveMode = 'value';  // что показывает график кривой: рост рубля или просадку
let openStage = null;     // этап расчёта, по которому открыты подробности
let openHow = new Set();  // раскрытые сноски «как посчитано»
let timer = null;         // отложенный запуск расчёта
let stageTimer = null;    // «бегущий огонёк» по этапам, пока сервер считает
let requestId = 0;        // номер последнего запроса к серверу
let pieIds = [];          // индикаторы на диаграмме, в порядке секторов
let highlighted = null;   // индикатор, подсвеченный сейчас в таблице долей
let futureSplit = null;   // месяц, которым пользователь закончил раннюю часть в проверке на «будущем»

const $ = (id) => document.getElementById(id);
// Число с запятой и настоящим минусом; «−0,0» превращается в «0,0»
const fix = (x, digits) => { const s = x.toFixed(digits); return (Number(s) === 0 ? (0).toFixed(digits) : s).replace('.', ',').replace('-', '−'); };
const pct = (x) => fix(x * 100, 1) + '%';
const pct2 = (x) => fix(x * 100, 2) + '%';
const num = (x) => fix(x, 2);
const rub = (x) => fix(x, 2) + ' ₽';
const signed = (x, format) => (x > 0 ? '+' : '') + format(x);
const points = (x) => fix(x * 100, 1) + ' п.п.';                 // процентные пункты
const assetName = (id) => (meta.assets.find((a) => a.id === id) || { name: id }).name;
const shortName = (id) => assetName(id).replace(/ \(.*\)/, '');     // без кода индекса в скобках
// Цвет индикатора: у встроенных свой, у столбцов из файла — по порядку
const color = (id) => ASSET_COLORS[id] || CUSTOM_COLORS[Math.max(meta.assets.findIndex((a) => a.id === id), 0) % CUSTOM_COLORS.length];
// Короткая подпись для графиков: код встроенного индикатора или начало названия столбца
const label = (id) => (ASSET_COLORS[id] ? id : assetName(id).length > 16 ? assetName(id).slice(0, 15) + '…' : assetName(id));
const dot = (id) => `<span class="dot" style="background:${color(id)}"></span>`;
// Название с цветной точкой: точка остаётся слева, даже если название переносится на вторую строку
const named = (id, text) => `<span class="named">${dot(id)}<span>${text}</span></span>`;
// Слово с пояснением из словаря
const term = (key, text) => `<dfn data-term="${key}" tabindex="0">${text}</dfn>`;
const whole = (x) => fix(x * 100, 0) + '%';
const criterion = () => document.querySelector('input[name=criterion]:checked').value;
const needsTarget = (c) => c === 'target_return' || c === 'target_risk';
const sum = (list) => list.reduce((a, b) => a + b, 0);
const table = (head, rows) => `<div class="scroll"><table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>` +
  rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') + '</table></div>';

function showMessage(text) {
  $('message').hidden = !text;
  $('message').textContent = text || '';
}

async function start() {
  if (!window.Plotly) {
    showMessage('Не загрузилась библиотека графиков Plotly. Проверьте интернет или положите файл plotly.min.js в папку static.');
    return;
  }
  builtinMeta = await (await fetch('/api/meta')).json();

  // Любое изменение на панели: подправить связанные поля и через треть секунды пересчитать.
  // Исключение — блок загрузки файла: там изменение означает «прочитать файл заново».
  $('form').addEventListener('input', (e) => {
    if (e.target.closest('#uploadBox')) { uploadChanged(e.target); return; }
    syncControls(e.target);
    schedule();
  });
  $('source').addEventListener('click', chooseSource);
  ['dragover', 'dragleave', 'drop'].forEach((type) => $('drop').addEventListener(type, dropFiles));
  document.querySelectorAll('input[name=criterion]').forEach((r) => r.addEventListener('change', () => showTarget(true)));
  $('form').addEventListener('submit', (e) => { e.preventDefault(); calculate(); });
  $('allAssets').addEventListener('click', () => checkAssets(() => true));
  $('defaultAssets').addEventListener('click', () => checkAssets((id) => id !== 'M2'));
  $('presets').addEventListener('click', choosePeriod);
  $('tabs').addEventListener('click', chooseTab);
  $('results').addEventListener('click', chooseStage);
  $('results').addEventListener('toggle', rememberHow, true);
  $('curveMode').addEventListener('click', chooseCurveMode);
  $('save').addEventListener('click', savePortfolio);
  $('clear').addEventListener('click', () => { saved = []; drawCurve(); drawCompare(); });
  $('compare').addEventListener('click', removePortfolio);
  $('export').addEventListener('click', exportExcel);
  $('checkStability').addEventListener('click', drawStability);
  $('showBenchmark').addEventListener('change', drawCurve);
  $('split').addEventListener('change', () => { futureSplit = $('split').value; drawFuture(); });
  $('weights').addEventListener('mouseover', (e) => highlight(e.target.closest('tr')?.dataset.id));
  $('weights').addEventListener('mouseleave', () => highlight(null));
  $('compareAll').addEventListener('click', compareAll);
  // Подсказки к терминам: по наведению мыши, с клавиатуры и по касанию
  document.addEventListener('mouseover', (e) => showTip(e.target.closest('dfn[data-term]')));
  document.addEventListener('focusin', (e) => showTip(e.target.closest('dfn[data-term]')));
  document.addEventListener('click', (e) => showTip(e.target.closest('dfn[data-term]')));
  // Карточка «что изменилось»: её кнопки, и пока мышь над ней — она не прячется
  $('toast').addEventListener('click', (e) => { if (e.target.id === 'toastUndo') undo(); if (e.target.id === 'toastClose') hideToast(); });
  $('toast').addEventListener('mouseenter', () => clearTimeout(toastTimer));
  $('toast').addEventListener('mouseleave', () => { toastTimer = setTimeout(hideToast, 4000); });

  drawCompare();
  useData(builtinMeta);
}

// ---------- Данные: встроенные или свой файл ----------

// Переключает страницу на набор данных: строит кнопки индикаторов и списки месяцев, затем считает заново
function useData(newMeta) {
  meta = newMeta;
  current = previous = last = openStage = futureSplit = null;     // прошлый результат относился к другим данным
  quiet = true;
  $('headline').innerHTML = $('metrics').innerHTML = $('timing').textContent = '';
  $('stageDetail').hidden = true;
  $('stageHint').hidden = false;
  $('factAssets').textContent = meta.assets.length;
  $('factMonths').textContent = meta.months.length;

  // Индикаторы — кнопки-переключатели. Во встроенных данных М2 выключена: в неё нельзя вложить деньги.
  $('assets').innerHTML = meta.assets.map((a) =>
    `<label title="${a.name} · ${a.source} · данные с ${meta.first_month[a.id]}">
       <input type="checkbox" value="${a.id}" ${a.id === 'M2' ? '' : 'checked'}>${dot(a.id)}${shortName(a.id)}</label>`).join('');

  const options = meta.months.map((m) => `<option>${m}</option>`).join('');
  $('start').innerHTML = options;
  $('end').innerHTML = options;
  $('end').value = meta.months[meta.months.length - 1];

  syncControls();
  drawStages();
  calculate();
}

function chooseSource(e) {
  if (!e.target.dataset.source || e.target.dataset.source === source) return;
  source = e.target.dataset.source;
  document.querySelectorAll('#source button').forEach((b) => b.classList.toggle('on', b === e.target));
  $('uploadBox').hidden = source !== 'file';
  if (source === 'builtin') useData(builtinMeta);
  else if (custom) useData(custom.meta);       // файл уже загружали — возвращаемся к нему
}

// Файл перетащили на рамку
function dropFiles(e) {
  e.preventDefault();
  $('drop').classList.toggle('over', e.type === 'dragover');
  if (e.type === 'drop' && e.dataTransfer.files.length) upload([...e.dataTransfer.files], { kinds: {}, inflation: 'auto' });
}

// В блоке загрузки что-то изменили: выбрали файл, вид столбца или способ учёта инфляции
function uploadChanged(element) {
  if (element.id === 'files') {
    if (element.files.length) upload([...element.files], { kinds: {}, inflation: 'auto' });
  } else if (custom) {
    if (element.dataset.kind) custom.options.kinds[element.dataset.kind] = element.value;
    if (element.id === 'inflationMode') custom.options.inflation = element.value;
    upload(custom.files, custom.options);       // читаем те же файлы с новыми указаниями
  }
}

// Отправляет файлы на сервер. Сервер сам разбирается в их устройстве и возвращает
// помесячную таблицу, список индикаторов и отчёт о том, что и как он понял.
async function upload(files, options) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  form.append('options', JSON.stringify(options));
  $('drop').classList.add('busy');
  let result;
  try {
    result = await (await fetch('/api/upload', { method: 'POST', body: form })).json();
  } catch (e) {
    result = { error: 'Не удалось отправить файл. Проверьте, что сервер запущен.' };
  }
  $('drop').classList.remove('busy');
  $('files').value = '';
  $('uploadError').hidden = !result.error;
  $('uploadError').textContent = result.error || '';
  if (result.error) return;

  custom = { dataset: result.dataset, table: result.table, assets: result.assets, report: result.report, kinds: result.kinds, files, options,
             meta: { assets: result.assets, first_month: result.first_month, months: result.months } };
  drawUpload();
  useData(custom.meta);
}

// Отчёт под рамкой загрузки: как прочитан каждый файл и каждый столбец. Любое решение можно поменять.
function drawUpload() {
  const r = custom.report;
  const files = r.files.map((f) => `<li><b>${f.name}</b> — ${f.format || 'не прочитан'}` + f.tables.map((t) => (t.skipped
    ? `<br><span class="tag">${t.where}: пропущено — ${t.skipped}</span>`
    : `<br>${t.where}: ${t.layout}; данные ${t.frequency}; строк с датами — ${t.rows}; десятичный знак — ${t.decimal}` +
      (t.left_out.length ? `; не взяты столбцы: ${t.left_out.join(', ')}` : ''))).join('') + '</li>').join('');
  const columns = r.columns.map((c) => `<div class="col"><b>${c.name}${c.role ? ' · ' + c.role : ''}</b>
    <select data-kind="${c.name}">${Object.entries(custom.kinds).map(([k, text]) =>
      `<option value="${k}" ${k === c.kind ? 'selected' : ''}>${text}${k === c.kind_auto ? ' — определено само' : ''}</option>`).join('')}</select>
    ${c.error ? `<span class="tag">не взят: ${c.error}</span>`
      : `<small>${c.first} — ${c.last}${c.frequency === 'месячные' ? '' : ', ' + c.frequency + ' данные сведены к месячным'}</small>`}</div>`).join('');
  const modes = [['file', 'из столбца файла'], ['builtin', 'встроенная, Росстат'], ['none', 'не учитывать']];
  $('uploadReport').hidden = false;
  $('uploadReport').innerHTML = `<ul>${files}</ul>
    <div>Период в файле: <b>${r.period[0]} — ${r.period[1]}</b> (${r.period[2]} мес.)</div>
    ${r.warnings.map((w) => `<div class="tag">${w}</div>`).join('')}
    <label for="inflationMode">Инфляция</label>
    <select id="inflationMode">${modes.map(([k, text]) =>
      `<option value="${k}" ${k === r.inflation.mode ? 'selected' : ''} ${k === 'file' && !r.inflation.has_column ? 'disabled' : ''}>${text}</option>`).join('')}</select>
    <small>Сейчас: ${r.inflation.note}.</small>
    <details><summary>Как прочитаны столбцы (${r.columns.length})</summary>${columns}</details>`;
}

// ---------- Панель настроек ----------

// Откладывает расчёт: пока пользователь двигает ползунок или печатает, сервер не дёргаем
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(calculate, 300);
}

// Держит связанные элементы панели в согласии друг с другом
function syncControls(changed) {
  // Ползунок и число рядом с ним показывают одно и то же
  if (changed && changed.dataset.for) $(changed.dataset.for).value = changed.value;
  document.querySelectorAll('input[type=range]').forEach((r) => { if (r !== changed) r.value = $(r.dataset.for).value; });
  // Поля ставок доступны, только когда включена их галочка
  $('useIncome').disabled = source === 'file';      // аренда и вклад относятся только к встроенным индикаторам
  if (source === 'file') $('useIncome').checked = false;
  $('rent').disabled = $('deposit').disabled = !$('useIncome').checked;
  $('fee').disabled = $('tax').disabled = !$('useCosts').checked;
  // Кнопки быстрого выбора периода: подсвечена та, что совпадает с выбранным началом
  document.querySelectorAll('#presets button').forEach((b) =>
    b.classList.toggle('on', $('start').value === presetStart(b.dataset.years) && $('end').selectedIndex === meta.months.length - 1));
  showTarget();

  // Краткое содержание каждого шага — в его заголовке, чтобы свёрнутый шаг оставался понятным
  const c = criterion(), preset = document.querySelector('#presets .on');
  $('sumAssets').textContent = `${source === 'file' ? 'свой файл · ' : ''}${document.querySelectorAll('#assets input:checked').length} из ${meta.assets.length}`;
  $('sumPeriod').textContent = preset ? preset.textContent.toLowerCase() : `${$('start').value} — ${$('end').value}`;
  $('sumCriterion').textContent = { min_vol: 'мин. волатильность', max_sharpe: 'макс. Шарп',
    target_return: `доходность ${$('target').value.replace('.', ',')}%`, target_risk: `риск ${$('target').value.replace('.', ',')}%` }[c];
  $('sumRf').textContent = $('rf').value.replace('.', ',') + '%';
  $('sumExtra').textContent = [$('useIncome').checked && 'доходы', $('useCosts').checked && 'издержки'].filter(Boolean).join(', ') || 'выключено';
}

// Поле «целевое значение» нужно только для критериев 3 и 4.
// Границы ползунка берутся из эффективной границы, поэтому ползунком недостижимую цель не задать.
// При смене критерия значение, не попавшее в границы, заменяется серединой.
function showTarget(criterionChanged) {
  const c = criterion();
  $('targetRow').hidden = !needsTarget(c);
  $('targetLabel').textContent = c === 'target_return' ? 'Желаемая доходность, % годовых' : 'Допустимый риск, % годовых';
  if (!needsTarget(c) || !current) return;
  const k = c === 'target_return' ? 1 : 0;                       // в точке границы: [риск, доходность]
  const f = current.frontier;
  const min = Math.ceil(f[0][k] * 1000) / 10, max = Math.floor(f[f.length - 1][k] * 1000) / 10;
  $('targetRange').min = min;
  $('targetRange').max = max;
  const value = parseFloat($('target').value);
  if (criterionChanged && !(value >= min && value <= max)) $('target').value = ((min + max) / 2).toFixed(1);
  $('targetRange').value = $('target').value;
}

function checkAssets(rule) {
  document.querySelectorAll('#assets input').forEach((i) => { i.checked = rule(i.value); });
  syncControls();
  calculate();
}

// Месяц начала для кнопки «5 лет», «3 года» или «Весь»
function presetStart(years) {
  const n = meta.months.length;
  return meta.months[years > 0 ? n - years * 12 : 0];
}

function choosePeriod(e) {
  if (!e.target.dataset.years) return;
  $('start').value = presetStart(e.target.dataset.years);
  $('end').value = meta.months[meta.months.length - 1];
  syncControls();
  calculate();
}

// Собирает все настройки с панели в один объект для сервера. Проценты переводятся в доли.
function settings() {
  const c = criterion();
  const share = (id) => parseFloat($(id).value) / 100 || 0;
  const income = $('useIncome').checked, costs = $('useCosts').checked;
  return {
    dataset: source === 'file' && custom ? custom.dataset : null,      // номер загруженной таблицы; null — встроенные данные
    assets: [...document.querySelectorAll('#assets input:checked')].map((i) => i.value),
    start: $('start').value,
    end: $('end').value,
    criterion: c,
    rf: share('rf'),
    target: needsTarget(c) ? share('target') : null,
    rent: income ? share('rent') : 0, deposit: income ? share('deposit') : 0,
    fee: costs ? share('fee') : 0, tax: costs ? share('tax') : 0,
  };
}

// Отправляет настройки на сервер и возвращает ответ.
// Ответ с кодом 410 значит, что сервер перезапускался и забыл загруженную таблицу:
// тогда страница присылает свою копию таблицы и повторяет запрос.
async function post(url, body) {
  const send = (address, data) => fetch(address, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  let response = await send(url, body);
  if (response.status === 410 && custom) {
    const restored = await (await send('/api/restore', { table: custom.table, assets: custom.assets, report: custom.report })).json();
    custom.dataset = body.dataset = restored.dataset;
    response = await send(url, body);
  }
  return response;
}

async function calculate() {
  clearTimeout(timer);
  const id = ++requestId;
  const body = settings();

  // Пока сервер считает: результаты бледнеют, по этапам бежит огонёк, кнопка неактивна
  $('results').classList.add('loading');
  document.body.classList.add('busy');
  $('run').disabled = true;
  $('run').textContent = 'Считаю…';
  stagesBusy();
  let result;
  try {
    result = await (await post('/api/optimize', body)).json();
  } catch (e) {
    result = { error: 'Сервер не отвечает. Проверьте, что он запущен.' };
  }
  if (id !== requestId) return;      // пока ждали, настройки снова изменились — этот ответ уже устарел
  $('results').classList.remove('loading');
  document.body.classList.remove('busy');
  $('run').disabled = false;
  $('run').textContent = 'Рассчитать портфель';

  showMessage(result.error || result.note);
  if (result.error) { stagesDone(false); return; }

  previous = current && { ...current.metrics, sharpe: current.sharpe };
  last = current;
  current = result;
  current.settings = body;
  current.name = portfolioName(body);
  $('stability').hidden = true;      // прошлая проверка устойчивости относится к прошлым настройкам
  showTarget();
  stagesDone(true);
  drawMetrics();
  drawLive();
  drawTab();
  if (last && !quiet) showChange(last, current);
  quiet = false;
}

// Название портфеля для заголовков и сравнения
function portfolioName(s) {
  return CRITERION_NAMES[s.criterion] +
    (s.criterion === 'target_return' ? `: доходность ${pct(s.target)}` : s.criterion === 'target_risk' ? `: риск ${pct(s.target)}` : '') +
    (s.rent || s.deposit ? ' · с доходами' : '') + (s.fee || s.tax ? ' · с издержками' : '');
}

// Живая карточка в шапке: во что превратился рубль, маленькая кривая и состав портфеля
function drawLive() {
  const v = current.curve.values, ids = Object.keys(current.weights).filter((id) => current.weights[id] > 0.0005).sort((a, b) => current.weights[b] - current.weights[a]);
  $('liveLabel').textContent = `${current.name} · ${current.period[2]} мес., после инфляции`;
  animate($('liveValue'), previous ? previous.final_value : 1, current.metrics.final_value, rub);
  // Кривая роста рубля; пунктир — уровень 1 ₽
  const lo = Math.min(...v, 1), hi = Math.max(...v, 1), pad = (hi - lo) * 0.12 || 0.1;
  const y = (value) => (70 - (value - lo + pad) / (hi - lo + 2 * pad) * 70).toFixed(1);
  const line = v.map((value, i) => `${i ? 'L' : 'M'}${(i / (v.length - 1) * 300).toFixed(1)} ${y(value)}`).join('');
  $('liveSpark').innerHTML = `<path class="area" d="${line}L300 70L0 70Z"/><path class="base" d="M0 ${y(1)}H300"/><path class="line" d="${line}"/>`;
  $('liveMix').innerHTML = ids.slice(0, 4).map((id) => `<span>${dot(id)}${shortName(id)} ${whole(current.weights[id])}</span>`).join('') +
    (ids.length > 4 ? `<span>и ещё ${ids.length - 4}</span>` : '');
}

// ---------- Карточка «что изменилось» ----------

// Что именно пользователь поменял между двумя расчётами — словами
function describeChange(a, b) {
  const list = [], short = (s) => ({ min_vol: 'мин. волатильность', max_sharpe: 'макс. Шарп', target_return: 'эффективный риск', target_risk: 'эффективная доходность' }[s.criterion]);
  if (a.criterion !== b.criterion) list.push(`Критерий: ${short(a)} → ${short(b)}`);
  else if (a.target !== b.target) list.push(`${a.criterion === 'target_return' ? 'Желаемая доходность' : 'Допустимый риск'}: ${pct(a.target)} → ${pct(b.target)}`);
  if (a.rf !== b.rf) list.push(`Безрисковая ставка: ${pct(a.rf)} → ${pct(b.rf)}`);
  const added = b.assets.filter((id) => !a.assets.includes(id)), removed = a.assets.filter((id) => !b.assets.includes(id));
  if (removed.length) list.push(`Убрали: ${removed.map(shortName).join(', ')}`);
  if (added.length) list.push(`Добавили: ${added.map(shortName).join(', ')}`);
  if (a.start !== b.start || a.end !== b.end) list.push(`Период: ${b.start} — ${b.end}`);
  if (a.rent !== b.rent || a.deposit !== b.deposit) list.push(b.rent || b.deposit ? 'Учтён доход помимо цены' : 'Доход помимо цены выключен');
  if (a.fee !== b.fee || a.tax !== b.tax) list.push(b.fee || b.tax ? 'Учтены комиссии и налог' : 'Издержки выключены');
  return list;
}

// Показывает, как изменение настройки сдвинуло результат: было → стало. Отсюда же можно вернуть как было.
function showChange(before, after) {
  const causes = describeChange(before.settings, after.settings);
  if (!causes.length) return;
  const row = (name, a, b, format) => `<tr><td>${name}</td><td>${format(a)}</td><td class="${format(a) === format(b) ? '' : b > a ? 'up' : 'down'}">${format(b)}</td></tr>`;
  // Доли, которые изменились сильнее всего
  const ids = [...new Set([...Object.keys(before.weights), ...Object.keys(after.weights)])];
  const moved = ids.map((id) => ({ id, a: before.weights[id] || 0, b: after.weights[id] || 0 }))
    .filter((r) => Math.abs(r.b - r.a) >= 0.01).sort((p, q) => Math.abs(q.b - q.a) - Math.abs(p.b - p.a)).slice(0, 3);
  $('toast').innerHTML = `<button type="button" id="toastClose" title="Закрыть">×</button>
    <p class="toast-title">Что изменилось</p>
    <p class="toast-cause">${causes.join('<br>')}</p>
    <table><tr><th></th><th>было</th><th>стало</th></tr>
      ${row('Доход в год', before.metrics.mean_return, after.metrics.mean_return, pct)}
      ${row('Волатильность', before.metrics.volatility, after.metrics.volatility, pct)}
      ${row('1 ₽ превратился в', before.metrics.final_value, after.metrics.final_value, rub)}
      ${moved.map((r) => `<tr><td>${named(r.id, shortName(r.id))}</td><td>${whole(r.a)}</td><td>${whole(r.b)}</td></tr>`).join('')}</table>
    ${moved.length ? '' : '<p class="toast-cause">Доли не изменились.</p>'}
    <button type="button" id="toastUndo">Вернуть как было</button>`;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 10000);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('toast').hidden = true;
}

// Кнопка «вернуть как было»: расставляет прошлые настройки на панели и считает заново
function undo() {
  if (!last) return;
  const s = last.settings, percent = (x) => String(Math.round(x * 10000) / 100);
  hideToast();
  quiet = true;
  document.querySelectorAll('#assets input').forEach((i) => { i.checked = s.assets.includes(i.value); });
  $('start').value = s.start;
  $('end').value = s.end;
  document.querySelector(`input[name=criterion][value=${s.criterion}]`).checked = true;
  $('rf').value = percent(s.rf);
  if (s.target !== null) $('target').value = percent(s.target);
  $('useIncome').checked = !!(s.rent || s.deposit);
  if (s.rent || s.deposit) { $('rent').value = percent(s.rent); $('deposit').value = percent(s.deposit); }
  $('useCosts').checked = !!(s.fee || s.tax);
  if (s.fee || s.tax) { $('fee').value = percent(s.fee); $('tax').value = percent(s.tax); }
  syncControls();
  calculate();
}

// Подсказка к термину: появляется под словом
function showTip(element) {
  const tip = $('tip');
  if (!element) { tip.hidden = true; return; }
  const [title, text] = GLOSSARY[element.dataset.term];
  tip.innerHTML = `<b>${title}</b>${text}`;
  tip.hidden = false;
  const box = element.getBoundingClientRect();
  tip.style.left = Math.max(12, Math.min(box.left + scrollX, scrollX + innerWidth - tip.offsetWidth - 12)) + 'px';
  tip.style.top = box.bottom + scrollY + 8 + 'px';
}

// ---------- Ход расчёта: шесть этапов ----------

// Пользователь загрузил свой файл и выбрал «инфляцию не учитывать»
const noInflation = () => source === 'file' && custom && custom.report.inflation.mode === 'none';

// Короткая строка под названием этапа и пометка о том, что на нём отброшено
function stageSummary(key) {
  const t = current.trace, n = current.assets.length, used = Object.values(current.weights).filter((w) => w > 0.0005).length;
  const m = current.metrics, s = current.settings;
  return {
    data: { value: `${n} из ${meta.assets.length} индикаторов` },
    period: { value: `${t.period.kept} мес.`, lost: t.period.dropped ? `−${t.period.dropped} мес.` : '' },
    inflation: noInflation() ? { value: 'не учитывается' } : { value: `цены ${signed(t.inflation.total, pct)}`, lost: `${signed(-t.inflation.annual, pct)} в год` },
    stats: { value: `${n} средних, таблица ${n}×${n}` },
    optimize: { value: `вошли ${used} из ${n}`, lost: n - used ? `${n - used} с долей 0` : '' },
    result: { value: `${pct(m.mean_return)} при риске ${pct(m.volatility)}`, lost: s.fee || s.tax ? 'с издержками' : '' },
  }[key];
}

function drawStages() {
  $('stages').innerHTML = STAGES.map(([key, title], i) => {
    const info = current ? stageSummary(key) : { value: '' };
    return `<li><button type="button" data-stage="${key}" class="${openStage === key ? 'open' : ''}">
      <span class="mark">${i + 1}</span><span class="title">${title}</span><span class="value">${info.value}</span>
      ${info.lost ? `<span class="tag lost">${info.lost}</span>` : ''}</button></li>`;
  }).join('');
}

// Пока ждём сервер, по этапам бежит огонёк. Это только знак «идёт расчёт»:
// сервер отвечает один раз, сразу за все этапы, а настоящее время каждого показано справа.
function stagesBusy() {
  const items = [...$('stages').children];
  let i = 0;
  clearInterval(stageTimer);
  items.forEach((li) => { li.className = ''; });
  stageTimer = setInterval(() => { items.forEach((li, k) => li.classList.toggle('run', k === i % items.length)); i++; }, 200);
}

// Ответ пришёл: этапы по очереди отмечаются галочкой, появляются их числа и время работы сервера
function stagesDone(ok) {
  clearInterval(stageTimer);
  drawStages();
  if (!ok) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  [...$('stages').children].forEach((li, k) => setTimeout(() => {
    li.classList.add('done');
    li.querySelector('.mark').textContent = '✓';
  }, still ? 0 : 70 * k));
  const ms = current.trace.ms;
  $('timing').textContent = `Сервер посчитал за ${fix(sum(Object.values(ms)), 0)} мс: подготовка данных ${fix(ms.prepare, 1)}` +
    `${current.trace.from_memory ? ' (из памяти)' : ''}, статистика ${fix(ms.stats, 1)}, оптимизация ${fix(ms.optimize, 1)}, ` +
    `кривая ${fix(ms.curve, 1)}, граница ${fix(ms.frontier, 1)}${current.trace.frontier_from_memory ? ' (из памяти)' : ''}`;
  drawStageDetail();
}

// Щелчок по этапу (или по ссылке «почему?») открывает его подробности, повторный — закрывает
function chooseStage(e) {
  const button = e.target.closest('[data-stage]');
  if (!button || !current) return;
  const inStrip = button.closest('#stages');
  openStage = inStrip && openStage === button.dataset.stage ? null : button.dataset.stage;
  document.querySelectorAll('#stages button').forEach((b) => b.classList.toggle('open', b.dataset.stage === openStage));
  drawStageDetail();
  if (!inStrip) $('stageDetail').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function drawStageDetail() {
  $('stageHint').hidden = !!openStage;
  $('stageDetail').hidden = !openStage;
  if (openStage) $('stageDetail').innerHTML = stageDetail(openStage);
}

// Почему индикатор получил нулевую долю. Объяснение следует из условий оптимальности:
// в найденной точке добавление любой доли такого индикатора ухудшает критерий.
function whyExcluded(i) {
  const p = current.trace.portfolio, a = current.assets[i], c = current.settings.criterion, rf = current.trace.rf;
  const beta = p.beta[i], portfolioReturn = sum(p.ret);
  if (c === 'min_vol' && beta >= 0.999) return `бета ${num(beta)} — не меньше 1: любая его доля увеличила бы риск портфеля`;
  if (c === 'max_sharpe' && portfolioReturn > rf) {
    const needed = rf + beta * (portfolioReturn - rf);
    if (a.ret <= needed + 1e-4) return `чтобы войти, при его бете ${num(beta)} нужна доходность не ниже ${pct(needed)}, а у него ${pct(a.ret)}`;
  }
  return `бета ${num(beta)}: при этой цели любая его доля ухудшила бы результат`;
}

// Текст подробностей этапа: что вошло, что вышло, что отброшено и по какой формуле
function stageDetail(key) {
  const t = current.trace, s = current.settings, m = current.metrics, ids = current.assets.map((a) => a.id);
  const n = ids.length, months = t.period.kept;
  const flow = (...parts) => `<div class="flowline">${parts.map((p, i) => `<span class="${i === parts.length - 1 ? 'out' : ''}">${p}</span>`).join('<i>→</i>')}</div>`;
  const name = (id) => named(id, shortName(id));

  if (key === 'data' && source === 'file' && custom) {
    const r = custom.report;
    return `<h3>1. Данные</h3>
    ${flow(`файлов: ${r.files.length}`, `столбцов с данными: ${r.columns.length}`, `индикаторов: ${meta.assets.length}, выбрано ${n}`)}
    <p>Данные взяты из вашего файла. Сервер сам определил его устройство и привёл всё к одному виду: уровни на конец каждого месяца.
    Период в файле: ${r.period[0]} — ${r.period[1]}.</p>
    ${table(['Файл', 'Как прочитан'], r.files.map((f) => [f.name, `<div class="left">${f.format || ''}. ` + f.tables.map((t) => (t.skipped
      ? `${t.where}: пропущено — ${t.skipped}`
      : `${t.where}: ${t.layout}; данные ${t.frequency}; строк с датами — ${t.rows}` + (t.left_out.length ? `; не взяты столбцы: ${t.left_out.join(', ')}` : ''))).join('. ') + '</div>']))}
    ${table(['Столбец', 'Что в нём', 'Что сделано', 'Данные'], r.columns.map((c) => [c.name, custom.kinds[c.kind],
      `<div class="left">${c.error ? 'не взят: ' + c.error : [c.frequency !== 'месячные' && `${c.frequency} данные сведены к месячным`,
        c.kind !== 'level' && 'из доходностей собран индекс, начиная с 1', c.role && 'используется как инфляция'].filter(Boolean).join('; ') || 'взят как есть'}</div>`,
      c.error ? '—' : `${c.first} — ${c.last}`]))}
    <p class="footnote">Уровни сводятся к месячным по последнему значению месяца, доходности внутри месяца перемножаются. Если сервер ошибся в виде столбца, поправьте его в блоке загрузки слева.</p>`;
  }

  if (key === 'data') return `<h3>1. Данные</h3>
    ${flow(`таблица data.csv: ${meta.assets.length} индикаторов и индекс цен`, `${meta.months.length + 1} месячных значений`, `выбрано ${n} индикаторов`)}
    <p>Сервер прочитал готовую таблицу <b>data/data.csv</b>. В ней значения на конец каждого месяца: с ${Object.values(meta.first_month).sort()[0]} по ${meta.months[meta.months.length - 1]}.
    Из ${meta.assets.length} индикаторов в расчёт взяты отмеченные на панели слева.</p>
    ${table(['Индикатор', 'Источник', 'Данные с'], ids.map((id) => [name(id), meta.assets.find((a) => a.id === id).source, meta.first_month[id]]))}
    <p class="footnote">Таблица собрана заранее программой build_dataset.py из файлов Банка России и индексов Московской биржи. Во время расчёта сервер в интернет не обращается.</p>`;

  if (key === 'period') {
    const p = t.period;
    const lost = p.dropped
      ? `В расчёт вошло <b>${p.kept}</b>: с ${current.period[0]} по ${current.period[1]}. Остальные <b>${p.dropped} мес. отброшены</b>:
         ${[p.limiting && (p.limiting === 'CPI' ? 'индекс цен (инфляция) начинается позже остальных данных'
              : `у индикатора «${shortName(p.limiting)}» первая доходность есть только за ${p.first[p.limiting]}`),
            p.limiting_end && (p.limiting_end === 'CPI' ? 'индекс цен (инфляция) кончается раньше остальных данных'
              : `у индикатора «${shortName(p.limiting_end)}» данные кончаются на ${p.last[p.limiting_end]}`)].filter(Boolean).join('; ') || 'в данных есть пропуски'}.
         ${p.limiting && p.limiting !== 'CPI' ? 'Если снять этот индикатор на панели, период станет длиннее.' : ''}
         ${p.limiting === 'CPI' || p.limiting_end === 'CPI' ? 'Чтобы взять весь период, добавьте в файл столбец с индексом цен за эти месяцы или выберите в блоке загрузки «инфляцию не учитывать».' : ''}`
      : `Все они вошли в расчёт: данные есть по каждому выбранному индикатору.`;
    return `<h3>2. Общий период</h3>
    ${flow(`запрошено ${p.asked} мес.`, ...(p.dropped ? [`отброшено ${p.dropped} мес.`] : []), `осталось ${p.kept} мес.`)}
    <p>Запрошен период ${p.asked_from} — ${p.asked_to}: это ${p.asked} мес. ${lost}</p>
    <p>Портфель можно считать только по тем месяцам, где доходность известна у всех его частей сразу. Иначе в какой-то месяц часть денег оказалась бы «нигде».</p>
    ${table(['Индикатор', 'Первая доходность за', ''], ids.map((id) => [name(id), p.first[id], id === p.limiting ? '<span class="tag">ограничивает период</span>' : '']))}
    <p class="footnote">Доходность за месяц = значение на конец месяца / значение на конец прошлого − 1. Поэтому самый первый месяц данных доходности не имеет.</p>`;
  }

  if (key === 'inflation') {
    const f = t.inflation;
    return `<h3>3. Инфляция</h3>
    ${noInflation() ? flow('доходности из файла', 'без поправки на цены') : flow('доходности в рублях', `цены за период ${signed(f.total, pct)}`, 'доходности после инфляции')}
    ${noInflation() ? '<p><b>Инфляция не учитывается</b>: так выбрано в блоке загрузки файла. Доходности остаются такими, как в файле, поэтому два столбца в таблице ниже совпадают.</p>'
      : `<p>За ${months} мес. цены выросли на <b>${pct(f.total)}</b>, в среднем на ${pct(f.annual)} в год. Каждая месячная доходность очищена от роста цен за тот же месяц:</p>`}
    <span class="formula">r = (1 + r в рублях) / (1 + инфляция за месяц) − 1</span>
    ${table(['Индикатор', 'В рублях, в год', 'После инфляции, в год', 'Съела инфляция'],
      ids.map((id, i) => [name(id), pct(f.nominal[i]), pct(f.real[i]), points(f.real[i] - f.nominal[i])]))}
    ${s.rent || s.deposit ? `<p>К росту цены прибавлен доход: ${[s.rent && `аренда ${pct(s.rent)} в год для недвижимости`, s.deposit && `вклад ${pct(s.deposit)} в год для доллара и юаня`].filter(Boolean).join(', ')}.</p>` : ''}
    <p class="footnote">${source === 'file' && custom ? `Инфляция: ${custom.report.inflation.note}.` : 'Инфляция — индекс потребительских цен Росстата.'} Делить точнее, чем вычитать: при вычитании получилась бы немного завышенная доходность.</p>`;
  }

  if (key === 'stats') return `<h3>4. Статистика</h3>
    ${flow(`${months} × ${n} месячных доходностей`, `${n} средних доходностей`, `таблица ковариаций ${n} × ${n}`)}
    <p>Из ${months * n} месячных чисел получено всё, что нужно оптимизатору: средняя доходность каждого индикатора и то, как индикаторы колеблются вместе. На сами цены он дальше не смотрит.</p>
    <span class="formula">μ = среднее за месяц × 12</span> <span class="formula">σ = отклонение за месяц × √12</span>
    ${table(['Индикатор', 'Доходность μ, в год', 'Риск σ, в год'], current.assets.map((a) => [name(a.id), pct(a.ret), pct(a.risk)]))}
    <p class="footnote">Связь между индикаторами показана на вкладке «Откуда результат»: чем она слабее, тем сильнее их сочетание снижает риск.</p>`;

  if (key === 'optimize') {
    const goal = {
      min_vol: 'найти доли, при которых риск портфеля минимален',
      max_sharpe: `найти доли, при которых (доходность − ${pct(t.rf)}) / риск максимально`,
      target_return: `найти доли с минимальным риском при доходности ровно ${pct(s.target || 0)}`,
      target_risk: `найти доли с максимальной доходностью при риске не выше ${pct(s.target || 0)}`,
    }[s.criterion];
    const inside = ids.filter((id) => current.weights[id] > 0.0005), outside = ids.filter((id) => !(current.weights[id] > 0.0005));
    return `<h3>5. Оптимизация</h3>
    ${flow(`${n} индикаторов`, ...(outside.length ? [`${outside.length} получили долю 0`] : []), `в портфеле ${inside.length}`)}
    <p><b>${CRITERION_NAMES[s.criterion]}</b>: ${goal}. Ограничения: каждая доля от 0 до 100%, сумма долей 100%.</p>
    <span class="formula">риск портфеля = √(wᵀ Σ w)</span> <span class="formula">доходность портфеля = wᵀ μ</span>
    <p>Доли подбирает численный метод SLSQP: начинает с равных долей и шаг за шагом сдвигает их, пока критерий улучшается${s.criterion === 'max_sharpe' ? `. Для этого критерия поиск запускается из ${n + 1} разных точек, и берётся лучший ответ` : ''}.</p>
    ${outside.length ? table(['Не вошли в портфель', 'Доходность', 'Риск', 'Почему доля 0'],
      outside.map((id) => { const i = ids.indexOf(id); return [name(id), pct(current.assets[i].ret), pct(current.assets[i].risk), `<div class="left">${whyExcluded(i)}</div>`]; }))
      : '<p>В портфель вошли все выбранные индикаторы.</p>'}
    ${current.note ? `<p><b>Замечание:</b> ${current.note}</p>` : ''}
    <p class="footnote">Бета — ковариация индикатора с портфелем, делённая на дисперсию портфеля. Бета больше 1 значит, что индикатор раскачивает портфель сильнее, чем портфель колеблется сам; меньше 1 — успокаивает его. Причины взяты из условий оптимальности: в найденной точке ни одну нулевую долю нельзя увеличить без ухудшения критерия.</p>`;
  }

  const c = t.curve;
  return `<h3>6. Результат</h3>
    ${flow(`доли и месячные доходности: ${months}`, `кривая из ${months + 1} точек`, `7 показателей`)}
    <p>Рубль вложен в конце ${current.curve.months[0]}. Доходность портфеля за месяц — сумма «доля × доходность индикатора». В конце каждого месяца доли возвращаются к заданным:
    то, что выросло, частично продаётся, то, что упало, докупается. В среднем для этого нужно переложить <b>${pct(c.turnover)}</b> портфеля в месяц.</p>
    ${s.fee ? `<p>С каждой такой сделки и с первой покупки взята комиссия ${pct2(s.fee)}. За весь период она забрала ${pct2(c.fee_total)} стоимости.</p>` : ''}
    ${s.tax ? `<p>В конце с рублёвой прибыли взят налог ${pct(s.tax)}: итог ${rub(m.final_value)} превратился в ${rub(m.final_after_tax)}.</p>` : ''}
    ${table(['Что получилось', 'Значение'], [
      ['Средняя доходность за месяц', pct2(c.monthly_mean)], ['Отклонение месячной доходности', pct2(c.monthly_std)],
      ['Убыточных месяцев', `${c.loss_months} из ${c.months}`],
      ['Вершина перед самой глубокой просадкой', `${c.dd_top[0]} — ${rub(c.dd_top[1])}`], ['Дно этой просадки', `${c.dd_trough[0]} — ${rub(c.dd_trough[1])}`],
      ['Итог в рублях без поправки на цены', rub(c.final_nominal)], ['Итог после инфляции', rub(m.final_value)]])}
    <p class="footnote">Как из этих чисел получился каждый показатель, написано в сносках «как посчитано» под ним. Эффективная граница считается отдельно: 30 раз решается задача «минимальный риск при заданной доходности».</p>`;
}

// ---------- Главный результат ----------

// Сноски «как посчитано»: формула с подставленными числами этого расчёта
function howCalculated(key) {
  const m = current.metrics, c = current.trace.curve, s = current.settings, rf = current.trace.rf;
  if (key === 'mean_return') return `Средняя доходность портфеля за месяц ${pct2(c.monthly_mean)} × 12 = ${pct(m.mean_return)}. Инфляция уже вычтена${s.fee ? ', комиссии тоже' : ''}.`;
  if (key === 'volatility') return `Стандартное отклонение месячных доходностей ${pct2(c.monthly_std)} × √12 = ${pct(m.volatility)}. Корень, потому что по месяцам складываются дисперсии, а не отклонения.`;
  if (key === 'final_value') return `Перемножены все месячные доходности (их ${c.months}): (1 + r₁) × (1 + r₂) × … = ${num(m.final_value)}. В рублях без поправки на цены было бы ${rub(c.final_nominal)}.` +
    (s.tax ? ` После налога ${pct(s.tax)} с рублёвой прибыли остаётся ${rub(m.final_after_tax)}.` : '');
  if (key === 'downside') return `Убыточных месяцев ${c.loss_months} из ${c.months}. Берутся только их доходности, прибыльные месяцы считаются нулём; квадраты усредняются по всем месяцам, затем корень × √12.` +
    (m.sortino === null ? '' : ` Коэффициент Сортино = (${pct(m.mean_return)} − ${pct(rf)}) / ${pct(m.downside)} = ${num(m.sortino)}.`);
  if (key === 'max_drawdown') return `Вершина: ${c.dd_top[0]} — ${rub(c.dd_top[1])}. Дно: ${c.dd_trough[0]} — ${rub(c.dd_trough[1])}. ${num(c.dd_trough[1])} / ${num(c.dd_top[1])} − 1 = ${pct(m.max_drawdown)}.`;
  if (key === 'max_recovery_months') return (c.recovery ? `С ${c.recovery[0]} (вершина) по ${c.recovery[1]} стоимость оставалась ниже этой вершины: ${m.max_recovery_months} мес.` : 'Портфель ни разу не опускался ниже прошлой вершины.') +
    (m.recovered ? '' : ' К концу периода портфель снова ниже своей последней вершины.');
  return `(${pct(m.mean_return)} − ${pct(rf)}) / ${pct(m.volatility)} = ${num(current.sharpe)}.` + (current.sharpe < 0 ? ' Минус означает, что доход ниже безрисковой ставки.' : '');
}

// Три крупных числа и четыре плитки. Число плавно «доезжает» от прошлого значения,
// под ним — на сколько оно изменилось и сноска «как посчитано».
function drawMetrics() {
  const m = { ...current.metrics, sharpe: current.sharpe };
  const months = (x) => Math.round(x) + ' мес.';
  $('resultTitle').textContent = current.name;
  $('period').textContent = `Портфель · ${current.period[0]} — ${current.period[1]} · ${current.period[2]} мес.`;
  const items = [
    ['mean_return', term('real', 'Ожидаемый доход'), pct, points, 'в год, после инфляции'],
    ['volatility', term('vol', 'Волатильность'), pct, points, 'риск: размах колебаний за год'],
    ['final_value', 'Во что превратился 1 ₽', rub, rub, `за ${current.period[2]} мес., после инфляции` + (current.settings.tax ? ` · после налога ${rub(m.final_after_tax)}` : '')],
    ['downside', term('sortino', 'Риск потерь'), pct, points, 'колебания только вниз · Сортино ' + (m.sortino === null ? '—' : num(m.sortino))],
    ['max_drawdown', term('drawdown', 'Макс. просадка'), pct, points, 'самое большое падение от вершины'],
    ['max_recovery_months', term('recovery', 'Период восстановления'), months, months, m.recovered ? 'самый долгий срок ниже вершины' : 'к концу периода ещё не восстановился'],
    ['sharpe', term('sharpe', 'Коэффициент Шарпа'), num, num, 'доход сверх ставки на единицу риска'],
  ];
  const block = ([key, name, format, formatChange, about], big) => {
    const change = previous ? m[key] - previous[key] : 0;
    const chip = format(m[key]) === format(previous ? previous[key] : m[key]) ? ''
      : `<div class="change">${change > 0 ? '▲' : '▼'} ${formatChange(Math.abs(change))} к прошлому расчёту</div>`;
    return `<div class="${big ? '' : 'tile'}"><div class="name">${name}</div>
      <div class="${big ? 'big' : 'value'}" id="tile_${key}"></div>
      <div class="about">${about}</div>${chip}
      <details class="how" data-how="${key}" ${openHow.has(key) ? 'open' : ''}><summary>как посчитано</summary><p>${howCalculated(key)}</p></details></div>`;
  };
  $('headline').innerHTML = items.slice(0, 3).map((item) => block(item, true)).join('');
  $('metrics').innerHTML = items.slice(3).map((item) => block(item, false)).join('');
  items.forEach(([key, , format]) => animate($('tile_' + key), previous ? previous[key] : 0, m[key], format));
}

// Запоминает, какие сноски раскрыты, чтобы после пересчёта они не закрывались
function rememberHow(e) {
  const key = e.target.dataset && e.target.dataset.how;
  if (key) openHow[e.target.open ? 'add' : 'delete'](key);
}

// Плавная смена числа за 0,4 секунды
function animate(element, from, to, format) {
  const began = performance.now(), duration = 400;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { element.textContent = format(to); return; }
  const step = (now) => {
    const t = Math.min((now - began) / duration, 1);
    element.textContent = format(from + (to - from) * (1 - (1 - t) ** 3));     // в конце замедляется
    if (t < 1 && element.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- Вкладки ----------

function chooseTab(e) {
  if (!e.target.dataset.tab) return;
  tab = e.target.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b === e.target));
  document.querySelectorAll('.tab').forEach((panel) => { panel.hidden = panel.dataset.tab !== tab; });
  drawTab();
}

// Рисует только открытую вкладку: график нельзя нарисовать в спрятанном блоке
function drawTab() {
  if (!current) return;
  if (tab === 'portfolio') { drawPie(); drawFrontier(); }      // граница после диаграммы: высота её блока подстраивается под соседний
  if (tab === 'sources') { drawContributions(); drawWaterfall(); drawCorrelation(); }
  if (tab === 'dynamics') { drawCurve(); drawCompare(); }
  if (tab === 'future') drawFuture();
}

// ---------- Вкладка «Портфель» ----------

function drawFrontier() {
  const m = current.metrics;
  const traces = [{
    x: current.frontier.map((p) => p[0] * 100), y: current.frontier.map((p) => p[1] * 100),
    mode: 'lines+markers', name: 'Эффективная граница', line: { color: CURRENT_COLOR, width: 3 },
    marker: { color: CURRENT_COLOR, size: 5 },
    hovertemplate: 'риск %{x:.1f}% · доходность %{y:.1f}%<br>щёлкните, чтобы выбрать<extra>граница</extra>',
  }, {
    x: current.assets.map((a) => a.risk * 100), y: current.assets.map((a) => a.ret * 100),
    text: current.assets.map((a) => label(a.id)), customdata: current.assets.map((a) => assetName(a.id)),
    mode: 'markers+text', textposition: current.assets.map((a) => LABEL_SIDE[a.id] || 'top center'), name: 'Отдельные индикаторы',
    marker: { color: current.assets.map((a) => color(a.id)), size: 11, line: { color: '#fff', width: 1.5 } },
    hovertemplate: '%{customdata}<br>риск %{x:.1f}% · доходность %{y:.1f}%<extra></extra>',
  }, {
    x: [m.volatility * 100], y: [m.mean_return * 100], mode: 'markers', name: 'Выбранный портфель',
    marker: { color: STAR_COLOR, size: 22, symbol: 'star', line: { color: '#fff', width: 2 } },
    hovertemplate: 'Выбранный портфель<br>риск %{x:.1f}% · доходность %{y:.1f}%<extra></extra>',
  }];
  // Вспомогательная линия показывает, как критерий выбрал точку на границе
  const s = current.settings, rf = current.trace.rf, starX = m.volatility * 100, starY = m.mean_return * 100;
  const guide = { line: { color: STAR_COLOR, width: 1.5, dash: 'dot' }, layer: 'below' };
  const across = { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: starY, y1: starY, ...guide };        // горизонталь через звезду
  const upright = { type: 'line', yref: 'paper', y0: 0, y1: 1, x0: starX, x1: starX, ...guide };       // вертикаль через звезду
  const far = Math.max(...current.assets.map((a) => a.risk)) * 130;                                    // правее всех точек
  const [shape, text] = {
    min_vol: [upright, 'левее портфелей нет'],
    max_sharpe: [{ type: 'line', x0: 0, y0: rf * 100, x1: far, y1: rf * 100 + (starY - rf * 100) / starX * far, ...guide }, `прямая из ставки ${pct(rf)}`],
    target_return: [across, `заданная доходность ${pct(s.target || 0)}`],
    target_risk: [upright, `заданный риск ${pct(s.target || 0)}`],
  }[s.criterion];
  Plotly.react('frontier', traces, {
    ...LAYOUT, hovermode: 'closest',
    xaxis: { ...AXIS, title: axisTitle('Риск (волатильность), % годовых'), rangemode: 'tozero', ticksuffix: '%' },
    yaxis: { ...AXIS, title: axisTitle('Ожидаемая доходность, % годовых'), ticksuffix: '%' },
    legend: { orientation: 'h', y: -0.25 }, margin: { ...LAYOUT.margin, b: 60 },
    shapes: [shape],
    // подпись ставится выше границы (там всегда свободно: портфелей там не бывает), а у крайней левой точки — ниже и правее
    annotations: [{ x: starX, y: starY, text, showarrow: true, arrowhead: 0, arrowcolor: STAR_COLOR, ax: s.criterion === 'min_vol' ? 80 : -70, ay: s.criterion === 'min_vol' ? 110 : -50,
                    font: { color: INK, size: 12.5 }, bgcolor: '#fff', bordercolor: STAR_COLOR, borderpad: 4 }],
  }, PLOT_CONFIG);
  Plotly.Plots.resize('frontier');     // блок мог изменить высоту вместе с соседней таблицей долей
  once('frontier', 'plotly_click', chooseFrontierPoint);
}

// Подключает обработчик события графика один раз (график к этому моменту уже нарисован)
function once(id, event, handler) {
  const chart = $(id);
  if (!chart.on || chart.dataset[event]) return;
  chart.dataset[event] = '1';
  chart.on(event, handler);
}

// Щелчок по точке границы: строим портфель с такой доходностью (критерий «Эффективный риск»)
function chooseFrontierPoint(event) {
  const point = event.points[0];
  if (point.curveNumber !== 0) return;                 // щёлкнули не по линии, а по индикатору или звезде
  document.querySelector('input[value=target_return]').checked = true;
  $('target').value = point.y.toFixed(1);
  syncControls();
  calculate();
}

function drawPie() {
  pieIds = Object.keys(current.weights).filter((id) => current.weights[id] > 0.0005)
    .sort((a, b) => current.weights[b] - current.weights[a]);
  Plotly.react('pie', [{
    type: 'pie', hole: 0.6, sort: false, direction: 'clockwise',
    labels: pieIds.map(assetName), values: pieIds.map((id) => current.weights[id]),
    marker: { colors: pieIds.map((id) => color(id)), line: { color: '#fff', width: 2 } },
    // Подпись внутри сектора — только если он достаточно большой, иначе она не помещается
    text: pieIds.map((id) => (current.weights[id] >= 0.05 ? pct(current.weights[id]) : '')),
    textinfo: 'text', textposition: 'inside', insidetextorientation: 'horizontal',
    hovertemplate: '%{label}: %{percent}<extra></extra>',
  }], {
    ...LAYOUT, margin: { t: 10, b: 10, l: 10, r: 10 }, showlegend: false,
    // В центре кольца: сколько индикаторов вошло в портфель из отмеченных
    annotations: [{ text: `<b>${pieIds.length}</b> из ${Object.keys(current.weights).length}`, showarrow: false, font: { size: 18, color: INK } }],
  }, PLOT_CONFIG);
  once('pie', 'plotly_hover', (event) => highlight(pieIds.find((id) => assetName(id) === event.points[0].label), true));
  once('pie', 'plotly_unhover', () => highlight(null, true));

  // Таблица долей под диаграммой: полоска показывает долю наглядно
  const largest = current.weights[pieIds[0]];
  highlighted = null;
  $('weights').innerHTML = pieIds.map((id) =>
    `<tr data-id="${id}"><td>${named(id, assetName(id))}</td>
     <td class="bar"><i style="width:${current.weights[id] / largest * 100}%;background:${color(id)}"></i></td>
     <td>${pct(current.weights[id])}</td></tr>`).join('');
}

// Связь диаграммы и таблицы: подсвечивает строку и выдвигает сектор одного индикатора
function highlight(id, fromPie) {
  if (id === highlighted) return;
  highlighted = id;
  document.querySelectorAll('#weights tr').forEach((row) => row.classList.toggle('on', row.dataset.id === id));
  if (!fromPie && current) Plotly.restyle('pie', { pull: [pieIds.map((x) => (x === id ? 0.08 : 0))] });
}

// ---------- Вкладка «Откуда результат» ----------

// Таблица вкладов: какую часть доходности и риска портфеля даёт каждый индикатор
function drawContributions() {
  const p = current.trace.portfolio, ids = current.assets.map((a) => a.id);
  const rows = ids.map((id, i) => ({ id, i, w: current.weights[id] })).filter((r) => r.w > 0.0005).sort((a, b) => b.w - a.w);
  // Ячейка с полоской: вправо от оси — плюс, влево — минус; длины в одном масштабе по столбцу
  const bars = (values) => {
    const up = Math.max(0, ...values), down = Math.max(0, ...values.map((v) => -v)), all = up + down || 1;
    return (v, color) => `<td class="split"><div>
      ${down ? `<span class="neg" style="flex:${down / all * 100} 0 0">${v < 0 ? `<i style="width:${-v / down * 100}%;background:${color}"></i>` : ''}</span>` : ''}
      <span class="pos" style="flex:${up / all * 100} 0 0">${v > 0 ? `<i style="width:${v / up * 100}%;background:${color}"></i>` : ''}</span></div></td>`;
  };
  const retBar = bars(rows.map((r) => p.ret[r.i])), riskBar = bars(rows.map((r) => p.risk[r.i]));
  $('contributions').innerHTML = `<tr><th>Индикатор</th><th>Доля</th><th>Его доходность</th><th colspan="2">Вклад в доходность</th><th colspan="2">Вклад в риск</th></tr>` +
    rows.map((r) => `<tr><td>${named(r.id, assetName(r.id))}</td><td>${pct(r.w)}</td><td>${pct(current.assets[r.i].ret)}</td>
      ${retBar(p.ret[r.i], color(r.id))}<td>${signed(p.ret[r.i], points)}</td>
      ${riskBar(p.risk[r.i], color(r.id))}<td>${signed(p.risk[r.i], points)}</td></tr>`).join('') +
    `<tr class="total"><td>Портфель</td><td>100%</td><td></td><td></td><td>${pct(sum(p.ret))}</td><td></td><td>${pct(sum(p.risk))}</td></tr>`;

  const outside = ids.filter((id) => !(current.weights[id] > 0.0005));
  $('contributionsNote').innerHTML = `<b>Вклад в доходность</b> = доля × доходность индикатора. <b>Вклад в риск</b> = доля × ковариация индикатора с портфелем / риск портфеля:
    он показывает, сколько общего риска «приносит» индикатор, и бывает меньше, чем доля × его собственный риск, — в этом и состоит диверсификация.` +
    (current.settings.fee ? ` Доходность здесь до комиссий, поэтому сумма чуть выше, чем в показателях.` : '') +
    (outside.length ? ` Не вошли в портфель: ${outside.map(shortName).join(', ')}. <span class="links"><button type="button" data-stage="optimize">Почему?</button></span>` : '');
}

// Путь рубля: что прибавилось и что пропало по дороге от вложенного рубля к итогу
function drawWaterfall() {
  const c = current.trace.curve, m = current.metrics, f = current.trace.inflation;
  const steps = [['Вложили', 1, 'absolute'], ['Рост в рублях', c.final_nominal - 1, 'relative'], ['Инфляция', c.final_real - c.final_nominal, 'relative']];
  if (Math.abs(m.final_value - c.final_real) > 1e-9) steps.push(['Комиссии', m.final_value - c.final_real, 'relative']);
  if (Math.abs(m.final_after_tax - m.final_value) > 1e-9) steps.push(['Налог', m.final_after_tax - m.final_value, 'relative']);
  steps.push(['Итог', 0, 'total']);
  const last = steps.length - 1;
  Plotly.react('waterfall', [{
    type: 'waterfall', orientation: 'h',          // шаги идут сверху вниз, как путь
    y: steps.map((s) => s[0]), x: steps.map((s) => s[1]), measure: steps.map((s) => s[2]),
    text: steps.map((s, i) => (i === 0 ? rub(1) : i === last ? rub(m.final_after_tax) : signed(s[1], rub))),
    textposition: 'outside', cliponaxis: false, textfont: { color: INK, size: 13 },
    connector: { line: { color: 'rgba(26,20,51,0.25)', width: 1 } },
    increasing: { marker: { color: CURRENT_COLOR } }, decreasing: { marker: { color: LOSS_COLOR } }, totals: { marker: { color: INK } },
    hovertemplate: '%{text}<extra></extra>',
  }], {
    ...LAYOUT, showlegend: false, margin: { t: 10, r: 70, l: 120, b: 48 },
    xaxis: { ...AXIS, title: axisTitle('Стоимость, ₽'), rangemode: 'tozero' }, yaxis: { autorange: 'reversed', tickfont: { size: 13.5, color: INK } },
  }, PLOT_CONFIG);
  $('waterfallNote').innerHTML = `В рублях 1 ₽ вырос до <b>${rub(c.final_nominal)}</b>. Но цены за это время выросли на ${pct(f.total)}, поэтому по покупательной способности это
    ${num(c.final_nominal)} / ${num(1 + f.total)} = <b>${rub(c.final_real)}</b>.` +
    (steps.length > 4 ? ` Издержки уменьшили итог до <b>${rub(m.final_after_tax)}</b>.` : '');
}

// Таблица корреляций: голубой — движутся в разные стороны, светлый — независимо, розовый — вместе
function drawCorrelation() {
  const ids = current.assets.map((a) => a.id), z = current.trace.correlation;
  Plotly.react('correlation', [{
    type: 'heatmap', z, x: ids.map(label), y: ids.map(label), zmin: -1, zmax: 1, xgap: 3, ygap: 3,
    colorscale: [[0, '#22a6ee'], [0.5, '#f4f2ff'], [1, '#ff5c9a']],
    texttemplate: '%{z:.2f}', textfont: { size: 11 },
    customdata: ids.map((a) => ids.map((b) => `${shortName(a)} и ${shortName(b)}`)),
    hovertemplate: '%{customdata}: %{z:.2f}<extra></extra>',
    colorbar: { thickness: 10, len: 0.85, tickvals: [-1, 0, 1], outlinewidth: 0 },
  }], {
    ...LAYOUT, margin: { t: 10, r: 10, l: 70, b: 60 },
    xaxis: { tickangle: -45, automargin: true }, yaxis: { autorange: 'reversed', automargin: true },
  }, PLOT_CONFIG);
  // Самая слабая и самая сильная связь среди разных индикаторов
  let low = null, high = null;
  ids.forEach((a, i) => ids.forEach((b, j) => {
    if (j <= i) return;
    if (!low || z[i][j] < low.v) low = { a, b, v: z[i][j] };
    if (!high || z[i][j] > high.v) high = { a, b, v: z[i][j] };
  }));
  $('correlationNote').innerHTML = `Корреляция: +1 — движутся вместе, 0 — независимо, −1 — в противоположные стороны. Чем ближе к нулю и ниже, тем лучше сочетание снижает риск.
    Самая слабая связь: <b>${shortName(low.a)} и ${shortName(low.b)}</b> (${num(low.v)}). Самая сильная: <b>${shortName(high.a)} и ${shortName(high.b)}</b> (${num(high.v)}).`;
}

// ---------- Вкладка «Динамика и сравнение» ----------

function chooseCurveMode(e) {
  if (!e.target.dataset.mode) return;
  curveMode = e.target.dataset.mode;
  document.querySelectorAll('#curveMode button').forEach((b) => b.classList.toggle('on', b === e.target));
  drawCurve();
}

// Просадка по месяцам: на сколько процентов стоимость ниже своего прошлого максимума
function drawdown(values) {
  let peak = values[0];
  return values.map((v) => { peak = Math.max(peak, v); return (v / peak - 1) * 100; });
}

function drawCurve() {
  const down = curveMode === 'drawdown';
  $('curveHint').innerHTML = down
    ? `На сколько процентов портфель был ниже своей прошлой вершины. Самая глубокая точка — максимальная ${term('drawdown', 'просадка')}, самый длинный провал — ${term('recovery', 'период восстановления')}.`
    : `Во что превратился 1 рубль, вложенный в начале периода, после вычета инфляции. Оранжевым закрашена самая глубокая ${term('drawdown', 'просадка')}: от вершины до дна. Голубая черта — самое долгое ${term('recovery', 'восстановление')}.`;
  const line = (r, color, width, fill) => ({
    x: r.curve.months, y: down ? drawdown(r.curve.values) : r.curve.values,
    mode: 'lines', name: r.name, line: { color, width },
    fill: fill ? (down ? 'tozeroy' : 'tonexty') : 'none', fillcolor: 'rgba(109,94,252,0.13)',
    hovertemplate: (down ? '%{y:.1f}%' : '%{y:.2f} ₽') + '<extra>' + r.name + '</extra>',
  });
  const traces = saved.map((r, i) => line({ ...r, name: `${i + 1}. ${r.name}` }, r.color, 2, false));
  let shapes = [], annotations = [];
  // Ориентир М2: рубль, растущий вместе с денежной массой. Есть только во встроенных данных и только в режиме «Рост»
  const m2 = current && current.benchmark;
  $('benchmarkRow').hidden = !m2 || down;
  $('benchmarkNote').hidden = !m2 || down || !$('showBenchmark').checked;
  if (m2 && !down && $('showBenchmark').checked) {
    traces.push({ x: current.curve.months, y: m2.values, mode: 'lines', name: 'Денежная масса М2 (ориентир)',
                  line: { color: ASSET_COLORS.M2, width: 2, dash: 'dash' }, hovertemplate: '%{y:.2f} ₽<extra>М2</extra>' });
    const mine = current.metrics.final_value, money = m2.values[m2.values.length - 1];
    $('benchmarkNote').innerHTML = `<b>Зачем здесь М2.</b> Денежная масса — это все рубли страны: наличные и деньги на счетах. Вложить в неё нельзя, но с ней можно сравнивать.
      За период рублей стало больше в <b>${num(money)}</b> раза сверх инфляции (${pct(m2.mean_return)} в год), а рубль в портфеле превратился в <b>${rub(mine)}</b>.
      ${mine >= money ? 'Портфель растёт быстрее денежной массы: ваша доля во «всех рублях страны» увеличивается.'
        : 'Портфель растёт медленнее денежной массы: он обгоняет цены в магазинах, но ваша доля во «всех рублях страны» уменьшается.'}`;
  }
  if (current) {
    // Невидимая линия на уровне 1 ₽: от неё до кривой текущего портфеля идёт заливка
    if (!down) traces.push({ x: current.curve.months, y: current.curve.months.map(() => 1), mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip' });
    traces.push(line({ ...current, name: current.name + ' (текущий)' }, CURRENT_COLOR, 3.5, true));
    if (!down) {
      const c = current.trace.curve;
      shapes = [
        // Тонкая линия на уровне 1: выше неё — заработали, ниже — потеряли
        { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 1, y1: 1, line: { color: '#b9c2cf', width: 1, dash: 'dot' } },
        // Отрезок самой глубокой просадки текущего портфеля
        { type: 'rect', yref: 'paper', y0: 0, y1: 1, x0: c.dd_top[0], x1: c.dd_trough[0], fillcolor: 'rgba(255,138,61,0.13)', line: { width: 0 } },
      ];
      const note = (x, y, text, ax, ay, noteColor) => ({ x, y, text, showarrow: true, arrowhead: 0, arrowcolor: noteColor, ax, ay,
                                                         font: { color: INK, size: 12.5 }, bgcolor: '#fff', bordercolor: noteColor, borderpad: 4 });
      annotations = [note(c.dd_trough[0], c.dd_trough[1], `просадка ${pct(current.metrics.max_drawdown)}`, 44, 40, LOSS_COLOR)];
      if (c.recovery) {
        // Самое долгое восстановление: черта на уровне вершины, пока портфель оставался ниже неё
        const level = current.curve.values[current.curve.months.indexOf(c.recovery[0])];
        shapes.push({ type: 'line', x0: c.recovery[0], x1: c.recovery[1], y0: level, y1: level, line: { color: WAIT_COLOR, width: 2.5 } });
        annotations.push(note(c.recovery[0], level, `${current.metrics.max_recovery_months} мес. ниже вершины`, -30, -34, WAIT_COLOR));
      }
    }
  }
  Plotly.react('curve', traces, {
    ...LAYOUT,
    xaxis: { ...AXIS },
    yaxis: { ...AXIS, title: axisTitle(down ? 'Просадка от вершины' : 'Стоимость 1 рубля'), ticksuffix: down ? '%' : '' },
    legend: { orientation: 'h', y: -0.15 }, hovermode: 'x unified', shapes, annotations,
  }, PLOT_CONFIG);
}

function savePortfolio() {
  if (!current) return;
  // Цвет закрепляется за портфелем при добавлении: берём первый свободный
  const color = LINE_COLORS.find((c) => !saved.some((r) => r.color === c));
  if (!color) { showMessage('В сравнении не больше 8 портфелей. Удалите лишний крестиком или нажмите «Очистить».'); return; }
  saved.push({ ...current, color });
  drawCurve();
  drawCompare();
}

// Одна кнопка: четыре портфеля под четыре критерия при тех же данных, периоде и ставке.
// Для критериев 3 и 4 берётся середина эффективной границы (или текущее значение, если такой критерий сейчас выбран).
async function compareAll() {
  if (!current) return;
  const base = current.settings, f = current.frontier, middle = f[Math.floor(f.length / 2)], round = (x) => Math.round(x * 1000) / 1000;
  $('compareAll').disabled = true;
  const list = [];
  for (const c of Object.keys(CRITERION_NAMES)) {
    const target = !needsTarget(c) ? null : base.criterion === c ? base.target : round(middle[c === 'target_return' ? 1 : 0]);
    const body = { ...base, criterion: c, target };
    const r = await (await post('/api/optimize', body)).json();
    if (!r.error) list.push({ ...r, settings: body, name: portfolioName(body), color: LINE_COLORS[list.length] });
  }
  $('compareAll').disabled = false;
  saved = list;
  drawCurve();
  drawCompare();
}

function removePortfolio(e) {
  if (!e.target.dataset.remove) return;
  saved.splice(Number(e.target.dataset.remove), 1);
  drawCurve();
  drawCompare();
}

function drawCompare() {
  if (!saved.length) { $('compare').innerHTML = ''; return; }
  const rows = saved.map((r, i) => {
    const m = r.metrics;
    return `<tr><td><span class="swatch" style="background:${r.color}"></span>${i + 1}. ${r.name}</td>
      <td>${pct(m.mean_return)}</td><td>${pct(m.volatility)}</td><td>${pct(m.downside)}</td><td>${pct(m.max_drawdown)}</td>
      <td>${m.max_recovery_months} мес.${m.recovered ? '' : ' *'}</td><td>${num(r.sharpe)}</td>
      <td><button type="button" class="remove" data-remove="${i}" title="Убрать из сравнения">×</button></td></tr>`;
  }).join('');
  $('compare').innerHTML = `<tr><th>Портфель</th><th>Ожидаемый доход</th><th>Волатильность</th>
    <th>Риск потерь</th><th>Макс. просадка</th><th>Период восстановления</th><th>Коэф. Шарпа</th><th></th></tr>${rows}
    <tr><td colspan="8" class="hint" style="text-align:left">* к концу периода ещё не восстановился</td></tr>`;
}

// ---------- Вкладка «Проверка на будущем» ----------

// Доли подбираются по ранней части периода, результат считается на поздней. Рядом — портфель с равными долями.
async function drawFuture() {
  const response = await post('/api/future', { ...settings(), split: futureSplit });
  const r = await response.json();
  if (r.error) { $('futureFlow').innerHTML = ''; $('futureTable').innerHTML = ''; $('futureNote').textContent = r.error; Plotly.react('futureChart', [], LAYOUT, PLOT_CONFIG); return; }
  $('split').innerHTML = r.choices.map((m) => `<option ${m === r.train[1] ? 'selected' : ''}>${m}</option>`).join('');
  $('futureFlow').innerHTML = `<div class="flowline"><span>подбор долей: ${r.train[0]} — ${r.train[1]} (${r.train[2]} мес.)</span><i>→</i>
    <span class="out">проверка: ${r.test[0]} — ${r.test[1]} (${r.test[2]} мес.)</span></div>`;
  const p = r.portfolio, e = r.equal;
  const row = (name, x) => `<tr><td>${name}</td><td>${pct(x.expected_return)}</td><td>${pct(x.expected_risk)}</td>
    <td>${pct(x.return)}</td><td>${pct(x.risk)}</td><td>${pct(x.max_drawdown)}</td><td>${rub(x.final_value)}</td></tr>`;
  $('futureTable').innerHTML = `<tr><th>Портфель</th><th>Ожидали: доход</th><th>Ожидали: риск</th><th>Получили: доход</th><th>Получили: риск</th>
    <th>Макс. просадка</th><th>1 ₽ превратился в</th></tr>` + row(CRITERION_NAMES[current.settings.criterion], p) + row('Для сравнения: равные доли', e);
  Plotly.react('futureChart', [
    { x: r.months, y: e.curve, mode: 'lines', name: 'Равные доли', line: { color: '#a8a69e', width: 2, dash: 'dash' }, hovertemplate: '%{y:.2f} ₽<extra>равные доли</extra>' },
    { x: r.months, y: p.curve, mode: 'lines', name: CRITERION_NAMES[current.settings.criterion], line: { color: CURRENT_COLOR, width: 3 }, hovertemplate: '%{y:.2f} ₽<extra>портфель</extra>' },
  ], { ...LAYOUT, xaxis: { ...AXIS, tickformat: '%m.%Y' }, yaxis: { ...AXIS, title: axisTitle('Стоимость 1 рубля на проверочном отрезке') }, legend: { orientation: 'h', y: -0.15 }, hovermode: 'x unified',
       shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 1, y1: 1, line: { color: '#b9c2cf', width: 1, dash: 'dot' } }] }, PLOT_CONFIG);
  // Вывод словами: насколько сбылись ожидания по риску и по доходности
  const riskGap = Math.abs(p.risk / p.expected_risk - 1), returnGap = p.return - p.expected_return;
  const weights = r.assets.map((id, i) => [id, r.weights[i]]).filter((x) => x[1] > 0.005).sort((a, b) => b[1] - a[1]).map(([id, w]) => `${shortName(id)} ${pct(w)}`).join(', ');
  $('futureNote').innerHTML = `<b>Доли по ранним данным:</b> ${weights}.${r.note ? ' ' + r.note : ''}<br>
    <b>Риск</b> ${riskGap < 0.3 ? 'близок к ожидаемому' : 'заметно разошёлся с ожиданием'}: ждали ${pct(p.expected_risk)}, получили ${pct(p.risk)}.
    <b>Доходность</b> оказалась ${returnGap >= 0 ? 'выше' : 'ниже'} ожидаемой на ${points(Math.abs(returnGap))}: ждали ${pct(p.expected_return)}, получили ${pct(p.return)}.
    ${riskGap < 0.3 ? 'Обычно так и бывает: колебания по прошлому оцениваются надёжнее, чем средняя доходность. Поэтому числам риска на этом сайте можно доверять больше, чем числам доходности.'
      : 'Здесь ранняя часть периода оказалась не похожа на позднюю. Это главный предел метода: он исходит из того, что будущее похоже на прошлое.'}`;
}

// Скачивание результата: сервер собирает файл Excel, браузер сохраняет его
async function exportExcel() {
  const response = await post('/api/export', settings());
  if (!response.ok) { showMessage((await response.json()).error); return; }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(await response.blob());
  link.download = 'portfolio.xlsx';
  link.click();
  URL.revokeObjectURL(link.href);
}

// ---------- Вкладка «Устойчивость» ----------

// Доли портфеля на нескольких сдвинутых периодах, столбики с накоплением
async function drawStability() {
  $('checkStability').disabled = true;
  const result = await (await post('/api/stability', settings())).json();
  $('checkStability').disabled = false;
  if (result.error) { showMessage(result.error); return; }
  const labels = result.windows.map((w) => w.from + '<br>— ' + w.to);
  const traces = result.assets.map((id, i) => ({
    type: 'bar', name: assetName(id), x: labels, y: result.windows.map((w) => w.weights[i] * 100),
    marker: { color: color(id), line: { color: '#fff', width: 1.5 } },
    hovertemplate: assetName(id) + ': %{y:.0f}%<extra></extra>',
  })).filter((t) => t.y.some((v) => v > 0.5));
  $('stability').hidden = false;
  Plotly.react('stability', traces, {
    ...LAYOUT, barmode: 'stack', bargap: 0.25,
    xaxis: { ...AXIS, tickangle: 0, tickfont: { size: 12 } }, yaxis: { ...AXIS, title: axisTitle('Доля в портфеле'), ticksuffix: '%', range: [0, 100] },
    legend: { orientation: 'h', y: -0.2 }, margin: { ...LAYOUT.margin, b: 70 },
  }, PLOT_CONFIG);
}

start();
