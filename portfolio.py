"""
Расчёты: реальные доходности, оптимизация портфеля по Марковицу,
эффективная граница и показатели кривой доходности.

Реальная доходность за месяц:  r = (1 + r_ном) / (1 + инфляция) - 1
Годовые величины:              mu = среднее * 12,  sigma = ст.отклонение * sqrt(12)
"""
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


def load_data():
    df = pd.read_csv(DATA_FILE, index_col=0)
    df.index = df.index.astype(str)
    return df


def real_returns(assets, start=None, end=None):
    """Месячные реальные доходности выбранных индикаторов
    на общем периоде, где данные есть по каждому из них."""
    df = load_data()
    nominal = df[assets].pct_change(fill_method=None)
    inflation = df["CPI"].pct_change()
    real = (1 + nominal).div(1 + inflation, axis=0) - 1
    if start:
        real = real.loc[real.index >= start]
    if end:
        real = real.loc[real.index <= end]
    return real.dropna()


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


def curve_and_metrics(returns, w):
    """Кривая доходности (рост 1 рубля; веса каждый месяц возвращаются к заданным)
    и четыре показателя из задания."""
    r = returns.values @ w                                   # доходность портфеля по месяцам
    curve = np.concatenate([[1.0], np.cumprod(1 + r)])
    peak = np.maximum.accumulate(curve)                      # предыдущий максимум
    drawdown = curve / peak - 1

    longest = current = 0                                    # самый долгий срок ниже максимума
    for below in curve < peak - 1e-12:
        current = current + 1 if below else 0
        longest = max(longest, current)

    return curve, {
        "mean_return": float(r.mean() * 12),                 # ожидаемый доход, среднегодовой
        "volatility": float(r.std(ddof=1) * np.sqrt(12)),    # ожидаемая волатильность
        "max_drawdown": float(drawdown.min()),               # максимальная просадка
        "max_recovery_months": int(longest),                 # максимальный период восстановления
        "recovered": bool(curve[-1] >= peak[-1] - 1e-12),    # вернулся ли к максимуму к концу периода
    }
