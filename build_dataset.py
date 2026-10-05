"""
Сборка таблицы данных data/data.csv из сырых выгрузок (папка data/raw).

В таблице — значения 10 индикаторов на конец каждого месяца (в рублях, как есть)
и индекс потребительских цен CPI. В реальные доходности их пересчитывает portfolio.py.

Откуда что берётся:
  - индексы Московской биржи — файлы MCFTR.csv, MESMTR.csv, RGBITR.csv, RUCBITR.csv, RUCBTRNS.csv, MREDC.csv,
    скачанные с сайта биржи (месячные «свечи», нужна цена закрытия месяца);
  - инфляция — файл Росстата ipc_mes_*.xlsx (индекс цен «к концу предыдущего месяца»);
  - денежная масса, курсы валют и цены металлов — файлы Банка России cbr_*.csv.

Запуск:  python build_dataset.py
"""
from pathlib import Path

import pandas as pd

import reader

RAW = Path(__file__).parent / "data" / "raw"
OUT = Path(__file__).parent / "data" / "data.csv"

START, END = "2012-12", "2026-08"


def load(name):
    df = pd.read_csv(RAW / name, index_col=0)
    df.index = pd.PeriodIndex(df.index, freq="M")
    return df.sort_index()


def moex_index(code):
    """Индекс Московской биржи из файла, скачанного с её сайта: значение на конец каждого месяца.
    Файл разбирает reader.py — тот же код, что читает файлы, загруженные через сайт."""
    grid = reader.read_grids(f"{code}.csv", (RAW / f"{code}.csv").read_bytes())[0][1]
    frame, _ = reader.extract(grid, code)
    series = frame.iloc[:, 0].groupby(frame.index.to_period("M")).last()
    return series.sort_index()


def build_cpi():
    """Индекс потребительских цен Росстата, база 12.2012 = 1.
    В файле Росстата записано, во сколько раз выросли цены за месяц (100,40 значит +0,40%).
    Перемножая эти числа, получаем уровень цен."""
    path = sorted(RAW.glob("ipc_mes*.xlsx"))[-1]                     # самый свежий файл
    for _, grid, _ in reader.read_grids(path.name, path.read_bytes()):
        frame, info = reader.extract(grid, "CPI")
        if frame is not None and "месяцы" in info["layout"]:         # первый лист с сеткой «месяцы × годы» — все товары и услуги
            break
    monthly = frame.iloc[:, 0] / 100
    monthly.index = monthly.index.to_period("M")
    return monthly.loc[monthly.index > START].cumprod().reindex(pd.period_range(START, END, freq="M")).fillna(1.0)


def build():
    cbr = load("cbr_fx_metals.csv")          # ЦБ: курсы валют и цены металлов

    # М2 публикуется "на 1-е число месяца" = значение на конец предыдущего месяца
    m2 = load("cbr_m2.csv")["M2_bln_rub"]
    m2.index = m2.index - 1

    # Акции крупных компаний: биржа отдаёт месячные значения с 11.2016, более ранние взяты с TradingView
    mcftr = moex_index("MCFTR").combine_first(load("tradingview_moex.csv")["MCFTR"])

    # Корпоративные облигации: в 2021 г. биржа заменила индекс RUCBITR на RUCBTRNS.
    # Сцепляем ряды в декабре 2020 г. (уровень нового приводим к уровню старого).
    old, new = moex_index("RUCBITR"), moex_index("RUCBTRNS")
    k = old.loc["2020-12"] / new.loc["2020-12"]
    corp = pd.concat([old.loc[:"2020-12"], (new * k).loc["2021-01":]])

    df = pd.DataFrame(index=pd.period_range(START, END, freq="M"))
    df["M2"] = m2                          # 1. денежная масса М2
    df["MCFTR"] = mcftr                    # 2. акции крупных компаний, с дивидендами
    df["MESMTR"] = moex_index("MESMTR")    # 3. акции малых и средних компаний, с дивидендами (с 12.2013)
    df["RGBITR"] = moex_index("RGBITR")    # 4. гособлигации ОФЗ
    df["CORP"] = corp                      # 5. корпоративные облигации
    df["GOLD"] = cbr["GOLD"]               # 6. золото
    df["SILVER"] = cbr["SILVER"]           # 7. серебро
    df["CNY"] = cbr["CNY"]                 # 8. юань
    df["USD"] = cbr["USD"]                 # 9. доллар
    df["REALTY"] = moex_index("MREDC")     # 10. недвижимость Москвы (с 12.2016)
    df["CPI"] = build_cpi()                # индекс потребительских цен

    df.index = df.index.astype(str)
    df.index.name = "month"
    df.to_csv(OUT, float_format="%.6g")
    print(f"Сохранено {OUT}: {len(df)} месяцев")
    print(df.notna().sum())


if __name__ == "__main__":
    build()
