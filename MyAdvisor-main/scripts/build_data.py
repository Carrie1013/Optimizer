import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_JS = ROOT / "js" / "data.js"
OUT_JS = ROOT / "data" / "local_etf_data.js"
OUT_JSON = ROOT / "data" / "local_etf_data.json"


def load_tickers():
    text = DATA_JS.read_text(encoding="utf-8")
    tickers = re.findall(r"\{\s*ticker:'([^']+)'", text)
    seen = set()
    ordered = []
    for ticker in tickers:
        if ticker not in seen:
            seen.add(ticker)
            ordered.append(ticker)
    return ordered


def yahoo_url(ticker: str) -> str:
    base = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
    params = urllib.parse.urlencode({"range": "max", "interval": "1mo"})
    return f"{base}?{params}"


def fetch_json(url: str):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json,text/plain,*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_history(ticker: str):
    payload = fetch_json(yahoo_url(ticker))
    result = (((payload or {}).get("chart") or {}).get("result") or [None])[0]
    if not result:
        return None

    timestamps = result.get("timestamp") or []
    indicators = result.get("indicators") or {}
    adjclose = (((indicators.get("adjclose") or [None])[0]) or {}).get("adjclose") or []
    close = (((indicators.get("quote") or [None])[0]) or {}).get("close") or []
    closes = adjclose or close

    prices = []
    for idx, ts in enumerate(timestamps):
        if idx >= len(closes):
            continue
        px = closes[idx]
        if px is None:
            continue
        if not isinstance(px, (int, float)) or not math.isfinite(px):
            continue
        dt = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        prices.append({"date": dt, "price": px})

    return prices if len(prices) >= 6 else None


def compute_returns(prices):
    returns = []
    for i in range(1, len(prices)):
        p0 = prices[i - 1]["price"]
        p1 = prices[i]["price"]
        if p0 and p1 and p0 > 0:
            returns.append((p1 - p0) / p0)
    return returns


def annualize_stats(returns):
    periods = len(returns)
    if periods < 2:
        return None
    mu = sum(returns) / periods * 12
    variance = sum((r - mu / 12) ** 2 for r in returns) / (periods - 1) * 12
    return {"mu": mu, "sigma": math.sqrt(max(variance, 0.0))}


def build_dataset(tickers):
    data = {}
    failures = []
    for idx, ticker in enumerate(tickers, start=1):
        try:
            prices = fetch_history(ticker)
            if not prices:
                failures.append(ticker)
                print(f"[{idx}/{len(tickers)}] {ticker}: no usable history")
                continue
            returns = compute_returns(prices)
            stats = annualize_stats(returns)
            if not stats:
                failures.append(ticker)
                print(f"[{idx}/{len(tickers)}] {ticker}: insufficient return series")
                continue
            data[ticker] = {
                "prices": prices,
                "returns": returns,
                "mu": stats["mu"],
                "sigma": stats["sigma"],
            }
            print(f"[{idx}/{len(tickers)}] {ticker}: ok ({len(prices)} prices)")
        except urllib.error.HTTPError as exc:
            failures.append(ticker)
            print(f"[{idx}/{len(tickers)}] {ticker}: HTTP {exc.code}")
        except Exception as exc:
            failures.append(ticker)
            print(f"[{idx}/{len(tickers)}] {ticker}: {exc}")
        time.sleep(0.15)
    return data, failures


def write_outputs(data):
    payload = {
        "data": data,
        "ts": int(time.time() * 1000),
        "source": "local-file",
        "sourceLabel": "Local ETF history file",
    }
    OUT_JSON.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    OUT_JS.write_text(
        "window.LOCAL_ETF_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )


def main():
    tickers = load_tickers()
    print(f"Building local ETF history for {len(tickers)} tickers")
    data, failures = build_dataset(tickers)
    write_outputs(data)
    print(f"Saved {len(data)}/{len(tickers)} tickers to {OUT_JSON.relative_to(ROOT)} and {OUT_JS.relative_to(ROOT)}")
    if failures:
      print("Failed tickers:", ", ".join(failures))
    return 0 if data else 1


if __name__ == "__main__":
    sys.exit(main())
