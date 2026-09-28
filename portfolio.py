"""
Расчётное ядро: реальные доходности, оптимизация портфеля по Марковицу,
эффективная граница и показатели кривой доходности.

Все доходности — РЕАЛЬНЫЕ (очищенные от инфляции):
    r_real = (1 + r_nominal) / (1 + inflation) - 1
Годовые величины получаются из месячных:
    ожидаемая доходность  mu_year    = mu_month * 12
    волатильность          sigma_year = sigma_month * sqrt(12)
"""
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize

DATA_FILE = Path(__file__).parent / "data" / "data.csv"
PERIODS = 12  # месяцев в году

# Описание индикаторов. Порядок = порядок в интерфейсе.
ASSETS = [
    {"id": "M2", "name": "Денежная масса М2", "class": "Макроэкономика",
     "source": "Банк России", "color": "#52514e",
     "note": "Рублёвая денежная масса (индикатор №1). Не биржевой актив — ориентир «скорости печати денег»."},
    {"id": "MCFTR", "name": "Акции крупных компаний (MCFTR)", "class": "Акции",
     "source": "Московская биржа", "color": "#2a78d6",
     "note": "Индекс МосБиржи полной доходности брутто — с реинвестированием дивидендов."},
    {"id": "SMID", "name": "Акции малых и средних компаний (MESMTR)", "class": "Акции",
     "source": "Московская биржа", "color": "#86b6ef",
     "note": "Индекс МосБиржи SMID полной доходности. До 2019 г. восстановлен по ценовому индексу MCXSM + средняя дивидендная доходность."},
    {"id": "RGBITR", "name": "Гособлигации ОФЗ (RGBITR)", "class": "Облигации",
     "source": "Московская биржа", "color": "#008300",
     "note": "Индекс гособлигаций совокупного дохода (купоны реинвестируются)."},
    {"id": "CORP", "name": "Корпоративные облигации (RUCBTRNS)", "class": "Облигации",
     "source": "Московская биржа", "color": "#1baf7a",
     "note": "Индекс корпоративных облигаций совокупного дохода: RUCBITR до 12.2020, далее RUCBTRNS."},
    {"id": "GOLD", "name": "Золото (руб./г)", "class": "Драгоценные металлы",
     "source": "Банк России", "color": "#eda100",
     "note": "Учётная цена ЦБ на аффинированное золото."},
    {"id": "CNY", "name": "Юань (CNY/RUB)", "class": "Валюта",
     "source": "Банк России", "color": "#e34948",
     "note": "Официальный курс ЦБ. Процентный доход по юаневым вкладам не учитывается."},
    {"id": "USD", "name": "Доллар США (USD/RUB)", "class": "Валюта",
     "source": "Банк России", "color": "#eb6834",
     "note": "Официальный курс ЦБ."},
    {"id": "REALTY", "name": "Недвижимость Москвы (MREDC)", "class": "Недвижимость",
     "source": "Московская биржа / ДомКлик", "color": "#4a3aa7",
     "note": "Индекс стоимости жилья в Москве, руб./м² (данные с 12.2016). Арендный доход не учитывается."},
    {"id": "DEPOSIT", "name": "Денежный рынок / депозит", "class": "Денежный рынок",
     "source": "Банк России (ключевая ставка)", "color": "#e87ba4",
     "note": "Доход по ключевой ставке ЦБ, начисляется ежемесячно (аналог фондов денежного рынка)."},
    {"id": "SILVER", "name": "Серебро (руб./г) — доп.", "class": "Драгоценные металлы",
     "source": "Банк России", "color": "#a8a69e",
     "note": "Дополнительный индикатор сверх обязательных десяти."},
]
ASSET_IDS = [a["id"] for a in ASSETS]
DEFAULT_SELECTED = ["MCFTR", "SMID", "RGBITR", "CORP", "GOLD", "CNY", "USD", "REALTY", "DEPOSIT"]


# ---------------------------------------------------------------- данные
_cache = {}


def load_data():
    if "df" not in _cache:
        df = pd.read_csv(DATA_FILE, index_col=0)
        df.index = df.index.astype(str)
        _cache["df"] = df
    return _cache["df"]


def real_returns(deflator="cpi"):
    """Месячные реальные доходности всех индикаторов.
    deflator='cpi' — очищаем от инфляции (ИПЦ);
    deflator='m2'  — очищаем от роста денежной массы М2 («в долях всей рублёвой массы»)."""
    df = load_data()
    nominal = df[ASSET_IDS].pct_change()
    base = df["CPI"] if deflator == "cpi" else df["M2"]
    infl = base.pct_change()
    real = (1 + nominal).div(1 + infl, axis=0) - 1
    return real.iloc[1:]


