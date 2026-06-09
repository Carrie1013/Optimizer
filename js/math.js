/* =========================================================
   math.js — Markowitz Mean-Variance Optimization + Michaud
             Resampled Efficient Frontier (REF)

   Ported and extended from portfolio_optimizer.jsx
   Reference: Markowitz (1952), Michaud (1998)
   ========================================================= */

const MathUtils = {

  // ── Basic linear algebra ───────────────────────────────

  matMul(A, B) {
    const m = A.length, n = B[0].length, k = B.length;
    const C = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let i = 0; i < m; i++)
      for (let j = 0; j < n; j++)
        for (let l = 0; l < k; l++)
          C[i][j] += A[i][l] * B[l][j];
    return C;
  },

  transpose(A) {
    return A[0].map((_, j) => A.map(row => row[j]));
  },

  dotVec(a, b) {
    return a.reduce((s, v, i) => s + v * b[i], 0);
  },

  // ── Project vector onto bounded simplex ───────────────
  // Solve min ||w - v||^2 s.t. sum(w)=target, lb<=w<=ub
  projectBoundedSimplex(v, lb = 0, ub = 1, target = 1) {
    const n = v.length;
    if (n === 0) return [];
    const loSum = n * lb;
    const hiSum = n * ub;
    if (target <= loSum) return new Array(n).fill(lb);
    if (target >= hiSum) return new Array(n).fill(ub);

    let left = Math.min(...v) - ub;
    let right = Math.max(...v) - lb;

    for (let iter = 0; iter < 80; iter++) {
      const mid = (left + right) / 2;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const wi = Math.min(ub, Math.max(lb, v[i] - mid));
        sum += wi;
      }
      if (sum > target) left = mid;
      else right = mid;
    }

    const theta = (left + right) / 2;
    const w = v.map(x => Math.min(ub, Math.max(lb, x - theta)));
    const s = w.reduce((a, b) => a + b, 0) || 1;
    return w.map(x => x * target / s);
  },

  // ── Portfolio statistics ───────────────────────────────

  portfolioStats(weights, mu, cov) {
    const ret = this.dotVec(weights, mu);
    let variance = 0;
    for (let i = 0; i < weights.length; i++)
      for (let j = 0; j < weights.length; j++)
        variance += weights[i] * weights[j] * cov[i][j];
    return { ret, vol: Math.sqrt(Math.max(variance, 0)) };
  },

  // ── Covariance matrix from correlation matrix + sigmas ─

  buildCovMatrix(assets, corrMatrix) {
    const n = assets.length;
    const cov = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        cov[i][j] = corrMatrix[i][j] * assets[i].sigma * assets[j].sigma;
    return cov;
  },

  // ── Covariance matrix from returns data ────────────────
  // returns: array of arrays — returns[ticker][t] = monthly return at time t
  computeCovFromReturns(returnsList) {
    const n = returnsList.length;
    const T = Math.min(...returnsList.map(r => r.length));
    if (T < 6) return null;

    const trimmed = returnsList.map(r => r.slice(-T));
    const means   = trimmed.map(r => r.reduce((a, b) => a + b, 0) / T);

    const cov = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let t = 0; t < T; t++)
          sum += (trimmed[i][t] - means[i]) * (trimmed[j][t] - means[j]);
        cov[i][j] = (sum / (T - 1)) * 12; // annualize
    }
    return { cov, means: means.map(m => m * 12), T }; // annualized
  },

  // Ledoit-Wolf style shrinkage toward scaled identity.
  // Input returns are expected in monthly decimal form and aligned by time.
  estimateShrunkMoments(returnsList, expenseRatios = null) {
    const sample = this.computeCovFromReturns(returnsList);
    if (!sample) return null;

    const { cov: sampleCov, means, T } = sample;
    const n = sampleCov.length;
    const avgVar = sampleCov.reduce((sum, row, i) => sum + row[i], 0) / n;
    const target = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? avgVar : 0))
    );

    let delta2 = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const diff = sampleCov[i][j] - target[i][j];
        delta2 += diff * diff;
      }
    }

    let beta2 = 0;
    for (let t = 0; t < T; t++) {
      const rt = returnsList.map(series => series[series.length - T + t]);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const outer = (rt[i] - means[i] / 12) * (rt[j] - means[j] / 12) * 12;
          const diff = outer - sampleCov[i][j];
          beta2 += diff * diff;
        }
      }
    }
    beta2 /= (T * T);

    const alpha = delta2 > 1e-16 ? Math.max(0, Math.min(1, beta2 / delta2)) : 0;
    const cov = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) =>
        (1 - alpha) * sampleCov[i][j] + alpha * target[i][j]
      )
    );

    const adjustedMeans = means.map((mu, i) => mu - (expenseRatios?.[i] || 0));
    return {
      cov: this.stabilizeCov(cov, 1e-8),
      means: adjustedMeans,
      sampleCov,
      alpha,
      T,
    };
  },

  // ── Project vector onto probability simplex (wi >= lb, sum = 1) ──
  projectSimplex(v, lb = 0) {
    const n = v.length;
    const u = v.map(x => x - lb).sort((a, b) => b - a);
    let rho = 0, cumSum = 0;
    for (let j = 0; j < n; j++) {
      cumSum += u[j];
      if (u[j] - (cumSum - 1) / (j + 1) > 0) rho = j;
    }
    const theta = (u.slice(0, rho + 1).reduce((a, b) => a + b, 0) - 1) / (rho + 1);
    return v.map(x => Math.max(x - lb - theta, 0) + lb);
  },

  // ── Constrained portfolio optimizer (gradient projection) ─────────
  // Minimizes w'Σw s.t. w'μ ≈ targetRet, Σwi = 1, lb ≤ wi ≤ ub
  optimizePortfolio(mu, cov, targetRet, { lb = 0, ub = 1.0, maxIter = 1200, lr = 0.01, lambda = 120 } = {}) {
    const n = mu.length;
    let w = new Array(n).fill(1 / n);

    for (let iter = 0; iter < maxIter; iter++) {
      // Gradient of portfolio variance: 2Σw
      const grad = new Array(n).fill(0);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          grad[i] += 2 * cov[i][j] * w[j];

      // Penalty: return constraint
      const curRet = this.dotVec(w, mu);
      for (let i = 0; i < n; i++)
        grad[i] += 2 * lambda * (curRet - targetRet) * mu[i];

      // Gradient step
      let wNew = w.map((wi, i) => wi - lr * grad[i]);

      // Project onto [lb, ub] with sum(w)=1
      wNew = this.projectBoundedSimplex(wNew, lb, ub, 1);

      w = wNew;
    }
    return w;
  },

  // ── Minimum variance portfolio ─────────────────────────
  minVariancePortfolio(mu, cov, { lb = 0, ub = 1.0 } = {}) {
    const n = mu.length;
    let w = new Array(n).fill(1 / n);
    const lambda = 200, lr = 0.005;

    for (let iter = 0; iter < 2200; iter++) {
      const grad = new Array(n).fill(0);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          grad[i] += 2 * cov[i][j] * w[j];

      const curSum = w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < n; i++)
        grad[i] += 2 * lambda * (curSum - 1);

      w = this.projectBoundedSimplex(w.map((wi, i) => wi - lr * grad[i]), lb, ub, 1);
    }
    return w;
  },

  // ── Feasible return bounds under box constraints ──────
  feasibleReturnBounds(mu, { lb = 0, ub = 1.0 } = {}) {
    const n = mu.length;
    const base = new Array(n).fill(lb);
    const spare = 1 - n * lb;
    if (spare < -1e-10) {
      return { minRet: Math.min(...mu), maxRet: Math.max(...mu) };
    }

    const cap = Math.max(0, ub - lb);
    const allocExtremum = order => {
      const w = [...base];
      let rem = spare;
      for (const i of order) {
        if (rem <= 1e-12) break;
        const add = Math.min(cap, rem);
        w[i] += add;
        rem -= add;
      }
      const s = w.reduce((a, b) => a + b, 0) || 1;
      return this.dotVec(w.map(x => x / s), mu);
    };

    const desc = [...mu.keys()].sort((a, b) => mu[b] - mu[a]);
    const asc  = [...mu.keys()].sort((a, b) => mu[a] - mu[b]);
    return { minRet: allocExtremum(asc), maxRet: allocExtremum(desc) };
  },

  // ── Keep upper envelope by risk (non-dominated set) ───
  upperEnvelope(points) {
    const sorted = [...points].sort((a, b) => a.vol - b.vol);
    const keep = [];
    let bestRet = -Infinity;
    for (const p of sorted) {
      if (!isFinite(p.vol) || !isFinite(p.ret)) continue;
      if (p.ret > bestRet + 1e-6) {
        keep.push(p);
        bestRet = p.ret;
      }
    }
    return keep;
  },

  // ── Resample any frontier to fixed rank count ─────────
  sampleFrontierByRank(frontier, nPoints = 25) {
    const clean = this.upperEnvelope(frontier);
    if (clean.length === 0) return [];
    if (clean.length === 1) return Array.from({ length: nPoints }, () => ({ ...clean[0] }));

    const out = [];
    for (let k = 0; k < nPoints; k++) {
      const pos = (k * (clean.length - 1)) / (nPoints - 1);
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, clean.length - 1);
      const t = pos - i0;
      const p0 = clean[i0], p1 = clean[i1];
      const w0 = p0.weights || [], w1 = p1.weights || [];
      const dim = Math.max(w0.length, w1.length);
      const weights = Array.from({ length: dim }, (_, i) =>
        (w0[i] ?? 0) * (1 - t) + (w1[i] ?? 0) * t
      );
      out.push({
        vol: p0.vol * (1 - t) + p1.vol * t,
        ret: p0.ret * (1 - t) + p1.ret * t,
        weights,
      });
    }
    return out;
  },

  // ── Efficient frontier (classical Markowitz) ───────────
  generateEfficientFrontier(mu, cov, { lb = 0, ub = 1.0, nPoints = 30, rfRate = 0.0525 } = {}) {
    const minW = this.minVariancePortfolio(mu, cov, { lb, ub });
    const { ret: minVarRet } = this.portfolioStats(minW, mu, cov);
    const { maxRet } = this.feasibleReturnBounds(mu, { lb, ub });
    const lo = minVarRet;
    const hi = Math.max(minVarRet + 1e-5, maxRet);

    const targets = Array.from({ length: nPoints }, (_, i) => lo + (hi - lo) * i / (nPoints - 1));

    const raw = targets.map(targetRet => {
      const w = this.optimizePortfolio(mu, cov, targetRet, { lb, ub });
      const { ret, vol } = this.portfolioStats(w, mu, cov);
      return {
        ret:    ret * 100,
        vol:    vol * 100,
        weights: w,
        sharpe: vol > 1e-6 ? (ret - rfRate) / vol : 0,
      };
    }).filter(p => isFinite(p.vol) && isFinite(p.ret) && p.vol > 0);

    return this.upperEnvelope(raw);
  },

  // ── Cholesky decomposition ────────────────────────────
  cholesky(A) {
    const n = A.length;
    const L = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = A[i][j];
        for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
        if (!isFinite(sum)) return null;
        if (i === j) {
          if (sum <= 1e-14) return null;
          L[i][j] = Math.sqrt(sum);
        } else {
          if (!isFinite(L[j][j]) || Math.abs(L[j][j]) < 1e-14) return null;
          L[i][j] = sum / L[j][j];
        }
      }
    }
    return L;
  },

  stabilizeCov(cov, jitter = 1e-8) {
    const n = cov.length;
    const out = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cij = cov[i]?.[j] ?? 0;
        const cji = cov[j]?.[i] ?? 0;
        const v = (cij + cji) / 2;
        out[i][j] = isFinite(v) ? v : 0;
      }
      out[i][i] = Math.max(out[i][i], jitter);
    }
    return out;
  },

  // ── Sample from multivariate normal N(mu, cov) ─────────
  sampleMVN(mu, cov, T = 120) {
    const n = mu.length;
    let workCov = this.stabilizeCov(cov, 1e-10);
    let L = null;
    for (let k = 0; k < 8; k++) {
      L = this.cholesky(workCov);
      if (L) break;
      const bump = 1e-8 * Math.pow(10, k);
      workCov = this.stabilizeCov(workCov, bump);
      for (let i = 0; i < n; i++) workCov[i][i] += bump;
    }

    if (!L) {
      L = Array.from({ length: n }, (_, i) => {
        const row = new Array(n).fill(0);
        row[i] = Math.sqrt(Math.max(workCov[i][i], 1e-8));
        return row;
      });
    }
    const samples = [];

    for (let t = 0; t < T; t++) {
      // Box-Muller for standard normal
      const z = Array.from({ length: n }, () => {
        let u = 0;
        for (let k = 0; k < 12; k++) u += Math.random();
        return u - 6;
      });
      const r = mu.map((m, i) => {
        const v = m + this.dotVec(L[i], z);
        return isFinite(v) ? v : m;
      });
      samples.push(r);
    }

    const sampleMu = new Array(n).fill(0);
    samples.forEach(r => r.forEach((v, i) => (sampleMu[i] += v / T)));

    const sampleCov = Array.from({ length: n }, () => new Array(n).fill(0));
    samples.forEach(r => {
      const dev = r.map((v, i) => v - sampleMu[i]);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          sampleCov[i][j] += (dev[i] * dev[j]) / (T - 1);
    });

    return { sampleMu, sampleCov };
  },

  // ── Michaud Resampled Efficient Frontier ───────────────
  // nSims: number of Monte-Carlo simulations
  // nPoints: number of frontier points
  // onProgress(pct): optional callback for progress updates
  async generateREF(mu, cov, { lb = 0, ub = 1.0, nSims = 100, nPoints = 25, simNPoints = 16, rfRate = 0.0525, onProgress, sampleLength = 120 } = {}) {
    const n = mu.length;
    const allWeightsByRank = Array.from({ length: nPoints }, () => Array.from({ length: n }, () => []));
    const simulatedFrontiers = [];
    const rankedFrontiers = [];

    const chunkSize = 10;
    for (let start = 0; start < nSims; start += chunkSize) {
      await new Promise(r => setTimeout(r, 0)); // yield to UI

      for (let s = start; s < Math.min(start + chunkSize, nSims); s++) {
        try {
          const { sampleMu, sampleCov } = this.sampleMVN(mu, cov, sampleLength);
          const frontier = this.generateEfficientFrontier(sampleMu, sampleCov, { lb, ub, nPoints: simNPoints, rfRate });
          if (frontier.length < 2) continue;

          simulatedFrontiers.push(frontier);
          const ranked = this.sampleFrontierByRank(frontier, nPoints);
          rankedFrontiers.push(ranked);

          ranked.forEach((pt, idx) => {
            if (!pt?.weights) return;
            pt.weights.forEach((w, i) => allWeightsByRank[idx][i].push(w));
          });
        } catch (_) { /* ignore singular cov */ }
      }

      onProgress?.(Math.min(100, Math.round((start + chunkSize) / nSims * 100)));
    }

    const resampledFrontier = allWeightsByRank.map(rankWeights => {
      const avgW = rankWeights.map(ws =>
        ws.length > 0 ? ws.reduce((a, b) => a + b, 0) / ws.length : 1 / n
      );
      const s = avgW.reduce((a, b) => a + b, 0) || 1;
      const normW = avgW.map(v => v / s);
      const { ret, vol } = this.portfolioStats(normW, mu, cov);
      return {
        ret:    ret * 100,
        vol:    vol * 100,
        weights: normW,
        sharpe: vol > 1e-6 ? (ret - rfRate) / vol : 0,
      };
    }).filter(p => isFinite(p.vol) && isFinite(p.ret) && p.vol > 0);

    const rankedCloud = [];
    for (let k = 0; k < nPoints; k++) {
      const bucket = [];
      for (const rf of rankedFrontiers) {
        if (rf[k]) bucket.push({ vol: rf[k].vol, ret: rf[k].ret });
      }
      rankedCloud.push(bucket);
    }

    return {
      simulatedFrontiers,
      rankedFrontiers,
      rankedCloud,
      resampledFrontier: this.upperEnvelope(resampledFrontier),
    };
  },

  // ── Max Sharpe portfolio from a frontier array ─────────
  maxSharpePt(frontier, rfRate = 0.0525) {
    return frontier.reduce((best, p) => {
      const s = (p.ret / 100 - rfRate) / (p.vol / 100);
      const bs = (best.ret / 100 - rfRate) / (best.vol / 100);
      return s > bs ? p : best;
    });
  },

  // ── Capital Market Line points (risk-free → max-Sharpe → beyond) ──
  capitalMarketLine(rfRate, maxSharpePt, nPoints = 2) {
    const rfVol = 0;
    const rfRet = rfRate * 100;
    const sVol  = maxSharpePt.vol;
    const sRet  = maxSharpePt.ret;
    const slope = (sRet - rfRet) / (sVol - rfVol);
    return Array.from({ length: nPoints }, (_, i) => {
      const vol = sVol * i / (nPoints - 1) * 1.5;
      return { x: vol, y: rfRet + slope * vol };
    });
  },
};
