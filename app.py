"""
Веб-калькулятор портфеля. Запуск: python app.py  ->  http://127.0.0.1:5000
На Render: gunicorn app:app
"""
import os

import numpy as np
from flask import Flask, jsonify, render_template, request

import portfolio as pf

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/meta")
def meta():
    """Список индикаторов и месяцев — для построения страницы."""
    df = pf.load_data()
    first = {a: df[a].dropna().index[0] for a in pf.IDS}
    return jsonify({"assets": pf.ASSETS, "first_month": first, "months": list(df.index[1:])})


@app.route("/api/optimize", methods=["POST"])
def optimize():
    p = request.get_json(force=True)
    try:
        assets = [a for a in pf.IDS if a in p.get("assets", [])]
        if len(assets) < 2:
            raise ValueError("Выберите хотя бы два индикатора.")
        returns = pf.real_returns(assets, p.get("start"), p.get("end"))
        if len(returns) < 24:
            raise ValueError("Слишком короткий период: нужно не меньше 24 месяцев.")
        criterion = p.get("criterion", "min_vol")
        rf = float(p.get("rf", 0.05))
        target = p.get("target")
        if criterion in ("target_return", "target_risk") and target is None:
            raise ValueError("Задайте целевое значение.")

        mu, cov = pf.annual_stats(returns)
        w, note = pf.optimize(mu, cov, criterion, rf, target)
        curve, metrics = pf.curve_and_metrics(returns, w)
        risk = pf.portfolio_risk(w, cov)

        months = pf.load_data().index
        start_label = months[months.get_loc(returns.index[0]) - 1]   # месяц, когда «вложили рубль»
        return jsonify({
            "weights": dict(zip(assets, np.round(w, 4).tolist())),
            "metrics": metrics,
            "sharpe": (metrics["mean_return"] - rf) / risk if risk > 0 else None,
            "note": note,
            "period": [returns.index[0], returns.index[-1], len(returns)],
            "curve": {"months": [start_label] + list(returns.index), "values": np.round(curve, 4).tolist()},
            "frontier": pf.efficient_frontier(mu, cov),
            "assets": [{"id": a, "risk": float(np.sqrt(cov[i, i])), "ret": float(mu[i])}
                       for i, a in enumerate(assets)],
        })
    except Exception as e:  # noqa: BLE001 — показываем пользователю понятное сообщение
        return jsonify({"error": str(e)}), 400


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