def availability():
    df = load_data()
    out = {}
    for a in ASSET_IDS:
        s = df[a].dropna()
        out[a] = {"from": s.index[0], "to": s.index[-1]}
    return out


def window_returns(assets, start=None, end=None, deflator="cpi"):
    """Реальные доходности выбранных индикаторов на общем периоде, где есть все данные."""
    r = real_returns(deflator)[assets]
    if start:
        r = r.loc[r.index >= start]
    if end:
        r = r.loc[r.index <= end]
    r = r.dropna()
    return r


# ---------------------------------------------------------------- портфель
def port_stats(w, mu, cov):
    ret = float(w @ mu)
    vol = float(np.sqrt(max(w @ cov @ w, 0.0)))
    return ret, vol


def _solve(fun, n, bounds, cons, x0=None):
    x0 = np.full(n, 1.0 / n) if x0 is None else x0
    res = minimize(fun, x0, method="SLSQP", bounds=bounds, constraints=cons,
                   options={"maxiter": 1000, "ftol": 1e-12})
    w = np.clip(res.x, 0, None) if bounds[0][0] >= 0 else res.x
    w = w / w.sum()
    return w, res.success


def optimize(mu, cov, criterion, rf=0.05, target=None, max_weight=1.0, allow_short=False):
    """
    Оптимизация весов. mu и cov — ГОДОВЫЕ.
      min_vol        — портфель Марковица минимальной волатильности;
      max_sharpe     — максимальный коэффициент Шарпа (безрисковая ставка rf);
      target_return  — «эффективный риск»: минимальный риск при заданной доходности;
      target_risk    — «эффективная доходность»: максимальная доходность при заданном риске.
    """
    n = len(mu)
    lo = -max_weight if allow_short else 0.0
    bounds = [(lo, max_weight)] * n
    budget = {"type": "eq", "fun": lambda w: w.sum() - 1}
    var = lambda w: w @ cov @ w
    message = ""

    if criterion == "min_vol":
        w, ok = _solve(var, n, bounds, [budget])

    elif criterion == "max_sharpe":
        def neg_sharpe(w):
            r, v = port_stats(w, mu, cov)
            return -(r - rf) / v if v > 1e-12 else 1e6
        # несколько стартовых точек — надёжнее находит глобальный максимум
        best = None
        starts = [np.full(n, 1 / n)] + [np.eye(n)[i] * 0.5 + 0.5 / n for i in range(n)]
        for x0 in starts:
            w_, ok_ = _solve(neg_sharpe, n, bounds, [budget], x0)
            if best is None or neg_sharpe(w_) < neg_sharpe(best[0]):
                best = (w_, ok_)
        w, ok = best

    elif criterion == "target_return":
        w_min, _ = _solve(var, n, bounds, [budget])
        r_min, _ = port_stats(w_min, mu, cov)
        r_max = max_return_possible(mu, max_weight, allow_short)
        t = float(target)
        if t <= r_min:
            message = (f"Доходность {t:.2%} ниже, чем у портфеля минимального риска "
                       f"({r_min:.2%}), — показан портфель минимального риска.")
            w, ok = w_min, True
        elif t > r_max:
            message = f"Доходность {t:.2%} недостижима (максимум {r_max:.2%}). Показан ближайший возможный портфель."
            t = r_max
            cons = [budget, {"type": "eq", "fun": lambda w: w @ mu - t}]
            w, ok = _solve(var, n, bounds, cons)
        else:
            cons = [budget, {"type": "eq", "fun": lambda w: w @ mu - t}]
            w, ok = _solve(var, n, bounds, cons)

    elif criterion == "target_risk":
        w_min, _ = _solve(var, n, bounds, [budget])
        _, v_min = port_stats(w_min, mu, cov)
        t = float(target)
        if t <= v_min:
            message = (f"Риск {t:.2%} ниже минимально возможного ({v_min:.2%}), "
                       f"— показан портфель минимального риска.")
            w, ok = w_min, True
        else:
            cons = [budget, {"type": "ineq", "fun": lambda w: t ** 2 - w @ cov @ w}]
            best = None
            for x0 in [w_min] + [np.eye(n)[i] * 0.5 + 0.5 / n for i in range(n)]:
                w_, ok_ = _solve(lambda w: -(w @ mu), n, bounds, cons, x0)
                if w_ @ cov @ w_ <= t ** 2 * 1.0001 and (best is None or w_ @ mu > best[0] @ mu):
                    best = (w_, ok_)
            w, ok = best if best else (w_min, False)
    else:
        raise ValueError("Неизвестный критерий")

    w[np.abs(w) < 1e-6] = 0.0
    return w, message


