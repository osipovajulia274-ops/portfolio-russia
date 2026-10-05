"""
Чтение чужих таблиц: файл Excel или CSV неизвестного устройства превращается
в одну помесячную таблицу уровней (как data/data.csv), по которой умеет считать portfolio.py.

Что распознаётся само:
  - вид файла: .xlsx/.xlsm, старый .xls, таблица HTML под видом Excel, текст (CSV/TSV);
  - кодировка текста и разделитель столбцов (; , табуляция |), десятичная запятая или точка,
    пробелы и точки как разделители тысяч, знак %;
  - где в таблице даты: в столбце, в строке (таблица «на боку»), в двух столбцах «год» и «месяц»
    или в виде сетки «месяцы × годы»; лишние строки сверху (название, примечания) пропускаются;
  - «широкая» таблица (дата + столбец на каждый индикатор), «длинная» (дата, название, значение)
    и выгрузка одной бумаги (open/high/low/close — берётся цена закрытия);
  - частота: дневные и недельные данные сводятся к месячным;
  - что записано в столбце: уровни (цены, индексы) или доходности (в % или долях),
    либо индекс «к предыдущему месяцу = 100».
Всё, что решено автоматически, записывается в отчёт: его видно на сайте, и любое решение можно поменять.
"""
import csv
import io
import re
from datetime import date, datetime
from html.parser import HTMLParser

import numpy as np
import pandas as pd

MAX_COLUMNS = 40          # больше индикаторов из одного набора файлов не берём
KINDS = {"level": "уровень (цена, индекс)", "return_pct": "доходность, %",
         "return_frac": "доходность, доля", "prev100": "индекс к прошлому периоду = 100"}

