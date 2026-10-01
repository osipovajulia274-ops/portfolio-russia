"""
Сборка таблицы данных data/data.csv из сырых выгрузок (папка data/raw).

В таблице — значения 10 индикаторов на конец каждого месяца (в рублях, как есть)
и индекс потребительских цен CPI. В реальные доходности их пересчитывает portfolio.py.

Запуск:  python build_dataset.py
"""
from pathlib import Path

import pandas as pd

RAW = Path(__file__).parent / "data" / "raw"
OUT = Path(__file__).parent / "data" / "data.csv"

START, END = "2012-12", "2026-08"


def load(name):
    df = pd.read_csv(RAW / name, index_col=0)
    df.index = pd.PeriodIndex(df.index, freq="M")
    return df.sort_index()


def build():
    cbr = load("cbr_fx_metals.csv")          # ЦБ: курсы валют и цены металлов
    moex = load("tradingview_moex.csv")      # индексы Московской биржи
    bonds = load("investing_bonds.csv")      # старый индекс корпоративных облигаций RUCBITR

    # М2 публикуется "на 1-е число месяца" = значение на конец предыдущего месяца
    m2 = load("cbr_m2.csv")["M2_bln_rub"]
    m2.index = m2.index - 1

    # Индекс цен: перемножаем месячные приросты цен (ЦБ), база 12.2012 = 1
    cpi = (1 + load("cpi_sa_mom.csv")["cpi_sa_mom_pct"] / 100).cumprod()
    cpi = cpi / cpi.loc[START]

    # Корпоративные облигации: в 2021 г. биржа заменила индекс RUCBITR на RUCBTRNS.
    # Сцепляем ряды в декабре 2020 г. (уровень нового приводим к уровню старого).
    old, new = bonds["ID1167551"], moex["RUCBTRNS"]
    k = old.loc["2020-12"] / new.loc["2020-12"]
    corp = pd.concat([old.loc[:"2020-12"], (new * k).loc["2021-01":]])

    df = pd.DataFrame(index=pd.period_range(START, END, freq="M"))
    df["M2"] = m2                    # 1. денежная масса М2
    df["MCFTR"] = moex["MCFTR"]      # 2. акции крупных компаний, с дивидендами
    df["MESMTR"] = moex["MESMTR"]    # 3. акции малых и средних компаний, с дивидендами (с 2019 г.)
    df["RGBITR"] = moex["RGBITR"]    # 4. гособлигации ОФЗ
    df["CORP"] = corp                # 5. корпоративные облигации
    df["GOLD"] = cbr["GOLD"]         # 6. золото
    df["SILVER"] = cbr["SILVER"]     # 7. серебро
    df["CNY"] = cbr["CNY"]           # 8. юань
    df["USD"] = cbr["USD"]           # 9. доллар
    df["REALTY"] = moex["MREDC"]     # 10. недвижимость Москвы (с 12.2016)
    df["CPI"] = cpi                  # индекс потребительских цен

    df.index = df.index.astype(str)
    df.index.name = "month"
    df.to_csv(OUT, float_format="%.6g")
    print(f"Сохранено {OUT}: {len(df)} месяцев")
    print(df.notna().sum())


if __name__ == "__main__":
    build()
