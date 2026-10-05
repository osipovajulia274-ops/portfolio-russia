"""
Расчёты: реальные доходности, оптимизация портфеля по Марковицу,
эффективная граница, показатели кривой доходности, проверка устойчивости
и пояснения к расчёту (что произошло с данными на каждом этапе).

Реальная доходность за месяц:  r = (1 + r_ном) / (1 + инфляция) - 1
Годовые величины:              mu = среднее * 12,  sigma = ст.отклонение * sqrt(12)
"""
import hashlib
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize

DATA_FILE = Path(__file__).parent / "data" / "data.csv"

# 10 индикаторов (id — название столбца в data.csv)
ASSETS = [
    {"id": "M2", "name": "Денежная масса М2", "source": "Банк России"},
    {"id": "MCFTR", "name": "Акции крупных компаний (MCFTR)", "source": "Московская биржа"},
    {"id": "MESMTR", "name": "Акции малых и средних компаний (MESMTR)", "source": "Московская биржа"},
    {"id": "RGBITR", "name": "Гособлигации ОФЗ (RGBITR)", "source": "Московская биржа"},
    {"id": "CORP", "name": "Корпоративные облигации (RUCBTRNS)", "source": "Московская биржа"},
    {"id": "GOLD", "name": "Золото", "source": "Банк России"},
    {"id": "SILVER", "name": "Серебро", "source": "Банк России"},
    {"id": "CNY", "name": "Юань", "source": "Банк России"},
    {"id": "USD", "name": "Доллар США", "source": "Банк России"},
    {"id": "REALTY", "name": "Недвижимость Москвы (MREDC)", "source": "Московская биржа / ДомКлик"},
]
IDS = [a["id"] for a in ASSETS]


# Какие индикаторы приносят доход помимо роста цены (если пользователь включил этот учёт)
INCOME = {"REALTY": "rent", "USD": "deposit", "CNY": "deposit"}


# Таблицы, загруженные пользователями: номер набора -> (таблица, список индикаторов, сведения о файле).
# Хранятся в памяти сервера, не больше 30 штук: самая давняя вытесняется.
DATASETS = OrderedDict()


class DatasetGone(KeyError):
    """Сервер перезапускался и забыл загруженную таблицу — страница пришлёт её заново."""


@lru_cache(maxsize=1)
def builtin_data():
    """Встроенная таблица данных. Читается с диска один раз и запоминается."""
    df = pd.read_csv(DATA_FILE, index_col=0)
    df.index = df.index.astype(str)
    return df


def register(table, assets, info=None):
    """Запоминает загруженную таблицу и возвращает её номер. Номер — отпечаток содержимого:
    одна и та же таблица всегда получает один и тот же номер."""
    key = hashlib.sha1((table.to_csv() + repr(assets)).encode("utf-8")).hexdigest()[:12]
    DATASETS[key] = (table, assets, info or {})
    DATASETS.move_to_end(key)
    while len(DATASETS) > 30:
        DATASETS.popitem(last=False)
    return key


def load_data(dataset=None):
    """Таблица данных: встроенная (dataset не задан) или загруженная пользователем."""
    if not dataset:
        return builtin_data()
    if dataset not in DATASETS:
        raise DatasetGone(dataset)
    return DATASETS[dataset][0]


def assets_of(dataset=None):
    """Список индикаторов набора данных."""
    return ASSETS if not dataset else (load_data(dataset), DATASETS[dataset][1])[1]


@lru_cache(maxsize=64)
def prepare(assets, start=None, end=None, rent=0.0, deposit=0.0, dataset=None):
    """Месячные доходности выбранных индикаторов на общем периоде, где данные есть по каждому.
    Возвращает две таблицы: реальные доходности (после инфляции) и номинальные (в рублях).
    rent    — арендная доходность недвижимости, доля в год (0.055 = 5,5%);
    deposit — ставка по валютному вкладу для доллара и юаня, доля в год.
    dataset — номер загруженной таблицы (если не задан, берётся встроенная).
    Результат запоминается: повторный запрос с теми же настройками не пересчитывается."""
    df = load_data(dataset)
    assets = list(assets)
    nominal = df[assets].pct_change(fill_method=None)
    extra = {"rent": rent, "deposit": deposit}
    for a in assets:
        rate = extra.get(INCOME.get(a), 0.0)
        if rate:                                   # к росту цены добавляем доход за месяц
            nominal[a] = (1 + nominal[a]) * (1 + rate / 12) - 1
    inflation = df["CPI"].pct_change(fill_method=None)
    real = (1 + nominal).div(1 + inflation, axis=0) - 1
    if start:
        real = real.loc[real.index >= start]
    if end:
        real = real.loc[real.index <= end]
    real = real.dropna()
    return real, nominal.loc[real.index]