def max_return_possible(mu, max_weight=1.0, allow_short=False):
    """Максимальная доходность при ограничении веса (лонг): берём лучшие активы по максимуму."""
    order = np.argsort(-mu)
    left, total = 1.0, 0.0
    for i in order:
        take = min(max_weight, left)
        total += take * mu[i]
        left -= take
        if left <= 1e-12:
            break
    return total


def efficient_frontier(mu, cov, max_weight=1.0, allow_short=False, points=40):
    """Эффективная граница: для сетки целевых доходностей находим минимальный риск."""
    n = len(mu)
    lo = -max_weight if allow_short else 0.0
    bounds = [(lo, max_weight)] * n
    budget = {"type": "eq", "fun": lambda w: w.sum() - 1}
    var = lambda w: w @ cov @ w
    w_min, _ = _solve(var, n, bounds, [budget])
    r_min, _ = port_stats(w_min, mu, cov)
    r_max = max_return_possible(mu, max_weight, allow_short)
    out = []
    x0 = w_min
    for t in np.linspace(r_min, r_max, points):
        cons = [budget, {"type": "eq", "fun": lambda w, t=t: w @ mu - t}]
        w, ok = _solve(var, n, bounds, cons, x0)
        r, v = port_stats(w, mu, cov)
        if abs(r - t) < 1e-4:
            out.append({"ret": r, "vol": v, "w": [round(float(x), 4) for x in w]})
            x0 = w
    return out


def random_portfolios(mu, cov, k=2500, seed=1):
    """Облако случайных портфелей (для наглядности на графике границы)."""
    rng = np.random.default_rng(seed)
    n = len(mu)
    W = rng.dirichlet(np.full(n, 0.6), size=k)
    rets = W @ mu
    vols = np.sqrt(np.einsum("ij,jk,ik->i", W, cov, W))
    return rets, vols


# ---------------------------------------------------------------- кривая доходности
def equity_curve(returns_df, w, rebalance=True):
    """Кривая роста 1 рубля (в реальном выражении).
    rebalance=True — ежемесячная ребалансировка к целевым весам."""
    r = returns_df.values
    if rebalance:
        port_r = r @ w
    else:
        values = np.cumprod(1 + r, axis=0) * w
        total = values.sum(axis=1)
        port_r = np.concatenate([[total[0] - 1], total[1:] / total[:-1] - 1])
    curve = np.concatenate([[1.0], np.cumprod(1 + port_r)])
    return port_r, curve


def curve_metrics(port_r, curve, rf=0.0):
    """Показатели кривой доходности."""
    n = len(port_r)
    mean_ann = float(np.mean(port_r) * PERIODS)                    # ожидаемый доход (средний)
    cagr = float(curve[-1] ** (PERIODS / n) - 1)                     # среднегодовой (геометр.)
    vol = float(np.std(port_r, ddof=1) * np.sqrt(PERIODS))          # ожидаемая волатильность
    sharpe = (mean_ann - rf) / vol if vol > 0 else None
    peak = np.maximum.accumulate(curve)
    dd = curve / peak - 1
    max_dd = float(dd.min())                                        # максимальная просадка
    # максимальный период восстановления: самый долгий срок "ниже прошлого максимума"
    longest, cur, start, best_span, unrecovered = 0, 0, 0, (0, 0), False
    for i in range(1, len(curve)):
        if curve[i] < peak[i] - 1e-12:
            if cur == 0:
                start = i - 1
            cur += 1
            if cur > longest:
                longest, best_span = cur, (start, i)
        else:
            cur = 0
    if cur > 0 and cur == longest:
        unrecovered = True
    down = port_r[port_r < 0]
    sortino = (mean_ann - rf) / (np.std(down, ddof=1) * np.sqrt(PERIODS)) if len(down) > 1 else None
    return {
        "mean_return": mean_ann,
        "cagr": cagr,
        "volatility": vol,
        "sharpe": sharpe,
        "sortino": float(sortino) if sortino is not None else None,
        "max_drawdown": max_dd,
        "max_recovery_months": int(longest),
        "recovery_span": [int(best_span[0]), int(best_span[1])],
        "unrecovered": unrecovered,
        "total_return": float(curve[-1] - 1),
        "months": n,
    }, dd


def annual_stats(returns_df):
    mu = returns_df.mean().values * PERIODS
    cov = returns_df.cov().values * PERIODS
    return mu, cov
