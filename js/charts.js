/* =========================================================
   charts.js — Chart.js helpers
   ========================================================= */

const CHART_COLORS = {
  blue:   '#3B82F6', blueAlpha: 'rgba(59,130,246,0.15)',
  purple: '#7C3AED', purpleAlpha: 'rgba(124,58,237,0.15)',
  cyan:   '#0EA5E9', cyanAlpha: 'rgba(14,165,233,0.15)',
  teal:   '#14B8A6', tealAlpha: 'rgba(20,184,166,0.15)',
  green:  '#10B981', greenAlpha: 'rgba(16,185,129,0.15)',
  yellow: '#F59E0B', yellowAlpha: 'rgba(245,158,11,0.15)',
  red:    '#EF4444', redAlpha: 'rgba(239,68,68,0.15)',
  pink:   '#EC4899',
  indigo: '#6366F1',
  grid:   '#1E2D45',
  axis:   '#243550',
  text:   '#94A3B8',
  textMuted: '#475569',
};

// Palette for multi-series charts
const PALETTE = [
  '#3B82F6','#7C3AED','#10B981','#F59E0B','#EF4444',
  '#0EA5E9','#EC4899','#6366F1','#14B8A6','#A78BFA',
  '#34D399','#FCD34D','#F87171','#60A5FA','#C084FC',
  '#2DD4BF',
];

// Shared Chart.js defaults
Chart.defaults.color          = CHART_COLORS.text;
Chart.defaults.borderColor    = CHART_COLORS.grid;
Chart.defaults.font.family    = 'Inter, sans-serif';
Chart.defaults.font.size      = 11;

function chartBaseOptions(title = '') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend:  { display: false },
      tooltip: {
        backgroundColor: '#0F1829',
        borderColor:     CHART_COLORS.grid,
        borderWidth:     1,
        titleColor:      '#F1F5F9',
        bodyColor:       '#94A3B8',
        padding:         10,
      },
      title: title ? {
        display: true,
        text: title,
        color: '#94A3B8',
        font: { size: 12, weight: '500' },
        padding: { bottom: 8 },
      } : { display: false },
    },
    scales: {
      x: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.text } },
      y: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.text } },
    },
    animation: { duration: 500 },
  };
}

// ── Donut / Pie chart ─────────────────────────────────
function createDonutChart(ctx, labels, values, colors) {
  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors || PALETTE, borderWidth: 2, borderColor: '#0F1829', hoverOffset: 4 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: {
          display: true,
          position: 'right',
          labels: { color: CHART_COLORS.text, boxWidth: 10, padding: 10, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${(ctx.parsed * 100).toFixed(1)}%`,
          },
          backgroundColor: '#0F1829',
          borderColor: CHART_COLORS.grid,
          borderWidth: 1,
        },
      },
      animation: { duration: 600 },
    },
  });
}

// ── Horizontal bar chart ──────────────────────────────
function createHBarChart(ctx, labels, values, colors) {
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors || values.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 4 }],
    },
    options: {
      ...chartBaseOptions(),
      indexAxis: 'y',
      plugins: {
        ...chartBaseOptions().plugins,
        tooltip: {
          ...chartBaseOptions().plugins.tooltip,
          callbacks: { label: ctx => ` ${(ctx.parsed.x * 100).toFixed(1)}%` },
        },
      },
      scales: {
        x: { ...chartBaseOptions().scales.x, ticks: { callback: v => (v * 100).toFixed(0) + '%', color: CHART_COLORS.text } },
        y: { grid: { display: false }, ticks: { color: CHART_COLORS.text, autoSkip: false } },
      },
    },
  });
}

// ── Vertical bar chart ────────────────────────────────
function createBarChart(ctx, labels, values, colors, yFmt = v => (v * 100).toFixed(1) + '%') {
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors || values.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 4 }],
    },
    options: {
      ...chartBaseOptions(),
      plugins: {
        ...chartBaseOptions().plugins,
        tooltip: { ...chartBaseOptions().plugins.tooltip, callbacks: { label: ctx => ` ${yFmt(ctx.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: CHART_COLORS.text, maxRotation: 30 } },
        y: { ...chartBaseOptions().scales.y, ticks: { callback: yFmt, color: CHART_COLORS.text } },
      },
    },
  });
}

// ── Line chart (performance) ──────────────────────────
function createLineChart(ctx, labels, datasets) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        label:       d.label,
        data:        d.data,
        borderColor: d.color || PALETTE[i],
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 3,
        tension:     0.3,
        borderDash:  d.dash || [],
      })),
    },
    options: {
      ...chartBaseOptions(),
      plugins: {
        ...chartBaseOptions().plugins,
        legend: { display: true, position: 'top', labels: { color: CHART_COLORS.text, boxWidth: 20, padding: 12 } },
        tooltip: {
          ...chartBaseOptions().plugins.tooltip,
          mode: 'index', intersect: false,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${(ctx.parsed.y * 100).toFixed(2)}%` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: CHART_COLORS.text } },
        y: { ...chartBaseOptions().scales.y, ticks: { callback: v => (v * 100).toFixed(1) + '%', color: CHART_COLORS.text } },
      },
    },
  });
}

// ── Scatter / Efficient Frontier chart ────────────────
function createFrontierChart(ctx, series) {
  // series: [{ label, data:[{x,y}], color, showLine, dash, pointRadius, pointStyle }]
  return new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: series.map(s => ({
        label:           s.label,
        data:            s.data,
        borderColor:     s.color,
        backgroundColor: s.fill ? s.color + '22' : s.color,
        showLine:        s.showLine || false,
        borderDash:      s.dash || [],
        borderWidth:     s.width || 2,
        pointRadius:     s.pointRadius ?? 4,
        pointStyle:      s.pointStyle || 'circle',
        pointHoverRadius: (s.pointRadius ?? 4) + 2,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: CHART_COLORS.text,
            boxWidth: 18,
            padding: 14,
            font: { size: 11 },
            filter: item => (item.text || '').trim().length > 0,
          },
        },
        tooltip: {
          backgroundColor: '#0F1829',
          borderColor: CHART_COLORS.grid,
          borderWidth: 1,
          callbacks: {
            label: ctx => {
              const d = ctx.raw;
              return d.label
                ? ` ${d.label}: Vol ${(+d.x).toFixed(2)}% | Ret ${(+d.y).toFixed(2)}%`
                : ` Vol ${(+ctx.parsed.x).toFixed(2)}% | Ret ${(+ctx.parsed.y).toFixed(2)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Annualized Volatility (%)', color: CHART_COLORS.textMuted },
          grid:  { color: CHART_COLORS.grid },
          ticks: { color: CHART_COLORS.text, callback: v => v.toFixed(1) + '%' },
        },
        y: {
          title: { display: true, text: 'Annualized Expected Return (%)', color: CHART_COLORS.textMuted },
          grid:  { color: CHART_COLORS.grid },
          ticks: { color: CHART_COLORS.text, callback: v => v.toFixed(1) + '%' },
        },
      },
      animation: { duration: 400 },
    },
  });
}

// ── Destroy + recreate chart in a canvas ──────────────
function refreshChart(canvasId, creator) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  return creator(canvas.getContext('2d'));
}
