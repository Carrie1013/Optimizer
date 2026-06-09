const App = {
  state: {
    currentView: 'optimizer',
    settings: {},
    etfData: {},
    etfDataReady: false,
    etfDataCount: 0,
    etfUniverseCount: 0,
    etfDataIsStale: false,
    etfDataSource: 'static',
    etfDataSourceLabel: 'Built-in assumptions',
    etfDataUpdatedAt: null,
    optimizerResults: null,
  },

  toast(msg, type = 'info', duration = 3500) {
    const icons = { info: 'i', success: 'OK', error: 'X' };
    const div = document.createElement('div');
    div.className = `toast toast-${type}`;
    div.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
    document.getElementById('toastContainer').appendChild(div);
    setTimeout(() => div.remove(), duration);
  },

  navigate(view) {
    this.state.currentView = view;
    if (view !== 'optimizer') return;
    OptimizerView.render(document.getElementById('mainContent'), this.state);
  },

  _applyETFData(payload) {
    const tickers = DATA.ETF_UNIVERSE.map(e => e.ticker);
    const data = payload?.data || {};
    const loaded = Object.keys(data).length;

    this.state.etfData = data;
    this.state.etfDataReady = loaded >= Math.floor(tickers.length * 0.5);
    this.state.etfDataCount = loaded;
    this.state.etfUniverseCount = tickers.length;
    this.state.etfDataIsStale = Boolean(payload?.isStale);
    this.state.etfDataSource = payload?.source || 'static';
    this.state.etfDataSourceLabel = payload?.sourceLabel || 'Built-in assumptions';
    this.state.etfDataUpdatedAt = payload?.ts || null;

    return { loaded, total: tickers.length };
  },

  async loadETFData() {
    const tickers = DATA.ETF_UNIVERSE.map(e => e.ticker);
    const statusEl = document.getElementById('loadingStatus');

    try {
      if (statusEl) statusEl.textContent = 'Loading local ETF cache...';
      const payload = await API.loadPreferredData(tickers);

      if (payload?.data && Object.keys(payload.data).length > 0) {
        const { loaded, total } = this._applyETFData(payload);
        if (statusEl) statusEl.textContent = `Loaded ${loaded}/${total} ETFs from cache`;
        this.toast(`Loaded cached ETF dataset (${loaded}/${total})`, 'success');
      } else {
        this.state.etfData = {};
        this.state.etfDataReady = false;
        this.state.etfDataCount = 0;
        this.state.etfUniverseCount = tickers.length;
        this.state.etfDataIsStale = false;
        this.state.etfDataSource = 'static';
        this.state.etfDataSourceLabel = 'Built-in assumptions only';
        this.state.etfDataUpdatedAt = null;
        this.toast('No Yahoo cache found; using built-in assumptions until refresh', 'info');
      }
    } catch (_) {
      this.toast('ETF cache load failed; using built-in assumptions', 'info');
    }
  },

  async refreshETFData(onProgress) {
    const tickers = DATA.ETF_UNIVERSE.map(e => e.ticker);

    try {
      const payload = await API.refreshFromYahoo(tickers, onProgress);
      const refreshed = payload?.refreshed || 0;
      const { loaded, total } = this._applyETFData(payload);
      if (refreshed > 0) {
        this.toast(`Refreshed ${refreshed} ETFs from Yahoo (${loaded}/${total} available locally)`, 'success');
        return true;
      } else {
        this.toast(`Yahoo refresh returned no new history; keeping local dataset (${loaded}/${total})`, 'info');
        return false;
      }
    } catch (_) {
      this.toast('Yahoo refresh failed', 'error');
      return false;
    }
  },

  async init() {
    this.state.settings = Config.load();
    await this.loadETFData();

    const loading = document.getElementById('loadingScreen');
    if (loading) loading.remove();

    this.navigate('optimizer');
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
