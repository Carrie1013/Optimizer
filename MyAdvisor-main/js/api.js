const API = {
  _cache: null,

  _pickTickers(data, tickers) {
    const out = {};
    (tickers || []).forEach(ticker => {
      if (data?.[ticker]) out[ticker] = data[ticker];
    });
    return out;
  },

  _loadEmbeddedData() {
    try {
      const payload = window.LOCAL_ETF_DATA;
      if (!payload?.data || typeof payload.data !== 'object') return null;
      return payload;
    } catch {}
    return null;
  },

  _loadCache() {
    if (this._cache) return this._cache;
    try {
      const raw = localStorage.getItem(Config.ETF_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.data) return null;
      const isStale = Date.now() - (parsed.ts || 0) > Config.ETF_CACHE_TTL;
      const payload = {
        ...parsed,
        isStale,
        sourceLabel: isStale
          ? (parsed.sourceLabel || 'Local Yahoo cache') + ' (stale)'
          : (parsed.sourceLabel || 'Local Yahoo cache'),
      };
      this._cache = payload;
      return payload;
    } catch {}
    return null;
  },

  _saveCache(data, meta = {}) {
    const payload = {
      data,
      ts: Date.now(),
      source: meta.source || 'yahoo-cache',
      sourceLabel: meta.sourceLabel || 'Local Yahoo cache',
    };
    this._cache = payload;
    try {
      localStorage.setItem(Config.ETF_CACHE_KEY, JSON.stringify(payload));
    } catch {}
  },

  async fetchYahooHistory(ticker) {
    const url = Config.YAHOO_CHART_API(ticker);
    for (const proxy of Config.CORS_PROXIES) {
      try {
        const res = await fetch(proxy(url), { signal: AbortSignal.timeout(10000) });
        if (!res.ok) continue;

        const json = await res.json().catch(() => null);
        const result = json?.chart?.result?.[0];
        if (!result) continue;

        const timestamps = result.timestamp || [];
        const closes = result.indicators?.adjclose?.[0]?.adjclose
          || result.indicators?.quote?.[0]?.close
          || [];

        const prices = timestamps
          .map((t, i) => {
            const dt = new Date(t * 1000);
            return {
              date: Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10),
              price: closes[i],
            };
          })
          .filter(row => row.price != null && isFinite(row.price) && row.date);

        if (prices.length >= 6) return prices;
      } catch (_) {}
    }
    return null;
  },

  computeReturns(prices) {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      const p0 = prices[i - 1].price;
      const p1 = prices[i].price;
      if (p0 && p1 && p0 > 0) returns.push((p1 - p0) / p0);
    }
    return returns;
  },

  annualizeStats(returns) {
    const periods = returns.length;
    const mu = returns.reduce((a, b) => a + b, 0) / periods * 12;
    const variance = returns.reduce((a, r) => a + (r - mu / 12) ** 2, 0) / (periods - 1) * 12;
    return { mu, sigma: Math.sqrt(Math.max(variance, 0)) };
  },

  async loadPreferredData(tickers) {
    const embedded = this._loadEmbeddedData();
    const cached = this._loadCache();
    const combined = {
      ...(embedded?.data || {}),
      ...(cached?.data || {}),
    };

    if (Object.keys(combined).length > 0) {
      return {
        source: cached?.data ? (cached?.source || 'local-cache') : (embedded?.source || 'local-file'),
        sourceLabel: cached?.data
          ? (cached?.sourceLabel || 'Local Yahoo cache')
          : (embedded?.sourceLabel || 'Local local-file history'),
        ts: cached?.ts || embedded?.ts || null,
        isStale: Boolean(cached?.isStale),
        data: this._pickTickers(combined, tickers),
      };
    }
    return null;
  },

  async refreshFromYahoo(tickers, onProgress) {
    const seed = (await this.loadPreferredData(tickers))?.data || {};
    const results = { ...seed };
    let refreshed = 0;
    let done = 0;

    await Promise.allSettled(tickers.map(async ticker => {
      const prices = await this.fetchYahooHistory(ticker);
      if (prices) {
        const returns = this.computeReturns(prices);
        if (returns.length >= 6) {
          const { mu, sigma } = this.annualizeStats(returns);
          results[ticker] = { prices, returns, mu, sigma };
          refreshed += 1;
        }
      }

      done += 1;
      onProgress?.({ pct: Math.round(done / tickers.length * 100), msg: `Loaded ${ticker}` });
    }));

    if (refreshed > 0) {
      this._saveCache(results, {
        source: 'yahoo-cache',
        sourceLabel: 'Yahoo refresh + local seed',
      });
    }

    return {
      data: results,
      source: 'yahoo-cache',
      sourceLabel: refreshed > 0 ? 'Yahoo refresh + local seed' : 'Local seed only',
      ts: Date.now(),
      refreshed,
    };
  },
};