def real_returns(assets, start=None, end=None, rent=0.0, deposit=0.0, dataset=None):
    """Месячные реальные доходности (таблица)."""
    return prepare(tuple(assets), start, end, rent, deposit, dataset)[0]


def annual_stats(returns):
    """Годовые ожидаемые доходности и ковариационная матрица."""
    return returns.mean().values * 12, returns.cov().values * 12


def portfolio_return(w, mu):
    return float(w @ mu)


def portfolio_risk(w, cov):
    return float(np.sqrt(w @ cov @ w))


def _minimize(objective, n, constraints, x0=None):
    """Численная оптимизация (метод SLSQP). Веса от 0 до 1, сумма весов = 1."""
    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1}] + constraints
    x0 = np.full(n, 1 / n) if x0 is None else x0
    res = minimize(objective, x0, method="SLSQP", bounds=[(0, 1)] * n,
                   constraints=constraints, options={"maxiter": 1000, "ftol": 1e-12})
    w = np.clip(res.x, 0, 1)
    w[w < 1e-6] = 0
    return w / w.sum()


def optimize(mu, cov, criterion, rf=0.05, target=None):
    """
    Четыре критерия:
      min_vol        — минимальная волатильность (портфель Марковица);
      max_sharpe     — максимальный коэффициент Шарпа (mu_p - rf) / sigma_p;
      target_return  — «эффективный риск»: минимальный риск при заданной доходности;
      target_risk    — «эффективная доходность»: максимальная доходность при заданном риске.
    Возвращает веса и текст предупреждения (если цель недостижима).
    """
    n = len(mu)
    variance = lambda w: w @ cov @ w
    w_min = _minimize(variance, n, [])
    note = ""

    if criterion == "min_vol":
        return w_min, note

    if criterion == "max_sharpe":
        neg_sharpe = lambda w: -(w @ mu - rf) / np.sqrt(w @ cov @ w)
        # Задача не выпуклая, поэтому стартуем из нескольких точек и берём лучший ответ
        starts = [np.full(n, 1 / n)] + [0.5 * np.eye(n)[i] + 0.5 / n for i in range(n)]
        candidates = [_minimize(neg_sharpe, n, [], x0) for x0 in starts]
        return min(candidates, key=neg_sharpe), note

    if criterion == "target_return":
        lo, hi = portfolio_return(w_min, mu), float(mu.max())
        t = float(target)
        if t < lo:
            return w_min, f"Доходность {t:.1%} ниже, чем у портфеля минимального риска ({lo:.1%}). Показан он."
        if t > hi:
            note = f"Доходность {t:.1%} недостижима, максимум {hi:.1%}. Показан портфель с максимальной доходностью."
            t = hi
        w = _minimize(variance, n, [{"type": "eq", "fun": lambda w: w @ mu - t}])
        return w, note

    if criterion == "target_risk":
        lo = portfolio_risk(w_min, cov)
        t = float(target)
        if t < lo:
            return w_min, f"Риск {t:.1%} ниже минимально возможного ({lo:.1%}). Показан портфель минимального риска."
        w = _minimize(lambda w: -(w @ mu), n,
                      [{"type": "ineq", "fun": lambda w: t ** 2 - w @ cov @ w}], w_min)
        return w, note

    raise ValueError("Неизвестный критерий")


def efficient_frontier(mu, cov, points=30):
    """Эффективная граница: для каждого уровня доходности — портфель с минимальным риском."""
    n = len(mu)
    variance = lambda w: w @ cov @ w
    w = _minimize(variance, n, [])
    frontier = []
    for t in np.linspace(portfolio_return(w, mu), mu.max(), points):
        w = _minimize(variance, n, [{"type": "eq", "fun": lambda w, t=t: w @ mu - t}], w)
        frontier.append((portfolio_risk(w, cov), portfolio_return(w, mu)))
    return frontier


@lru_cache(maxsize=64)
def frontier_for(assets, start=None, end=None, rent=0.0, deposit=0.0, dataset=None):
    """Эффективная граница для набора настроек. Запоминается: при смене одного только
    критерия или ставки граница та же, и считать её заново не нужно."""
    real, _ = prepare(assets, start, end, rent, deposit, dataset)
    return efficient_frontier(*annual_stats(real))


