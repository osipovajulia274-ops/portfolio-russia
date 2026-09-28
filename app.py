"""
Веб-калькулятор оптимального портфеля (Россия, реальные доходности).
Запуск локально:  python app.py   ->  http://127.0.0.1:5000
На Render:        gunicorn app:app
"""
import os

import numpy as np
from flask import Flask, jsonify, render_template, request

import portfolio as pf

app = Flask(__name__)

CRITERIA = {
    "min_vol": "Минимальная волатильность (Марковиц)",
    "max_sharpe": "Максимальный коэффициент Шарпа",
    "target_return": "Эффективный риск: мин. риск при заданной доходности",
    "target_risk": "Эффективная доходность: макс. доходность при заданном риске",
}


def r4(x):
    return None if x is None else round(float(x), 6)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/meta")
def meta():
    df = pf.load_data()
    months = list(df.index[1:])
    return jsonify({
        "assets": pf.ASSETS,
        "default_selected": pf.DEFAULT_SELECTED,
        "availability": pf.availability(),
        "months": months,
        "criteria": CRITERIA,
        "avg_real_key_rate": avg_real_key_rate(),
    })


def avg_real_key_rate():
    df = pf.load_data()
    dep = pf.real_returns("cpi")["DEPOSIT"]
    return round(float(dep.mean() * 12), 4)


def parse_common(p):
    assets = [a for a in p.get("assets", []) if a in pf.ASSET_IDS]
    if len(assets) < 2:
        raise ValueError("Выберите хотя бы 2 индикатора.")
    deflator = p.get("deflator", "cpi")
    r = pf.window_returns(assets, p.get("start"), p.get("end"), deflator)
    if len(r) < 24:
        raise ValueError("Слишком короткий общий период данных (нужно минимум 24 месяца).")
    rf = float(p.get("rf", 0.05))
    max_w = float(p.get("max_weight", 1.0))
    if max_w * len(assets) < 1 - 1e-9:
        raise ValueError(f"Ограничение веса {max_w:.0%} слишком жёсткое для {len(assets)} активов.")
    rebalance = bool(p.get("rebalance", True))
    return assets, r, rf, max_w, rebalance, deflator


def describe_portfolio(assets, r, w, rf, rebalance, deflator):
    port_r, curve = pf.equity_curve(r, w, rebalance)
    metrics, dd = pf.curve_metrics(port_r, curve, rf)
    months = [pf.load_data().index[pf.load_data().index.get_loc(r.index[0]) - 1]] + list(r.index)
    # ориентир: денежная масса М2 и инфляция на том же периоде
    bench = {}
    real_all = pf.real_returns(deflator).loc[r.index]
    for b in ["M2", "MCFTR", "DEPOSIT"]:
        s = real_all[b].fillna(0).values
        bench[b] = [r4(x) for x in np.concatenate([[1.0], np.cumprod(1 + s)])]
    return {
        "weights": {a: r4(x) for a, x in zip(assets, w)},
        "metrics": {k: (r4(v) if isinstance(v, float) else v) for k, v in metrics.items()},
        "curve": {"months": months, "values": [r4(x) for x in curve],
                  "drawdown": [r4(x) for x in dd]},
        "benchmarks": bench,
    }


@app.route("/api/optimize", methods=["POST"])
def api_optimize():
    p = request.get_json(force=True)
    try:
        assets, r, rf, max_w, rebalance, deflator = parse_common(p)
        mu, cov = pf.annual_stats(r)
        criterion = p.get("criterion", "max_sharpe")
        target = p.get("target")
        if criterion in ("target_return", "target_risk") and target in (None, ""):
            raise ValueError("Задайте целевое значение.")
        w, message = pf.optimize(mu, cov, criterion, rf, target, max_w)
        ret, vol = pf.port_stats(w, mu, cov)

        # эффективная граница, облако, отдельные активы, особые точки
        frontier = pf.efficient_frontier(mu, cov, max_w)
        rr, rv = pf.random_portfolios(mu, cov)
        w_mv, _ = pf.optimize(mu, cov, "min_vol", rf, None, max_w)
        w_ms, _ = pf.optimize(mu, cov, "max_sharpe", rf, None, max_w)
        mv = pf.port_stats(w_mv, mu, cov)
        ms = pf.port_stats(w_ms, mu, cov)
        vols = np.sqrt(np.diag(cov))
        corr = r.corr().values

        out = describe_portfolio(assets, r, w, rf, rebalance, deflator)
        out.update({
            "criterion": criterion,
            "criterion_name": pf_criterion_name(criterion),
            "message": message,
            "expected": {"ret": r4(ret), "vol": r4(vol),
                         "sharpe": r4((ret - rf) / vol) if vol > 0 else None},
            "frontier": [{"ret": r4(f["ret"]), "vol": r4(f["vol"]), "w": f["w"]} for f in frontier],
            "cloud": {"ret": [r4(x) for x in rr], "vol": [r4(x) for x in rv]},
            "assets_points": [{"id": a, "ret": r4(m), "vol": r4(v)} for a, m, v in zip(assets, mu, vols)],
            "min_vol_point": {"ret": r4(mv[0]), "vol": r4(mv[1])},
            "max_sharpe_point": {"ret": r4(ms[0]), "vol": r4(ms[1])},
            "rf": rf,
            "period": {"from": r.index[0], "to": r.index[-1], "months": len(r)},
            "asset_stats": asset_table(assets, r, rf),
            "corr": {"assets": assets, "matrix": [[r4(x) for x in row] for row in corr]},
        })
        return jsonify(out)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 400


@app.route("/api/evaluate", methods=["POST"])
def api_evaluate():
    """Расчёт показателей для заданных вручную весов (или сохранённого портфеля)."""
    p = request.get_json(force=True)
    try:
        weights = {k: float(v) for k, v in p.get("weights", {}).items() if float(v) != 0}
        p["assets"] = [a for a in pf.ASSET_IDS if a in weights]
        if len(p["assets"]) == 1:
            p["assets"] = p["assets"] + [a for a in pf.ASSET_IDS if a not in weights][:1]
            weights[p["assets"][1]] = 0.0
        assets, r, rf, max_w, rebalance, deflator = parse_common({**p, "max_weight": 1})
        w = np.array([weights.get(a, 0.0) for a in assets])
        if w.sum() <= 0:
            raise ValueError("Сумма весов должна быть больше нуля.")
        w = w / w.sum()
        mu, cov = pf.annual_stats(r)
        ret, vol = pf.port_stats(w, mu, cov)
        out = describe_portfolio(assets, r, w, rf, rebalance, deflator)
        out.update({"expected": {"ret": r4(ret), "vol": r4(vol),
                                 "sharpe": r4((ret - rf) / vol) if vol > 0 else None},
                    "period": {"from": r.index[0], "to": r.index[-1], "months": len(r)}})
        return jsonify(out)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 400


def pf_criterion_name(c):
    return CRITERIA.get(c, c)


def asset_table(assets, r, rf):
    rows = []
    for a in assets:
        s = r[a].values
        curve = np.concatenate([[1.0], np.cumprod(1 + s)])
        m, _ = pf.curve_metrics(s, curve, rf)
        rows.append({"id": a, **{k: (r4(v) if isinstance(v, float) else v) for k, v in m.items()}})
    return rows


@app.route("/health")
def health():
    return "ok"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
