const Config = {
  DEFAULTS: {
    riskFreeRate: 3.25,
  },

  CORS_PROXIES: [
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://thingproxy.freeboard.io/fetch/${url}`,
  ],

  YAHOO_CHART_API: ticker =>
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=max&interval=1mo`,

  ETF_CACHE_KEY: 'wealthiq_etf_cache',
  ETF_CACHE_TTL: 6 * 60 * 60 * 1000,
  SETTINGS_KEY: 'wealthiq_settings',

  load() {
    try {
      const stored = localStorage.getItem(this.SETTINGS_KEY);
      return stored ? { ...this.DEFAULTS, ...JSON.parse(stored) } : { ...this.DEFAULTS };
    } catch {
      return { ...this.DEFAULTS };
    }
  },

  save(settings) {
    try {
      localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  },
};