def curve_and_metrics(returns, w, nominal=None, fee=0.0, tax=0.0, rf=0.0):
    """Кривая доходности (рост 1 рубля; веса каждый месяц возвращаются к заданным) и показатели.
    fee — комиссия с оборота (0.001 = 0,1%): берётся при первой покупке и при каждом возврате долей;
    tax — налог на доход в конце периода (0.13 = 13%), считается с рублёвой прибыли."""
    R = returns.values
    r = R @ w                                                # доходность портфеля по месяцам
    N = nominal.values if nominal is not None else R
    r_nom = N @ w
    if fee:
        drifted = w * (1 + N) / (1 + r_nom)[:, None]         # доли после месяца: что выросло, того стало больше
        turnover = np.abs(drifted - w).sum(axis=1)           # сколько нужно продать и купить, чтобы вернуть доли
        cost = 1 - fee * turnover
        cost[0] *= 1 - fee                                   # первая покупка портфеля
        r = (1 + r) * cost - 1
        r_nom = (1 + r_nom) * cost - 1

    curve = np.concatenate([[1.0], np.cumprod(1 + r)])
    peak = np.maximum.accumulate(curve)                      # предыдущий максимум
    drawdown = curve / peak - 1

    longest = current = 0                                    # самый долгий срок ниже максимума
    for below in curve < peak - 1e-12:
        current = current + 1 if below else 0
        longest = max(longest, current)

    mean = float(r.mean() * 12)
    downside = float(np.sqrt(np.mean(np.minimum(r, 0) ** 2)) * np.sqrt(12))   # колебания только вниз
    final_nominal = float(np.prod(1 + r_nom))
    after_tax = (final_nominal - tax * max(final_nominal - 1, 0)) / final_nominal   # доля, остающаяся после налога

    return curve, {
        "mean_return": mean,                                 # ожидаемый доход, среднегодовой
        "volatility": float(r.std(ddof=1) * np.sqrt(12)),    # ожидаемая волатильность
        "downside": downside,                                # риск потерь
        "sortino": (mean - rf) / downside if downside > 0 else None,
        "max_drawdown": float(drawdown.min()),               # максимальная просадка
        "max_recovery_months": int(longest),                 # максимальный период восстановления
        "recovered": bool(curve[-1] >= peak[-1] - 1e-12),    # вернулся ли к максимуму к концу периода
        "final_value": float(curve[-1]),                     # во что превратился 1 рубль
        "final_after_tax": float(curve[-1] * after_tax),     # то же после налога
    }


def stability(assets, criterion, rf=0.05, target=None, start=None, end=None, rent=0.0, deposit=0.0, step=6, dataset=None):
    """Устойчивость к периоду: считаем доли на нескольких «окнах» одинаковой длины,
    каждое следующее сдвинуто на полгода. Если доли сильно меняются — результат неустойчив."""
    real, _ = prepare(tuple(assets), start, end, rent, deposit, dataset)
    n = len(real)
    window = 60 if n >= 72 else int(n * 2 / 3)               # 5 лет, а на коротких данных — две трети периода
    if window < 24:
        raise ValueError("Для проверки устойчивости нужно не меньше 36 месяцев данных.")
    out = []
    for last in range(n, window - 1, -step):
        part = real.iloc[last - window:last]
        mu, cov = annual_stats(part)
        w, _ = optimize(mu, cov, criterion, rf, target)
        out.append({"from": part.index[0], "to": part.index[-1], "weights": np.round(w, 4).tolist(),
                    "ret": portfolio_return(w, mu), "risk": portfolio_risk(w, cov)})
    return out[::-1]


def future_check(assets, criterion, rf=0.05, target=None, start=None, end=None, rent=0.0, deposit=0.0, split=None, dataset=None):
    """Проверка на «будущем». Период делится на две части. Доли подбираются только по ранней части,
    а результат считается на поздней, которую оптимизатор не видел. Для сравнения — портфель с равными долями.
    split — последний месяц ранней части; если не задан, ранняя часть — первые 72% периода."""
    real, _ = prepare(tuple(assets), start, end, rent, deposit, dataset)
    n = len(real)
    k = list(real.index).index(split) + 1 if split in real.index else round(n * 0.72)
    if k < 24 or n - k < 12:
        raise ValueError("Для проверки нужно не меньше 24 месяцев на подбор долей и 12 месяцев на проверку.")
    train, test = real.iloc[:k], real.iloc[k:]
    mu, cov = annual_stats(train)
    w, note = optimize(mu, cov, criterion, rf, target)
    equal = np.full(len(w), 1 / len(w))

    def row(weights):
        curve, m = curve_and_metrics(test, weights, rf=rf)
        return {"expected_return": portfolio_return(weights, mu), "expected_risk": portfolio_risk(weights, cov),
                "return": m["mean_return"], "risk": m["volatility"], "max_drawdown": m["max_drawdown"],
                "final_value": m["final_value"], "curve": np.round(curve, 4).tolist()}

    return {"train": [train.index[0], train.index[-1], k], "test": [test.index[0], test.index[-1], n - k],
            "weights": np.round(w, 4).tolist(), "note": note, "portfolio": row(w), "equal": row(equal),
            "months": [train.index[-1]] + list(test.index),
            "choices": list(real.index[23:n - 12])}                  # месяцы, которыми можно закончить раннюю часть