MONTHS = {"янв": 1, "фев": 2, "мар": 3, "апр": 4, "май": 5, "мая": 5, "июн": 6, "июл": 7, "авг": 8, "сен": 9, "окт": 10, "ноя": 11, "дек": 12,
          "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
DATE_WORDS = ("дата", "date", "time", "период", "period", "месяц", "month", "tradedate", "begin", "end", "день", "day")
CLOSE_WORDS = ("adj close", "close", "закр", "цена", "price", "last", "значение", "value")
OHLC_WORDS = ("open", "high", "low", "откр", "макс", "мин")
EXTRA_WORDS = ("vol", "объ", "оборот", "изм", "change", "numtrades", "capital", "сделок")
CPI_WORDS = ("cpi", "ипц", "инфляц", "inflation", "потребительских цен", "consumer price")


def safe(text):
    """Название из чужого файла попадёт на страницу, поэтому знаки разметки из него убираются."""
    return re.sub(r"\s+", " ", re.sub(r"[<>&\"'`\\]", " ", str(text))).strip()[:60] or "без названия"


class ReadError(ValueError):
    """Файл не удалось прочитать — текст ошибки показывается пользователю."""


# ---------- 1. Файл -> сетки ячеек ----------

class _Tables(HTMLParser):
    """Достаёт таблицы из HTML (некоторые сайты отдают HTML с расширением .xls)."""

    def __init__(self):
        super().__init__()
        self.tables, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.tables.append([])
        elif tag == "tr" and self.tables:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = ""

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(self.cell.strip())
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.tables[-1].append(self.row)
            self.row = None


def decode(raw):
    """Текст из байтов: пробуем кодировки по очереди. Возвращает текст и название кодировки."""
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff") or raw[:200].count(b"\x00") > 20:
        return raw.decode("utf-16", errors="replace"), "UTF-16"
    for name in ("utf-8-sig", "cp1251"):
        try:
            return raw.decode(name), {"utf-8-sig": "UTF-8", "cp1251": "Windows-1251"}[name]
        except UnicodeDecodeError:
            pass
    return raw.decode("latin-1"), "Latin-1"


def split_text(text):
    """Делит текст на ячейки. Разделитель — тот, что встречается в строках чаще и ровнее всех."""
    lines = [l for l in text.splitlines() if l.strip()][:60]
    best, best_score = ",", 0
    for d in (";", "\t", "|", ","):
        counts = [len(next(csv.reader([l], delimiter=d))) - 1 for l in lines]
        typical = int(np.median(counts)) if counts else 0
        # сколько строк делится на типичное число частей; запятая проигрывает при равенстве (она бывает десятичной)
        score = typical and sum(c == typical for c in counts) + (0 if d == "," else 0.5)
        if score > best_score:
            best, best_score = d, score
    if not best_score:
        return [re.split(r"\s{2,}|\t", l.strip()) for l in text.splitlines()], "пробелы"
    names = {";": "точка с запятой", "\t": "табуляция", "|": "вертикальная черта", ",": "запятая"}
    return list(csv.reader(io.StringIO(text), delimiter=best)), names[best]


def read_grids(name, raw):
    """Файл -> список (подпись, сетка ячеек, описание файла). Вид файла определяется по содержимому, а не по расширению."""
    head = raw[:2000].lstrip()
    if raw[:4] == b"PK\x03\x04":
        try:
            sheets = pd.read_excel(io.BytesIO(raw), sheet_name=None, header=None, engine="openpyxl")
        except Exception as e:  # noqa: BLE001
            raise ReadError(f"«{name}»: файл Excel повреждён или защищён паролем ({e}).")
        return [(sheet, df.astype(object).where(df.notna(), None).values.tolist(), "Excel (.xlsx)") for sheet, df in sheets.items()]
    if raw[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        try:
            sheets = pd.read_excel(io.BytesIO(raw), sheet_name=None, header=None, engine="xlrd")
        except ImportError:
            raise ReadError(f"«{name}» — старый формат Excel (.xls). Откройте его в Excel и сохраните как .xlsx или CSV.")
        except Exception as e:  # noqa: BLE001
            raise ReadError(f"«{name}»: не удалось прочитать файл .xls ({e}).")
        return [(sheet, df.astype(object).where(df.notna(), None).values.tolist(), "Excel (.xls)") for sheet, df in sheets.items()]
    text, encoding = decode(raw)
    if head[:1] == b"<" and "<table" in text.lower():
        parser = _Tables()
        parser.feed(text)
        return [(f"таблица {i + 1}", t, f"HTML, {encoding}") for i, t in enumerate(parser.tables) if t]
    rows, delimiter = split_text(text)
    return [("", rows, f"текст, {encoding}, разделитель — {delimiter}")]


# ---------- 2. Ячейка -> число или дата ----------

def number_style(cells):
    """По всем ячейкам таблицы решает, что в ней десятичный знак: запятая или точка.
    Запись «1,234» двусмысленна (одна целая и 234 тысячных или 1234), поэтому сначала ищем однозначные:
    «12,5», «0,614», «1.234,56» говорят о запятой; «12.5», «0.614», «1,234.56» — о точке."""
    votes = {",": 0, ".": 0}
    unclear = {",": 0, ".": 0}
    for c in cells:
        if not isinstance(c, str):
            continue
        s = c.strip().replace("\xa0", "").replace("\u202f", "").replace(" ", "").lstrip("-−+").rstrip("%")
        if not re.fullmatch(r"[\d.,]+", s) or to_date(c) is not None:      # даты вида 01.2020 в подсчёте не участвуют
            continue
        for mark, other in ((",", "."), (".", ",")):
            if mark not in s:
                continue
            if other in s:                                         # оба знака: десятичный тот, что правее
                votes[mark if s.rfind(mark) > s.rfind(other) else other] += 1
                break
            whole, _, tail = s.rpartition(mark)
            if s.count(mark) == 1 and (len(tail) != 3 or whole == "0" or len(whole) > 3):
                votes[mark] += 1                                   # «12,5» или «0,614» — точно десятичный знак
            elif s.count(mark) == 1:
                unclear[mark] += 1
    if votes[","] != votes["."]:
        return "," if votes[","] > votes["."] else "."
    return "," if unclear[","] and not unclear["."] else "."


def to_number(x, decimal="."):
    """Число из ячейки или None. Понимает «1 234,56», «1,234.56», «−0,5%», «(3,2)», «1.2M»."""
    if isinstance(x, bool) or x is None:
        return None
    if isinstance(x, (int, float, np.integer, np.floating)):
        return None if pd.isna(x) else float(x)
    if not isinstance(x, str):
        return None
    s = x.strip().replace("\xa0", "").replace(" ", "").replace(" ", "").replace("'", "").replace("−", "-").replace("–", "-")
    if s.endswith("%"):
        s = s[:-1]
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    scale = 1.0
    if s[-1:].upper() in ("K", "M", "B") and re.fullmatch(r"-?[\d.,]+", s[:-1] or "x"):
        scale = {"K": 1e3, "M": 1e6, "B": 1e9}[s[-1].upper()]
        s = s[:-1]
    if not re.fullmatch(r"[-+]?[\d.,]*\d[\d.,]*([eE][-+]?\d+)?", s):
        return None
    other = "." if decimal == "," else ","
    s = s.replace(other, "").replace(decimal, ".")
    if s.count(".") > 1:                       # «1.234.567» — точки были разделителями тысяч
        s = s.replace(".", "")
    try:
        return float(s) * scale
    except ValueError:
        return None


def _make(y, m, d=1):
    if not (1900 <= y <= 2100 and 1 <= m <= 12 and 1 <= d <= 31):
        return None
    try:
        return pd.Timestamp(year=y, month=m, day=min(d, pd.Timestamp(year=y, month=m, day=1).days_in_month))
    except ValueError:
        return None


def month_number(x):
    """Номер месяца по его названию («январь», «Jan», «сент.») или None."""
    if isinstance(x, str):
        word = re.sub(r"[^a-zа-яё]", "", x.strip().lower())
        if 3 <= len(word) <= 9 and word[:3] in MONTHS and not re.search(r"\d", x):
            return MONTHS[word[:3]]
    return None


def to_date(x, dayfirst=True):
    """Дата из ячейки или None. Понимает 31.01.2020, 2020-01-31, 01/2020, 2020-01, 202001, 20200131, «янв 2020», «Jan 31, 2020»."""
    if isinstance(x, (pd.Timestamp, datetime, date)):
        return None if pd.isna(x) else pd.Timestamp(x)
    if isinstance(x, (int, np.integer)) or (isinstance(x, (float, np.floating)) and float(x).is_integer()):
        x = str(int(x))
        if len(x) not in (6, 8):
            return None
    if not isinstance(x, str):
        return None
    s = re.sub(r"[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?([+-]\d{2}:?\d{2}|Z)?$", "", x.strip())      # время в конце не нужно
    if m := re.fullmatch(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})", s):
        return _make(int(m[1]), int(m[2]), int(m[3]))
    if m := re.fullmatch(r"(\d{1,2})[-./](\d{1,2})[-./](\d{4}|\d{2})", s):
        a, b, y = int(m[1]), int(m[2]), int(m[3])
        y += 2000 if y < 70 else 1900 if y < 100 else 0
        return _make(y, b, a) if dayfirst else _make(y, a, b)
    if m := re.fullmatch(r"(\d{4})[-./](\d{1,2})", s):
        return _make(int(m[1]), int(m[2]))
    if m := re.fullmatch(r"(\d{1,2})[-./](\d{4})", s):
        return _make(int(m[2]), int(m[1]))
    if m := re.fullmatch(r"(\d{4})(\d{2})(\d{2})", s):
        return _make(int(m[1]), int(m[2]), int(m[3]))
    if m := re.fullmatch(r"(\d{4})(\d{2})", s):
        return _make(int(m[1]), int(m[2]))
    if m := re.fullmatch(r"(\d{4})[MmМм](\d{1,2})", s):
        return _make(int(m[1]), int(m[2]))
    low = s.lower()
    word = re.search(r"[a-zа-яё]{3,}", low)
    year = re.search(r"(?<!\d)(19|20)\d{2}(?!\d)", low)
    if word and year and word[0][:3] in MONTHS:
        day = re.search(r"(?<!\d)(\d{1,2})(?!\d)", low.replace(year[0], " "))
        return _make(int(year[0]), MONTHS[word[0][:3]], int(day[1]) if day else 1)
    return None


def is_year(x):
    n = to_number(x) if not isinstance(x, (datetime, date)) else None
    return n is not None and float(n).is_integer() and 1900 <= n <= 2100


# ---------- 3. Сетка ячеек -> ряды с датами ----------

def _dates(cells):
    """Даты столбца. Для записей вида 01/02/2020 выбирается то прочтение (день/месяц или месяц/день), при котором даты идут по порядку."""
    first = [to_date(c, True) for c in cells]
    ambiguous = [c for c in cells if isinstance(c, str) and re.fullmatch(r"\d{1,2}[-./]\d{1,2}[-./]\d{2,4}.*", c.strip())]
    if ambiguous:
        second = [to_date(c, False) for c in cells]
        jumps = lambda ds: sum(1 for a, b in zip(ds, ds[1:]) if a is not None and b is not None and abs((b - a).days) > 45)
        valid = lambda ds: sum(d is not None for d in ds)
        if (valid(second), -jumps(second)) > (valid(first), -jumps(first)):
            return second
    return first


def _pad(grid):
    width = max((len(r) for r in grid), default=0)
    return [list(r) + [None] * (width - len(r)) for r in grid]


def _clean(c):
    return None if c is None or (isinstance(c, float) and pd.isna(c)) or (isinstance(c, str) and not c.strip()) else c


def _text(c):
    return isinstance(c, str) and to_number(c) is None and to_date(c) is None


def _has(name, words):
    return any(w in str(name).lower() for w in words)


def extract(grid, fallback_name):
    """Сетка ячеек -> (таблица рядов с датами в индексе, описание того, как она прочитана).
    Возвращает (None, причина), если дат или чисел в сетке нет."""
    grid = [[_clean(c) for c in row] for row in _pad(grid)]
    grid = [r for r in grid if any(c is not None for c in r)]
    if len(grid) < 3 or len(grid[0]) < 2:
        return None, "слишком мало строк или столбцов"
    decimal = number_style(c for r in grid for c in r)
    num = lambda c: to_number(c, decimal)
    columns = lambda g: list(map(list, zip(*g)))

    # --- Сетка «месяцы × годы» (так публикует таблицы Росстат): названия месяцев в столбце, годы в строке, или наоборот
    for flipped in (False, True):
        g = columns(grid) if flipped else grid
        cols = columns(g)
        month_col = max(range(len(cols)), key=lambda j: sum(month_number(c) is not None for c in cols[j]))
        year_row = max(range(len(g)), key=lambda i: sum(is_year(c) for c in g[i]))
        if sum(month_number(c) is not None for c in cols[month_col]) >= 10 and sum(is_year(c) for c in g[year_row]) >= 2:
            values = {}
            for row in g:
                m = month_number(row[month_col])
                for j, y in enumerate(g[year_row]):
                    if m and is_year(y) and num(row[j]) is not None and j != month_col:
                        values.setdefault(_make(int(num(y)), m), num(row[j]))      # ниже бывает второй блок («к декабрю прошлого года») — он не нужен
            if len(values) >= 6:
                title = next((c for r in grid for c in r if _text(c) and month_number(c) is None and len(c) > 3), fallback_name)
                return pd.DataFrame({str(title).strip()[:60]: pd.Series(values).sort_index()}), {"layout": "сетка «месяцы × годы»", "decimal": decimal}

    # --- Где даты: в столбце или в строке (тогда таблицу переворачиваем)
    layout = "даты в столбце"
    for attempt in ("столбец", "строка"):
        cols = columns(grid)
        dates = [_dates(col) for col in cols]
        counts = [sum(d is not None for d in ds) for ds in dates]
        best = max(counts)
        if best >= 6 and best >= 0.5 * sum(c is not None for c in cols[counts.index(best)]):
            break
        # два столбца «год» и «месяц»
        years = [sum(is_year(c) for c in col) for col in cols]
        months = [sum(month_number(c) is not None or (num(c) is not None and 1 <= num(c) <= 12 and float(num(c)).is_integer()) for c in col) for col in cols]
        yc = max(range(len(cols)), key=lambda j: years[j])
        mc = max((j for j in range(len(cols)) if j != yc), key=lambda j: months[j], default=None)
        if mc is not None and years[yc] >= 6 and months[mc] >= 0.9 * years[yc]:
            for row in grid:
                m = month_number(row[mc]) or (int(num(row[mc])) if num(row[mc]) is not None and 1 <= num(row[mc]) <= 12 else None)
                row[yc] = _make(int(num(row[yc])), m) if is_year(row[yc]) and m else (row[yc] if _text(row[yc]) else None)
                row[mc] = None
            layout = "год и месяц в двух столбцах"
            cols = columns(grid)
            dates = [_dates(col) for col in cols]
            counts = [sum(d is not None for d in ds) for ds in dates]
            best = max(counts)
            break
        if attempt == "строка":
            return None, "не найден столбец или строка с датами"
        grid, layout = columns(grid), "даты в строке (таблица перевёрнута)"

    # Из столбцов с датами берём тот, что назван «дата», иначе самый левый из полных
    first_row = next(i for i in range(len(grid)) if any(dates[j][i] is not None for j in range(len(cols)) if counts[j] == best))
    header = grid[first_row - 1] if first_row > 0 else [None] * len(cols)
    above = grid[first_row - 2] if first_row > 1 else [None] * len(cols)
    full = [j for j in range(len(cols)) if counts[j] >= 0.9 * best]
    date_col = next((j for j in full if _has(header[j], DATE_WORDS)), full[0])
    rows = [i for i in range(len(grid)) if dates[date_col][i] is not None]
    index = [dates[date_col][i] for i in rows]

    names = []
    for j in range(len(cols)):
        own = header[j] if _text(header[j]) else above[j] if _text(above[j]) else None
        names.append(re.sub(r"\s+", " ", str(own)).strip("<> ")[:60] if own else f"Столбец {j + 1}")

    numeric, texts = {}, {}
    for j in range(len(cols)):
        if j == date_col or (j in full and j != date_col):
            continue
        cells = [grid[i][j] for i in rows]
        values = [num(c) for c in cells]
        filled = sum(c is not None for c in cells)
        if filled and sum(v is not None for v in values) >= 0.6 * filled:
            numeric[j] = values
            if sum(isinstance(c, str) and c.strip().endswith("%") for c in cells) > 0.5 * filled:
                names[j] += " %" if "%" not in names[j] else ""
        elif filled >= 0.6 * len(rows) and all(isinstance(c, str) or c is None for c in cells):
            texts[j] = cells
    if not numeric:
        return None, "рядом с датами нет столбцов с числами"
    info = {"layout": layout, "decimal": decimal, "skipped": []}

    # --- Выгрузка одной бумаги: open/high/low/close. Нужна только цена закрытия
    lowered = {j: names[j].lower() for j in numeric}
    if sum(_has(n, OHLC_WORDS) for n in lowered.values()) >= 2:
        close = next((j for w in CLOSE_WORDS for j, n in lowered.items() if w in n and not _has(n, OHLC_WORDS)), None)
        if close is not None:
            ticker = next((cells[0] for cells in texts.values() if len(set(cells)) == 1 and cells[0]), None)
            info["layout"] = "выгрузка одной бумаги (взята цена закрытия)"
            info["skipped"] = [names[j] for j in numeric if j != close]
            frame = pd.DataFrame({str(ticker or fallback_name)[:60]: numeric[close]}, index=index)
            return frame[~frame.index.duplicated(keep="last")].sort_index(), info

    # --- «Длинная» таблица: даты повторяются, рядом столбец с названиями бумаг
    category = next((j for j, cells in texts.items() if 2 <= len(set(cells) - {None}) <= 200), None)
    if category is not None and len(set(index)) < 0.7 * len(index):
        value = next((j for w in CLOSE_WORDS for j, n in lowered.items() if w in n), None)
        value = value if value is not None else next(j for j in numeric if not _has(lowered[j], EXTRA_WORDS + OHLC_WORDS))
        long = pd.DataFrame({"d": index, "k": [str(c).strip() if c else None for c in texts[category]], "v": numeric[value]}).dropna()
        info["layout"] = f"длинная таблица: названия в столбце «{names[category]}», значения в «{names[value]}»"
        info["skipped"] = [names[j] for j in numeric if j != value]
        return long.pivot_table(index="d", columns="k", values="v", aggfunc="last").sort_index(), info

    frame = pd.DataFrame({names[j]: numeric[j] for j in numeric}, index=index)
    frame = frame.loc[:, ~frame.columns.duplicated()]
    return frame[~frame.index.duplicated(keep="last")].sort_index(), info


# ---------- 4. Ряд с датами -> помесячные уровни ----------

def frequency(index):
    """Как часто идут значения: по медиане промежутка между соседними датами."""
    gaps = pd.Series(index).diff().dt.days.dropna()
    gap = gaps.median() if len(gaps) else 30
    return "дневные" if gap <= 4 else "недельные" if gap <= 10 else "месячные" if gap <= 45 else "квартальные" if gap <= 135 else "годовые"


def guess_kind(name, values):
    """Что записано в столбце. Уровни (цены, индексы) положительны и меняются плавно: соседние значения близки.
    Доходности скачут вокруг нуля. Индекс «к прошлому периоду» скачет около 100."""
    v = values.dropna()
    if _has(name, ("к предыдущ", "к пред.", "prev")):
        return "prev100"
    positive = bool((v > 0).all())
    steady = len(v) > 3 and v.diff().std() < 0.7 * v.std()         # соседние значения близки -> это уровень
    if positive and steady:
        return "level"
    if positive and v.between(50, 200).all() and 95 < v.mean() < 115:
        return "prev100"
    return "return_frac" if v.abs().mean() < 0.15 and "%" not in str(name) else "return_pct"


def to_monthly_levels(values, kind):
    """Ряд любого вида -> помесячный ряд уровней с подписями «ГГГГ-ММ». Для доходностей уровень начинается с 1."""
    v = values.dropna()
    months = v.index.to_period("M")
    if kind == "level":
        if (v <= 0).any():
            raise ReadError("в столбце уровней есть нули или отрицательные числа — похоже, это доходности")
        out = v.groupby(months).last()
    else:
        growth = {"return_pct": 1 + v / 100, "return_frac": 1 + v, "prev100": v / 100}[kind]
        if (growth <= 0).any():
            raise ReadError("доходность ниже −100% невозможна — проверьте вид данных в столбце")
        monthly = growth.groupby(months).prod()                    # доходности внутри месяца перемножаются
        out = pd.concat([pd.Series({monthly.index[0] - 1: 1.0}), monthly.cumprod()])
    out.index = out.index.astype(str)
    return out


# ---------- 5. Всё вместе ----------

def read_files(files, kinds=None, inflation="auto", builtin_cpi=None):
    """files: список (имя, байты). kinds: {название столбца: вид} — поправки пользователя.
    inflation: "auto", "file", "builtin" или "none".
    Возвращает (таблица помесячных уровней со столбцом CPI, список индикаторов, отчёт)."""
    kinds = kinds or {}
    series, report = {}, {"files": [], "columns": [], "warnings": []}
    for name, raw in files:
        if not raw:
            raise ReadError(f"«{name}»: файл пустой.")
        name = safe(name)
        stem = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", name)
        entry = {"name": name, "tables": []}
        for label, grid, kind in read_grids(name, raw):
            entry["format"] = kind
            frame, info = extract(grid, stem)
            where = f"лист «{safe(label)}»" if label else "таблица"
            if frame is None:
                entry["tables"].append({"where": where, "skipped": info})
                continue
            freq = frequency(frame.index)
            if freq in ("квартальные", "годовые"):
                entry["tables"].append({"where": where, "skipped": f"данные {freq}: нужны не реже раза в месяц"})
                continue
            entry["tables"].append({"where": where, "layout": info["layout"], "rows": len(frame), "frequency": freq,
                                    "decimal": "запятая" if info["decimal"] == "," else "точка",
                                    "left_out": [safe(x) for x in info.get("skipped", [])]})
            for column in frame.columns:
                title = safe(column)
                while title in series:                              # одинаковые названия из разных файлов различаем
                    title = f"{title} ({stem})" if f"({stem})" not in title else title + "'"
                series[title] = (frame[column], freq, name)
        report["files"].append(entry)
    if not series:
        reasons = "; ".join(f"{f['name']}: {t['skipped']}" for f in report["files"] for t in f["tables"] if "skipped" in t)
        raise ReadError("В файле не найдена таблица с датами и числами. " + reasons)

    levels, cpi_name = {}, None
    for title, (values, freq, source) in series.items():
        auto = guess_kind(title, values)
        kind = kinds.get(title, auto)
        column = {"name": title, "file": source, "frequency": freq, "kind": kind, "kind_auto": auto}
        try:
            monthly = to_monthly_levels(values, kind)
            if len(monthly) < 3:
                raise ReadError("меньше трёх месяцев данных")
        except ReadError as e:
            column["error"] = str(e)
            report["columns"].append(column)
            continue
        column.update(first=monthly.index[0], last=monthly.index[-1], months=len(monthly))
        if _has(title, CPI_WORDS):
            if _has(title, ("г/г", "yoy", "годов", "соответствующ", "y/y")):
                column["error"] = "годовая инфляция не подходит: нужен помесячный индекс цен или инфляция за месяц"
                report["columns"].append(column)
                continue
            if cpi_name is not None:                                # второй и следующие индексы цен в портфель не идут
                column["error"] = "похоже на индекс цен; как инфляция используется первый такой столбец"
                report["columns"].append(column)
                continue
            cpi_name, column["role"] = title, "инфляция"
        levels[title] = monthly
        report["columns"].append(column)

    assets = [t for t in levels if t != cpi_name]
    if len(assets) > MAX_COLUMNS:
        report["warnings"].append(f"В файле {len(assets)} столбцов с данными; взяты первые {MAX_COLUMNS}.")
        assets = assets[:MAX_COLUMNS]
    if len(assets) < 2:
        problems = "; ".join(f"«{c['name']}» — {c['error']}" for c in report["columns"] if "error" in c)
        raise ReadError("Для портфеля нужно хотя бы два столбца с данными, а распознан " + (f"один: «{assets[0]}»." if assets else "ноль.") +
                        (f" Не взяты: {problems}." if problems else " Загрузите несколько файлов сразу или таблицу с несколькими столбцами."))

    first, last = min(levels[a].index[0] for a in assets), max(levels[a].index[-1] for a in assets)
    months = pd.period_range(first, last, freq="M").astype(str)
    table = pd.DataFrame({f"C{i + 1}": levels[a].reindex(months) for i, a in enumerate(assets)}, index=months)

    # Инфляция: из файла, встроенная (Росстат) или никакой
    mode = inflation
    if mode == "auto":
        mode = "file" if cpi_name else "builtin" if builtin_cpi is not None and len(months.intersection(builtin_cpi.index)) >= 24 else "none"
    if mode == "file" and not cpi_name:
        mode = "builtin" if builtin_cpi is not None else "none"
    if mode == "file":
        table["CPI"] = levels[cpi_name].reindex(months)
        note = f"из столбца «{cpi_name}» вашего файла"
    elif mode == "builtin":
        table["CPI"] = builtin_cpi.reindex(months)
        covered = int(table["CPI"].notna().sum())
        note = f"встроенный индекс цен Росстата ({covered} из {len(months)} мес. вашего периода)"
        if covered < len(months):
            report["warnings"].append(f"Встроенный индекс цен покрывает {covered} из {len(months)} месяцев файла; остальные месяцы в расчёт не войдут.")
    else:
        table["CPI"] = 1.0
        note = "не учитывается: доходности остаются как в файле"
    report["inflation"] = {"mode": mode, "note": note, "has_column": bool(cpi_name)}
    report["period"] = [months[0], months[-1], len(months)]
    by_name = {c["name"]: c for c in report["columns"]}
    meta = [{"id": f"C{i + 1}", "name": a, "source": by_name[a]["file"]} for i, a in enumerate(assets)]
    return table, meta, report
