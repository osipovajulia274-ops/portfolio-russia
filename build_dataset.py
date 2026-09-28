"""
Сборка единого набора данных из сырых файлов (папка data/raw).

Результат: data/data.csv — помесячные значения (на конец месяца) всех индикаторов
в НОМИНАЛЬНОМ выражении + индекс потребительских цен (CPI) и ключевая ставка.
Пересчёт в реальные доходности делает само приложение (portfolio.py),
чтобы можно было выбрать дефлятор: ИПЦ или денежную массу М2.

Запуск:  python build_dataset.py
"""
from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(__file__).parent / "data" / "raw"
OUT = Path(__file__).parent / "data" / "data.csv"

START = "2012-12"   # базовый месяц (от него считаются доходности с 2013-01)
END = "2026-08"     # последний месяц, по которому есть инфляция


def month_index(s):
    return pd.PeriodIndex(s, freq="M")


def load(name, **kw):
    df = pd.read_csv(RAW / name, **kw)
    df.index = month_index(df.index)
    return df.sort_index()


def build():
    # --- ЦБ: валюты и металлы (значение на последний торговый день месяца)
    fx = load("cbr_fx_metals.csv", index_col=0)

    # --- ЦБ: денежная масса М2 (значение "на 1-е число месяца" = конец прошлого месяца)
    m2 = load("cbr_m2.csv", index_col=0)["M2_bln_rub"]
    m2.index = m2.index - 1                      # сдвиг: 01.09 -> конец августа

    # --- ЦБ: инфляция м/м с устранённой сезонностью -> индекс цен (CPI)
    cpi_mom = load("cpi_sa_mom.csv", index_col=0)["cpi_sa_mom_pct"] / 100
    cpi = (1 + cpi_mom).cumprod()
    cpi = cpi / cpi.loc[pd.Period(START, "M")]   # CPI = 1 в базовом месяце

    # --- ЦБ: ключевая ставка (% годовых, на конец месяца)
    kr = load("cbr_infl_keyrate.csv", index_col=0)["key_rate_pct"]

    # --- Индексы Московской биржи (TradingView / Investing.com)
    tv = load("tradingview_moex.csv", index_col=0)
    inv = load("investing_bonds.csv", index_col=0)

    idx = pd.period_range(START, END, freq="M")
    df = pd.DataFrame(index=idx)

    # 1. Денежная масса М2
    df["M2"] = m2
    # 2. Акции крупных компаний с дивидендами
    df["MCFTR"] = tv["MCFTR"]

    # 3. Акции малой и средней капитализации с дивидендами (MESMTR, с 2019 г.).
    #    До 2019 г. ряд восстанавливаем: ценовой индекс MCXSM + средняя
    #    месячная дивидендная добавка, оценённая на периоде 2019-2026,
    #    где есть оба индекса.
    smid_tr = tv["MESMTR"]
    smid_px = tv["MCXSM"]
    both = pd.concat([smid_tr, smid_px], axis=1).dropna()
    div_add = (both.iloc[:, 0].pct_change() - both.iloc[:, 1].pct_change()).mean()
    first = smid_tr.first_valid_index()
    r_px = smid_px.pct_change().loc[:first].iloc[1:]           # доходности до 2019
    level = pd.Series(index=smid_px.loc[:first].index, dtype=float)
    level.iloc[-1] = smid_tr.loc[first]
    for i in range(len(level) - 2, -1, -1):                     # идём назад во времени
        level.iloc[i] = level.iloc[i + 1] / (1 + r_px.iloc[i] + div_add)
    df["SMID"] = pd.concat([level.iloc[:-1], smid_tr.loc[first:]])

    # 4. Государственные облигации (ОФЗ), совокупный доход
    df["RGBITR"] = tv["RGBITR"]

    # 5. Корпоративные облигации: RUCBITR (до 12.2020) -> RUCBTRNS (с 12.2020)
    rucbitr = inv["ID1167551"]
    rucbtrns = tv["RUCBTRNS"]
    k = rucbitr.loc[pd.Period("2020-12", "M")] / rucbtrns.loc[pd.Period("2020-12", "M")]
    corp = pd.concat([rucbitr.loc[:"2020-12"], (rucbtrns * k).loc["2021-01":]])
    df["CORP"] = corp

    # 6-8. Золото, юань, доллар (ЦБ)
    df["GOLD"] = fx["GOLD"]
    df["CNY"] = fx["CNY"]
    df["USD"] = fx["USD"]

    # 9. Недвижимость: индекс стоимости жилья в Москве (МосБиржа-ДомКлик), руб/м2
    df["REALTY"] = tv["MREDC"]

    # 10. Денежный рынок / депозит: накапливаем доход по ключевой ставке.
    #     До сентября 2013 г. ключевой ставки не было -> берём 5.5% (ставка
    #     недельного аукциона РЕПО, ставшая ключевой ставкой).
    kr_full = kr.reindex(idx).fillna(5.5)
    dep = (1 + kr_full.shift(1).fillna(5.5) / 100 / 12)
    dep.iloc[0] = 1.0
    df["DEPOSIT"] = 100 * dep.cumprod()

    # Дополнительно: серебро
    df["SILVER"] = fx["SILVER"]

    # Служебные ряды
    df["CPI"] = cpi
    df["KEY_RATE"] = kr_full

    df.index = df.index.astype(str)
    df.index.name = "month"
    df.to_csv(OUT, float_format="%.6g")
    print(f"Сохранено: {OUT}  ({len(df)} мес., {df.index[0]} — {df.index[-1]})")
    print(f"Дивидендная добавка SMID до 2019 г.: {div_add*100:.3f}% в месяц "
          f"(≈{((1+div_add)**12-1)*100:.1f}% годовых)")
    print(df.notna().sum())
    return df


if __name__ == "__main__":
    build()