# ---------- Пояснения к расчёту: что произошло с данными на каждом этапе ----------

def explain_period(assets, start, end, real, dataset=None):
    """Сколько месяцев просили, сколько осталось и что ограничило период:
    индикатор (или индекс цен), у которого данные начинаются позже всех или кончаются раньше всех."""
    df = load_data(dataset)
    asked = [m for m in df.index[1:] if (not start or m >= start) and (not end or m <= end)]
    columns = list(assets) + ["CPI"]
    first = {a: df[a].dropna().index[1] for a in columns}        # первый месяц, для которого есть доходность
    last = {a: df[a].dropna().index[-1] for a in columns}
    late, early = max(columns, key=first.get), min(columns, key=last.get)
    return {"table_months": len(df) - 1, "asked_from": asked[0], "asked_to": asked[-1], "asked": len(asked),
            "kept": len(real), "dropped": len(asked) - len(real),
            "first": {a: first[a] for a in assets}, "last": {a: last[a] for a in assets},
            "limiting": late if first[late] > asked[0] else None,
            "limiting_end": early if last[early] < asked[-1] else None}


def explain_inflation(real, nominal, dataset=None):
    """Рост цен за период и доходность каждого индикатора до и после вычета инфляции (в год)."""
    cpi = load_data(dataset)["CPI"]
    before = cpi.index[cpi.index.get_loc(real.index[0]) - 1]      # месяц, когда «вложили рубль»
    total = float(cpi[real.index[-1]] / cpi[before] - 1)
    return {"total": total, "annual": (1 + total) ** (12 / len(real)) - 1,
            "nominal": (nominal.mean().values * 12).tolist(), "real": (real.mean().values * 12).tolist()}


def explain_portfolio(w, mu, cov):
    """Из чего сложились доходность и риск портфеля.
    Вклад в доходность = доля * доходность индикатора (в сумме — доходность портфеля).
    Вклад в риск = доля * ковариация с портфелем / риск портфеля (в сумме — риск портфеля).
    Бета = ковариация с портфелем / дисперсия портфеля: меньше 1 — индикатор успокаивает портфель, больше 1 — раскачивает."""
    with_portfolio = cov @ w
    risk = portfolio_risk(w, cov)
    return {"ret": (w * mu).tolist(), "risk": (w * with_portfolio / risk).tolist(),
            "beta": (with_portfolio / risk ** 2).tolist()}


def explain_curve(curve, labels, real, nominal, w, fee=0.0):
    """Подробности к показателям кривой: из каких чисел получились доход, волатильность,
    просадка и период восстановления, и как 1 рубль дошёл до итоговой суммы."""
    r = curve[1:] / curve[:-1] - 1
    peak = np.maximum.accumulate(curve)
    trough = int((curve / peak - 1).argmin())                     # дно самой глубокой просадки
    top = int(curve[:trough + 1].argmax())                        # вершина перед ним

    below = curve < peak - 1e-12                                  # самый долгий срок ниже вершины: где начался и кончился
    longest = current = last = 0
    for i, b in enumerate(below):
        current = current + 1 if b else 0
        if current > longest:
            longest, last = current, i

    N = nominal.values
    r_nom = N @ w
    drifted = w * (1 + N) / (1 + r_nom)[:, None]
    return {
        "monthly_mean": float(r.mean()), "monthly_std": float(r.std(ddof=1)),
        "loss_months": int((r < 0).sum()), "months": len(r),
        "dd_top": [labels[top], float(curve[top])], "dd_trough": [labels[trough], float(curve[trough])],
        "recovery": [labels[last - longest], labels[last]] if longest else None,
        "turnover": float(np.abs(drifted - w).sum(axis=1).mean()),     # средний оборот при возврате долей
        "fee_total": float(1 - (1 - fee) * np.prod(1 - fee * np.abs(drifted - w).sum(axis=1))),
        # Путь рубля: рост цен в рублях -> минус инфляция -> минус комиссии (налог считает curve_and_metrics)
        "final_nominal": float(np.prod(1 + r_nom)), "final_real": float(np.prod(1 + real.values @ w)),
    }
