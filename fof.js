const DIRECT_SUPABASE_BENCHMARK_OPTIONS = [
  { code: "000300", symbol: "000300.SH", name: "沪深 300" },
  { code: "000001", symbol: "000001.SH", name: "上证指数" },
  { code: "000852", symbol: "000852.CSI", name: "中证 1000" },
];

const BENCHMARK_STYLES = {
  "000300": {
    borderColor: "#f59e0b",
    backgroundColor: "rgba(245, 158, 11, 0.10)",
  },
  "000001": {
    borderColor: "#14b8a6",
    backgroundColor: "rgba(20, 184, 166, 0.10)",
  },
  "000852": {
    borderColor: "#16a34a",
    backgroundColor: "rgba(22, 163, 74, 0.10)",
  },
};

const STORAGE_KEY = "github_fof_portfolios_v1";
const DEFAULT_BENCHMARK_CODE = "000300";
const SUPABASE_PAGE_SIZE = 1000;

const state = {
  funds: [],
  fundRows: [],
  benchmarkRows: [],
  fundRowsByShort: new Map(),
  benchmarkRowsByCode: new Map(),
  portfolioRecords: [],
  portfolios: [],
  benchmarkOptions: DIRECT_SUPABASE_BENCHMARK_OPTIONS.slice(),
  currentBenchmark: DEFAULT_BENCHMARK_CODE,
  selectedFunds: [],
  activePortfolioId: "",
  activePortfolioData: null,
  defaultStartDate: "",
  navChart: null,
  drawdownChart: null,
};

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();

  try {
    await initPage();
  } catch (error) {
    resetPortfolioDetail();
    showStatus(error.message, "error", true);
  }
});

function bindEvents() {
  document.getElementById("newPortfolioBtn").addEventListener("click", () => {
    resetBuilderForm();
    showStatus("已重置新建表单，请重新选择子基金并填写权重。", "info");
  });

  document.getElementById("savePortfolioBtn").addEventListener("click", async () => {
    await createPortfolio();
  });

  document.getElementById("fundChipList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-fund]");
    if (!button) {
      return;
    }
    toggleFundSelection(button.dataset.fund);
  });

  document.getElementById("selectedFundsList").addEventListener("input", (event) => {
    const input = event.target.closest("[data-weight-fund]");
    if (!input) {
      return;
    }

    const target = state.selectedFunds.find((item) => item.fund_name_short === input.dataset.weightFund);
    if (!target) {
      return;
    }

    target.weightInput = input.value;
    updateSelectedStats();
  });

  document.getElementById("selectedFundsList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-fund]");
    if (!button) {
      return;
    }
    removeSelectedFund(button.dataset.removeFund);
  });

  document.getElementById("savedPortfolios").addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-portfolio-id]");
    if (deleteButton) {
      await deletePortfolio(deleteButton.dataset.deletePortfolioId);
      return;
    }

    const openButton = event.target.closest("[data-open-portfolio-id]");
    if (!openButton) {
      return;
    }

    await loadPortfolio(openButton.dataset.openPortfolioId);
  });

  document.getElementById("fofBenchmarkSelector").addEventListener("change", (event) => {
    state.currentBenchmark = event.target.value;
    if (state.activePortfolioData) {
      renderCharts(state.activePortfolioData.series || {});
      updateDrawdownMeta(state.activePortfolioData.series || {});
    }
  });
}

async function initPage() {
  showStatus("正在从 Supabase 加载 FOF 页面数据...", "info");

  const snapshot = await fetchSupabaseSnapshot();
  state.fundRows = snapshot.fundRows;
  state.benchmarkRows = snapshot.benchmarkRows;
  state.fundRowsByShort = groupFundRowsByShort(snapshot.fundRows);
  state.benchmarkRowsByCode = groupBenchmarkRowsByCode(snapshot.benchmarkRows);
  state.funds = buildFundList(snapshot.fundRows);
  state.defaultStartDate = buildDefaultStartDate(state.funds);
  refreshPortfolios();
  renderBenchmarkSelector();
  renderFundChips();
  resetBuilderForm();
  renderSavedPortfolios();

  if (!state.funds.length) {
    resetPortfolioDetail();
    showStatus("Supabase 中还没有可用于模拟 FOF 的基金净值数据。", "warning", true);
    return;
  }

  if (state.portfolioRecords.length) {
    await loadPortfolio(state.portfolioRecords[0].id);
  } else {
    resetPortfolioDetail();
  }

  showStatus(
    `已从 Supabase 加载 ${state.funds.length} 只基金和 ${state.benchmarkRows.length} 条基准记录，组合保存在当前浏览器。`,
    "success"
  );
}

function refreshPortfolios() {
  state.portfolioRecords = loadSavedPortfolios();
  state.portfolios = state.portfolioRecords
    .map((item) => ({
      id: item.id,
      name: item.name,
      requested_start_date: item.requested_start_date,
      created_at: item.created_at,
      member_count: Array.isArray(item.members) ? item.members.length : 0,
    }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

function resetBuilderForm() {
  document.getElementById("portfolioNameInput").value = "";
  document.getElementById("startDateInput").value = state.defaultStartDate || "";
  state.selectedFunds = [];
  renderFundChips();
  renderSelectedFunds();
  updateSelectedStats();
}

function toggleFundSelection(fundNameShort) {
  const existingIndex = state.selectedFunds.findIndex((item) => item.fund_name_short === fundNameShort);
  if (existingIndex >= 0) {
    state.selectedFunds.splice(existingIndex, 1);
  } else {
    state.selectedFunds.push({
      fund_name_short: fundNameShort,
      weightInput: "1",
    });
  }

  renderFundChips();
  renderSelectedFunds();
  updateSelectedStats();
}

function removeSelectedFund(fundNameShort) {
  state.selectedFunds = state.selectedFunds.filter((item) => item.fund_name_short !== fundNameShort);
  renderFundChips();
  renderSelectedFunds();
  updateSelectedStats();
}

function renderFundChips() {
  const container = document.getElementById("fundChipList");

  if (!state.funds.length) {
    container.innerHTML = '<div class="empty-block">当前还没有可用于组合的基金净值数据。</div>';
    return;
  }

  const activeFunds = new Set(state.selectedFunds.map((item) => item.fund_name_short));
  container.innerHTML = state.funds.map((fund) => {
    const activeClass = activeFunds.has(fund.short_name) ? " active" : "";
    const title = `${fund.full_name || fund.short_name} | 数据区间：${fund.min_date || "--"} 至 ${fund.max_date || "--"}`;
    return `
      <button
        type="button"
        class="fund-chip${activeClass}"
        data-fund="${escapeHtmlAttr(fund.short_name)}"
        title="${escapeHtmlAttr(title)}"
      >
        ${escapeHtml(fund.short_name)}
      </button>
    `;
  }).join("");
}

function renderSelectedFunds() {
  const container = document.getElementById("selectedFundsList");

  if (!state.selectedFunds.length) {
    container.innerHTML = '<div class="empty-block">点击左侧基金后，这里会显示“子基金 1、子基金 2 ...”及其权重。</div>';
    return;
  }

  container.innerHTML = state.selectedFunds.map((item, index) => `
    <div class="selected-row">
      <div class="selected-index">子基金 ${index + 1}</div>
      <div class="selected-name">${escapeHtml(item.fund_name_short)}</div>
      <label class="selected-weight">
        <span>权重</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value="${escapeHtmlAttr(item.weightInput ?? "")}"
          data-weight-fund="${escapeHtmlAttr(item.fund_name_short)}"
        >
      </label>
      <button
        type="button"
        class="btn btn-secondary selected-remove"
        data-remove-fund="${escapeHtmlAttr(item.fund_name_short)}"
      >
        移除
      </button>
    </div>
  `).join("");
}

function renderSavedPortfolios() {
  const container = document.getElementById("savedPortfolios");

  if (!state.portfolios.length) {
    container.innerHTML = '<div class="empty-block">当前还没有已保存的 FOF 组合。</div>';
    return;
  }

  container.innerHTML = state.portfolios.map((item) => {
    const activeClass = item.id === state.activePortfolioId ? " active" : "";
    return `
      <article class="portfolio-card${activeClass}">
        <div class="portfolio-card-head">
          <strong>${escapeHtml(item.name)}</strong>
          <div class="portfolio-card-actions">
            <button type="button" class="btn btn-secondary" data-open-portfolio-id="${escapeHtmlAttr(item.id)}">查看</button>
            <button type="button" class="btn portfolio-delete-btn" data-delete-portfolio-id="${escapeHtmlAttr(item.id)}">删除</button>
          </div>
        </div>
        <p>请求开始时间：${escapeHtml(item.requested_start_date || "--")}</p>
        <p>子基金数量：${escapeHtml(String(item.member_count ?? 0))}</p>
        <p>保存时间：${escapeHtml(item.created_at || "--")}</p>
      </article>
    `;
  }).join("");
}

function renderBenchmarkSelector() {
  const selector = document.getElementById("fofBenchmarkSelector");
  const options = Array.isArray(state.benchmarkOptions) && state.benchmarkOptions.length
    ? state.benchmarkOptions
    : DIRECT_SUPABASE_BENCHMARK_OPTIONS;

  if (!options.some((item) => item.code === state.currentBenchmark)) {
    state.currentBenchmark = options[0].code;
  }

  selector.innerHTML = options.map((item) => (
    `<option value="${escapeHtmlAttr(item.code)}">${escapeHtml(item.name)}</option>`
  )).join("");
  selector.value = state.currentBenchmark;
}

async function createPortfolio() {
  const name = document.getElementById("portfolioNameInput").value.trim();
  const startDate = document.getElementById("startDateInput").value.trim();

  if (!name) {
    showStatus("请先填写组合名称。", "warning", true);
    return;
  }

  if (!startDate) {
    showStatus("请先填写开始时间。", "warning", true);
    return;
  }

  if (!state.selectedFunds.length) {
    showStatus("请至少选择一个子基金。", "warning", true);
    return;
  }

  const members = [];
  for (const item of state.selectedFunds) {
    const weight = parseWeight(item.weightInput);
    if (!Number.isFinite(weight) || weight <= 0) {
      showStatus(`子基金 ${item.fund_name_short} 的权重必须大于 0。`, "warning", true);
      return;
    }

    members.push({
      fund_name_short: item.fund_name_short,
      input_weight: weight,
    });
  }

  const portfolio = {
    id: generatePortfolioId(),
    name,
    requested_start_date: parseDateInput(startDate),
    created_at: formatDateTimeValue(new Date()),
    members,
  };

  showStatus("正在创建并保存 FOF 组合...", "info", true);

  try {
    const data = buildPortfolioPayload(portfolio);
    const nextRecords = loadSavedPortfolios();
    nextRecords.push(portfolio);
    saveSavedPortfolios(nextRecords);

    refreshPortfolios();
    state.activePortfolioId = portfolio.id;
    renderPortfolioDetail(data);
    renderSavedPortfolios();
    showStatus(`FOF 组合“${portfolio.name}”已创建并保存在当前浏览器。`, "success");
  } catch (error) {
    showStatus(error.message, "error", true);
  }
}

async function loadPortfolio(portfolioId) {
  if (!portfolioId) {
    return;
  }

  const portfolio = state.portfolioRecords.find((item) => item.id === portfolioId);
  if (!portfolio) {
    showStatus("未找到对应的 FOF 组合。", "error", true);
    return;
  }

  showStatus("正在加载已保存的 FOF 组合...", "info");

  try {
    const data = buildPortfolioPayload(portfolio);
    state.activePortfolioId = portfolioId;
    renderPortfolioDetail(data);
    renderSavedPortfolios();
    showStatus(`已加载组合：${portfolio.name}`, "success");
  } catch (error) {
    showStatus(`组合“${portfolio.name}”加载失败：${error.message}`, "error", true);
  }
}

async function deletePortfolio(portfolioId) {
  if (!portfolioId) {
    return;
  }

  const portfolio = state.portfolioRecords.find((item) => item.id === portfolioId);
  const portfolioName = portfolio?.name || "该组合";
  const shouldDelete = window.confirm(`确认删除 FOF 组合“${portfolioName}”吗？此操作不可撤销。`);
  if (!shouldDelete) {
    return;
  }

  const nextRecords = loadSavedPortfolios().filter((item) => item.id !== portfolioId);

  try {
    saveSavedPortfolios(nextRecords);
    const wasActive = state.activePortfolioId === portfolioId;

    if (wasActive) {
      state.activePortfolioId = "";
      state.activePortfolioData = null;
    }

    refreshPortfolios();

    if (wasActive) {
      if (state.portfolioRecords.length) {
        await loadPortfolio(state.portfolioRecords[0].id);
      } else {
        resetPortfolioDetail();
      }
    }

    renderSavedPortfolios();
    showStatus(`FOF 组合“${portfolioName}”已删除。`, "success");
  } catch (error) {
    showStatus(error.message, "error", true);
  }
}

function renderPortfolioDetail(data) {
  const summary = data?.summary || {};
  const portfolio = data?.portfolio || {};
  const composition = Array.isArray(data?.composition) ? data.composition : [];
  const series = data?.series || {};

  state.activePortfolioData = data || null;
  if (Array.isArray(series.benchmark_options) && series.benchmark_options.length) {
    state.benchmarkOptions = series.benchmark_options;
  }
  if (!state.benchmarkOptions.some((item) => item.code === state.currentBenchmark)) {
    state.currentBenchmark = series.selected_benchmark_code || state.benchmarkOptions[0]?.code || DEFAULT_BENCHMARK_CODE;
  }

  renderBenchmarkSelector();

  setText("summaryName", summary.name || "--");
  setText("summaryRequestedStart", summary.requested_start_date || "--");
  setText("summaryEffectiveStart", summary.effective_start_date || "--");
  setText("summaryLatestDate", summary.latest_date || "--");
  setText("summaryLatestUnitNav", formatValue(summary.latest_unit_nav, 4));
  setText("summaryLatestAccumNav", formatValue(summary.latest_accum_nav, 4));
  setText("summaryCumReturn", formatPercent(summary.cumulative_return));
  setText("summaryMaxDrawdown", formatPercent(summary.max_drawdown));
  setText("summaryMemberCount", summary.member_count ?? "--");

  const cashText = Number(summary.cash_weight) > 0 ? ` | 现金 ${Number(summary.cash_weight).toFixed(2)}%` : "";
  setText(
    "activePortfolioMeta",
    `${portfolio.name || "--"} | 请求开始 ${summary.requested_start_date || "--"} | 有效开始 ${summary.effective_start_date || "--"} | 子基金 ${summary.member_count ?? "--"} 只${cashText} | 回撤基于组合累计净值计算`
  );

  renderCompositionTable(composition);
  renderCharts(series);
  updateDrawdownMeta(series);
}

function resetPortfolioDetail() {
  state.activePortfolioData = null;

  [
    "summaryName",
    "summaryRequestedStart",
    "summaryEffectiveStart",
    "summaryLatestDate",
    "summaryLatestUnitNav",
    "summaryLatestAccumNav",
    "summaryCumReturn",
    "summaryMaxDrawdown",
    "summaryMemberCount",
  ].forEach((id) => setText(id, "--"));

  setText("activePortfolioMeta", "请选择或新建一个 FOF 组合后查看，图中会同时展示单位净值和累计净值。");
  setText("drawdownMeta", "回撤曲线按 FOF 组合累计净值的历史高点动态计算，并支持与基准回撤对比。");
  document.getElementById("compositionBody").innerHTML = '<tr><td colspan="6" class="empty-row">请选择或新建一个组合后查看</td></tr>';
  destroyCharts();
}

function updateDrawdownMeta(series) {
  const options = Array.isArray(series?.benchmark_options) ? series.benchmark_options : state.benchmarkOptions;
  const selected = options.find((item) => item.code === state.currentBenchmark);
  const benchmarkName = selected?.name || "基准";
  setText("drawdownMeta", `回撤曲线按 FOF 组合累计净值的历史高点动态计算，当前对比基准为 ${benchmarkName}。`);
}

function renderCompositionTable(rows) {
  const body = document.getElementById("compositionBody");

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-row">当前组合没有可展示的子基金构成。</td></tr>';
    return;
  }

  body.innerHTML = rows.map((item) => {
    const returnValue = item.period_return == null ? "--" : `${Number(item.period_return).toFixed(2)}%`;
    const className = item.period_return == null ? "" : item.period_return >= 0 ? "up" : "down";
    return `
      <tr>
        <td>${escapeHtml(item.fund_name_short || "--")}</td>
        <td>${formatValue(item.input_weight, 4)}</td>
        <td>${formatPercent(item.normalized_weight)}</td>
        <td>${escapeHtml(item.start_nav_date || "--")}</td>
        <td>${escapeHtml(item.latest_nav_date || "--")}</td>
        <td class="${className}">${returnValue}</td>
      </tr>
    `;
  }).join("");
}

function renderCharts(series) {
  const labels = Array.isArray(series?.dates) ? series.dates : [];
  const unitNavSeries = Array.isArray(series?.unit_nav_series) ? series.unit_nav_series : [];
  const accumNavSeries = Array.isArray(series?.accum_nav_series) ? series.accum_nav_series : [];
  const drawdownSeries = Array.isArray(series?.drawdown_series) ? series.drawdown_series : [];
  const benchmarkSeries = series?.benchmarks?.[state.currentBenchmark] || null;

  if (!labels.length || !unitNavSeries.length || !accumNavSeries.length || !drawdownSeries.length) {
    destroyCharts();
    return;
  }

  if (typeof window.Chart !== "function") {
    destroyCharts();
    showStatus("Chart.js 未加载，当前无法渲染图表。", "warning", true);
    return;
  }

  renderNavChart(labels, unitNavSeries, accumNavSeries);
  renderDrawdownChart(labels, drawdownSeries, benchmarkSeries);
}

function renderNavChart(labels, unitNavSeries, accumNavSeries) {
  const ctx = document.getElementById("fofNavChart").getContext("2d");
  if (state.navChart) {
    state.navChart.destroy();
  }

  state.navChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "FOF 组合单位净值",
          data: unitNavSeries,
          borderColor: "#db5b45",
          backgroundColor: "rgba(219, 91, 69, 0.10)",
          borderWidth: 2.6,
          fill: true,
          tension: 0.18,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
        {
          label: "FOF 组合累计净值",
          data: accumNavSeries,
          borderColor: "#1f5eff",
          backgroundColor: "rgba(31, 94, 255, 0.08)",
          borderWidth: 2.6,
          fill: true,
          tension: 0.18,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "start" },
        tooltip: {
          callbacks: {
            label(context) {
              if (context.raw == null || Number.isNaN(Number(context.raw))) {
                return `${context.dataset.label}: --`;
              }
              return `${context.dataset.label}: ${Number(context.raw).toFixed(4)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 10, color: "#5f6b7a" },
          grid: { color: "rgba(79, 98, 148, 0.08)" },
        },
        y: {
          ticks: {
            color: "#5f6b7a",
            callback(value) {
              return Number(value).toFixed(3);
            },
          },
          grid: { color: "rgba(79, 98, 148, 0.08)" },
        },
      },
    },
  });
}

function renderDrawdownChart(labels, drawdownSeries, benchmarkSeries) {
  const ctx = document.getElementById("fofDrawdownChart").getContext("2d");
  if (state.drawdownChart) {
    state.drawdownChart.destroy();
  }

  const benchmarkValues = Array.isArray(benchmarkSeries?.drawdown_series)
    ? benchmarkSeries.drawdown_series
    : [];
  const benchmarkStyle = BENCHMARK_STYLES[state.currentBenchmark] || BENCHMARK_STYLES[DEFAULT_BENCHMARK_CODE];
  const datasets = [
    {
      label: "FOF 组合回撤",
      data: drawdownSeries,
      borderColor: "#101828",
      backgroundColor: "rgba(16, 24, 40, 0.10)",
      borderWidth: 2.6,
      fill: true,
      tension: 0.18,
      pointRadius: 0,
      pointHoverRadius: 4,
    },
  ];

  if (benchmarkValues.length) {
    datasets.push({
      label: `${benchmarkSeries?.name || "基准"}回撤`,
      data: benchmarkValues,
      borderColor: benchmarkStyle.borderColor,
      backgroundColor: benchmarkStyle.backgroundColor,
      borderWidth: 2.4,
      fill: false,
      tension: 0.18,
      pointRadius: 0,
      pointHoverRadius: 4,
      spanGaps: true,
    });
  }

  state.drawdownChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "start" },
        tooltip: {
          callbacks: {
            label(context) {
              if (context.raw == null || Number.isNaN(Number(context.raw))) {
                return `${context.dataset.label}: --`;
              }
              return `${context.dataset.label}: ${Number(context.raw).toFixed(2)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 10, color: "#5f6b7a" },
          grid: { color: "rgba(79, 98, 148, 0.08)" },
        },
        y: {
          reverse: true,
          ticks: {
            color: "#5f6b7a",
            callback(value) {
              return `${Number(value).toFixed(1)}%`;
            },
          },
          grid: { color: "rgba(79, 98, 148, 0.08)" },
        },
      },
    },
  });
}

function destroyCharts() {
  if (state.navChart) {
    state.navChart.destroy();
    state.navChart = null;
  }

  if (state.drawdownChart) {
    state.drawdownChart.destroy();
    state.drawdownChart = null;
  }
}

function buildPortfolioPayload(portfolio) {
  const normalizedMembers = normalizeMembers(
    (portfolio.members || []).map((item) => ({
      fund_name_short: item.fund_name_short,
      weight: item.input_weight ?? item.weight,
    }))
  );

  const seriesPayload = buildPortfolioSeries(portfolio.requested_start_date, normalizedMembers);

  return {
    portfolio: {
      id: portfolio.id,
      name: portfolio.name,
      requested_start_date: portfolio.requested_start_date,
      created_at: portfolio.created_at,
      members: normalizedMembers.map((item) => ({
        fund_name_short: item.fund_name_short,
        input_weight: safeFloat(item.input_weight, 4),
        normalized_weight: safeFloat(item.weight_percent, 4),
      })),
    },
    summary: {
      name: portfolio.name,
      requested_start_date: seriesPayload.requested_start_date,
      effective_start_date: seriesPayload.effective_start_date,
      latest_date: seriesPayload.latest_date,
      latest_unit_nav: seriesPayload.latest_unit_nav,
      latest_accum_nav: seriesPayload.latest_accum_nav,
      cumulative_return: seriesPayload.cumulative_return,
      max_drawdown: seriesPayload.max_drawdown,
      member_count: seriesPayload.member_count,
      cash_weight: seriesPayload.cash_weight,
    },
    series: {
      dates: seriesPayload.dates,
      unit_nav_series: seriesPayload.unit_nav_series,
      accum_nav_series: seriesPayload.accum_nav_series,
      drawdown_series: seriesPayload.drawdown_series,
      benchmark_options: seriesPayload.benchmark_options,
      selected_benchmark_code: seriesPayload.selected_benchmark_code,
      benchmarks: seriesPayload.benchmarks,
    },
    composition: seriesPayload.composition,
  };
}

function buildPortfolioSeries(requestedStartDateText, members) {
  const requestedStartDate = parseDateInput(requestedStartDateText);
  const fundFrames = new Map();
  const memberStats = new Map();

  members.forEach((member) => {
    const fundRows = state.fundRowsByShort.get(member.fund_name_short) || [];
    if (!fundRows.length) {
      throw new Error(`未找到基金 ${member.fund_name_short} 的净值数据。`);
    }

    const afterStart = fundRows.filter((row) => row.net_date >= requestedStartDate);
    if (!afterStart.length) {
      throw new Error(`基金 ${member.fund_name_short} 在 ${requestedStartDate} 之后没有净值数据。`);
    }

    fundFrames.set(member.fund_name_short, fundRows);
    memberStats.set(member.fund_name_short, {
      first_after_start: afterStart[0].net_date,
      last_date: fundRows[fundRows.length - 1].net_date,
    });
  });

  const effectiveStart = getMaxDate([...memberStats.values()].map((item) => item.first_after_start));
  const commonEnd = getMinDate([...memberStats.values()].map((item) => item.last_date));

  if (!effectiveStart || !commonEnd || commonEnd < effectiveStart) {
    throw new Error("所选子基金没有可用于组合的重叠区间。");
  }

  const dateSet = new Set([effectiveStart]);
  members.forEach((member) => {
    const rows = fundFrames.get(member.fund_name_short) || [];
    rows.forEach((row) => {
      if (row.net_date >= effectiveStart && row.net_date <= commonEnd) {
        dateSet.add(row.net_date);
      }
    });
  });

  const dateIndex = [...dateSet].sort((a, b) => a.localeCompare(b));
  if (dateIndex.length < 2) {
    throw new Error("所选区间的有效净值点不足 2 个，无法构建模拟 FOF 曲线。");
  }

  const cashRatio = members[0]?.cash_ratio || 0;
  const weightedUnitNav = new Array(dateIndex.length).fill(cashRatio);
  const weightedAccumNav = new Array(dateIndex.length).fill(cashRatio);
  const composition = [];

  members.forEach((member) => {
    const fundNameShort = member.fund_name_short;
    const rows = (fundFrames.get(fundNameShort) || []).filter((row) => row.net_date <= commonEnd);
    const baseUnitValue = getLastValueOnOrBefore(rows, effectiveStart, (row) => row.unit_net);
    const baseAccumValue = getLastValueOnOrBefore(rows, effectiveStart, (row) => row.accum_net ?? row.unit_net);

    if (baseUnitValue == null || baseAccumValue == null) {
      throw new Error(`基金 ${fundNameShort} 无法在有效开始日找到基准净值。`);
    }

    const unitValuesByDate = new Map([[effectiveStart, baseUnitValue]]);
    const accumValuesByDate = new Map([[effectiveStart, baseAccumValue]]);

    rows.forEach((row) => {
      if (row.net_date < effectiveStart) {
        return;
      }

      const unitValue = toFiniteNumber(row.unit_net);
      const accumValue = toFiniteNumber(row.accum_net) ?? unitValue;

      if (unitValue != null) {
        unitValuesByDate.set(row.net_date, unitValue);
      }
      if (accumValue != null) {
        accumValuesByDate.set(row.net_date, accumValue);
      }
    });

    const alignedUnit = forwardFillDateSeries(dateIndex, unitValuesByDate);
    const alignedAccum = forwardFillDateSeries(dateIndex, accumValuesByDate);

    alignedUnit.forEach((value, index) => {
      weightedUnitNav[index] += (value ?? 0) * member.weight_ratio;
    });
    alignedAccum.forEach((value, index) => {
      weightedAccumNav[index] += (value ?? 0) * member.weight_ratio;
    });

    const latestUnitValue = alignedUnit[alignedUnit.length - 1];
    const latestAccumValue = alignedAccum[alignedAccum.length - 1];
    let periodReturn = null;
    if (baseAccumValue !== 0 && latestAccumValue != null) {
      periodReturn = ((latestAccumValue / baseAccumValue) - 1) * 100;
    } else if (baseUnitValue !== 0 && latestUnitValue != null) {
      periodReturn = ((latestUnitValue / baseUnitValue) - 1) * 100;
    }

    composition.push({
      fund_name_short: fundNameShort,
      input_weight: safeFloat(member.input_weight, 4),
      normalized_weight: safeFloat(member.weight_percent, 4),
      start_nav_date: effectiveStart,
      latest_nav_date: commonEnd,
      base_unit_nav: safeFloat(baseUnitValue, 6),
      latest_unit_nav: safeFloat(latestUnitValue, 6),
      base_accum_nav: safeFloat(baseAccumValue, 6),
      latest_accum_nav: safeFloat(latestAccumValue, 6),
      period_return: safeFloat(periodReturn, 6),
    });
  });

  const unitNavSeries = weightedUnitNav.map((value) => safeFloat(value, 6));
  const accumNavSeries = weightedAccumNav.map((value) => safeFloat(value, 6));
  const drawdownSeries = computeDrawdownSeries(accumNavSeries);
  const latestAccumNav = accumNavSeries[accumNavSeries.length - 1];
  let cumulativeReturn = null;

  if (accumNavSeries[0] != null && accumNavSeries[0] !== 0 && latestAccumNav != null) {
    cumulativeReturn = ((latestAccumNav / accumNavSeries[0]) - 1) * 100;
  }

  if (cashRatio > 0) {
    composition.push({
      fund_name_short: "现金",
      input_weight: safeFloat(cashRatio, 4),
      normalized_weight: safeFloat(cashRatio * 100, 4),
      start_nav_date: effectiveStart,
      latest_nav_date: commonEnd,
      base_unit_nav: 1.0,
      latest_unit_nav: 1.0,
      base_accum_nav: 1.0,
      latest_accum_nav: 1.0,
      period_return: 0.0,
    });
  }

  return {
    requested_start_date: requestedStartDate,
    effective_start_date: effectiveStart,
    latest_date: commonEnd,
    latest_unit_nav: safeFloat(unitNavSeries[unitNavSeries.length - 1], 6),
    latest_accum_nav: safeFloat(latestAccumNav, 6),
    cumulative_return: safeFloat(cumulativeReturn, 6),
    max_drawdown: safeFloat(getMaxNumber(drawdownSeries), 6),
    member_count: members.length,
    cash_weight: safeFloat(cashRatio * 100, 4),
    dates: dateIndex,
    unit_nav_series: unitNavSeries,
    accum_nav_series: accumNavSeries,
    drawdown_series: drawdownSeries,
    benchmark_options: DIRECT_SUPABASE_BENCHMARK_OPTIONS.slice(),
    selected_benchmark_code: DEFAULT_BENCHMARK_CODE,
    benchmarks: buildBenchmarkPayloads(dateIndex),
    composition,
  };
}

function buildBenchmarkPayloads(dateIndex) {
  const payloads = {};

  DIRECT_SUPABASE_BENCHMARK_OPTIONS.forEach((option) => {
    const rows = state.benchmarkRowsByCode.get(option.code) || [];
    if (!rows.length) {
      payloads[option.code] = {
        code: option.code,
        name: option.name,
        drawdown_series: [],
      };
      return;
    }

    const alignedClose = alignBenchmarkSeriesToDates(dateIndex, rows);
    payloads[option.code] = {
      code: option.code,
      name: option.name,
      drawdown_series: computeDrawdownSeries(alignedClose),
    };
  });

  return payloads;
}

function normalizeMembers(members) {
  if (!Array.isArray(members) || !members.length) {
    throw new Error("请至少选择一个子基金。");
  }

  const normalized = [];
  const seen = new Set();
  let totalWeight = 0;

  members.forEach((item) => {
    const fundNameShort = String(item?.fund_name_short || "").trim();
    if (!fundNameShort) {
      throw new Error("子基金名称不能为空。");
    }
    if (seen.has(fundNameShort)) {
      throw new Error(`子基金 ${fundNameShort} 重复，请去重后再保存。`);
    }

    const inputWeight = Number(item?.weight);
    if (!Number.isFinite(inputWeight)) {
      throw new Error(`子基金 ${fundNameShort} 的权重格式不正确。`);
    }
    if (inputWeight <= 0) {
      throw new Error(`子基金 ${fundNameShort} 的权重必须大于 0。`);
    }

    normalized.push({
      fund_name_short: fundNameShort,
      input_weight: inputWeight,
    });
    totalWeight += inputWeight;
    seen.add(fundNameShort);
  });

  if (totalWeight <= 0) {
    throw new Error("权重合计必须大于 0。");
  }

  const useCashPosition = totalWeight < 1;
  const cashRatio = useCashPosition ? Math.max(0, 1 - totalWeight) : 0;

  normalized.forEach((item) => {
    const weightRatio = useCashPosition ? item.input_weight : item.input_weight / totalWeight;
    item.weight_ratio = weightRatio;
    item.weight_percent = weightRatio * 100;
    item.cash_ratio = cashRatio;
    item.allocation_mode = useCashPosition ? "cash" : "normalized";
  });

  return normalized;
}

async function fetchSupabaseSnapshot() {
  const [fundRows, benchmarkRows] = await Promise.all([
    fetchSupabaseAll("fund_net_value", {
      select: "fund_name,fund_name_short,net_date,unit_net,accum_net,update_time",
      order: "fund_name_short.asc,net_date.asc,update_time.asc",
    }),
    fetchSupabaseAll("benchmark_price", {
      select: "index_code,trade_date,close_price,cumulative_return,source",
      order: "index_code.asc,trade_date.asc",
    }),
  ]);

  return {
    fundRows: normalizeFundRows(fundRows),
    benchmarkRows: normalizeBenchmarkRows(benchmarkRows),
  };
}

function getSupabaseConfig() {
  const url = (
    window.SUPABASE_URL
    || document.querySelector('meta[name="supabase-url"]')?.content
    || ""
  ).trim().replace(/\/$/, "");
  const key = (
    window.SUPABASE_PUBLISHABLE_KEY
    || window.SUPABASE_API_KEY
    || document.querySelector('meta[name="supabase-publishable-key"]')?.content
    || ""
  ).trim();

  if (!url) {
    throw new Error("未配置 Supabase URL。");
  }
  if (!key) {
    throw new Error("未配置 Supabase publishable key。");
  }
  if (/^sb_secret_/i.test(key)) {
    throw new Error("前端必须使用 Supabase publishable key，不能使用 service_role 或 secret key。");
  }

  return { url, key };
}

function buildQueryString(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") {
      return;
    }
    search.set(key, String(value));
  });
  return search.toString();
}

function getErrorMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    return payload.message || payload.error_description || payload.details || payload.hint || fallback;
  }
  return fallback;
}

async function fetchSupabasePage(tableName, params = {}) {
  const { url, key } = getSupabaseConfig();
  const query = buildQueryString(params);
  const response = await fetch(`${url}/rest/v1/${tableName}?${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();
  let payload = [];

  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`Supabase 返回了非 JSON 内容：${text.trim().slice(0, 120)}`);
    }
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Supabase 请求失败：${response.status}`));
  }

  return payload;
}

async function fetchSupabaseAll(tableName, params = {}) {
  const rows = [];

  for (let offset = 0; ; offset += SUPABASE_PAGE_SIZE) {
    const batch = await fetchSupabasePage(tableName, {
      ...params,
      limit: SUPABASE_PAGE_SIZE,
      offset,
    });

    if (!Array.isArray(batch) || !batch.length) {
      break;
    }

    rows.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

function normalizeFundRows(rows) {
  const deduped = new Map();

  rows.forEach((row) => {
    const fundNameShort = String(row?.fund_name_short || "").trim();
    const netDate = formatDateOnlyValue(row?.net_date);
    const unitNet = toFiniteNumber(row?.unit_net);
    if (!fundNameShort || !netDate || unitNet == null || unitNet <= 0) {
      return;
    }

    const normalized = {
      fund_name: String(row?.fund_name || fundNameShort).trim() || fundNameShort,
      fund_name_short: fundNameShort,
      net_date: netDate,
      unit_net: unitNet,
      accum_net: toFiniteNumber(row?.accum_net),
      update_time: String(row?.update_time || ""),
    };

    const key = `${fundNameShort}__${netDate}`;
    const existing = deduped.get(key);
    if (!existing || normalized.update_time >= existing.update_time) {
      deduped.set(key, normalized);
    }
  });

  return [...deduped.values()].sort((a, b) => {
    if (a.fund_name_short !== b.fund_name_short) {
      return a.fund_name_short.localeCompare(b.fund_name_short, "zh-CN");
    }
    if (a.net_date !== b.net_date) {
      return a.net_date.localeCompare(b.net_date);
    }
    return a.update_time.localeCompare(b.update_time);
  });
}

function normalizeBenchmarkRows(rows) {
  const deduped = new Map();

  rows.forEach((row) => {
    const indexCode = String(row?.index_code || "").trim();
    const tradeDate = formatDateOnlyValue(row?.trade_date);
    const closePrice = toFiniteNumber(row?.close_price);
    if (!indexCode || !tradeDate || closePrice == null) {
      return;
    }

    deduped.set(`${indexCode}__${tradeDate}`, {
      index_code: indexCode,
      trade_date: tradeDate,
      close_price: closePrice,
      cumulative_return: toFiniteNumber(row?.cumulative_return),
      source: String(row?.source || ""),
    });
  });

  return [...deduped.values()].sort((a, b) => {
    if (a.index_code !== b.index_code) {
      return a.index_code.localeCompare(b.index_code);
    }
    return a.trade_date.localeCompare(b.trade_date);
  });
}

function buildFundList(fundRows) {
  const grouped = new Map();

  fundRows.forEach((row) => {
    const existing = grouped.get(row.fund_name_short);
    if (!existing) {
      grouped.set(row.fund_name_short, {
        short_name: row.fund_name_short,
        full_name: row.fund_name || row.fund_name_short,
        min_date: row.net_date,
        max_date: row.net_date,
        row_count: 1,
      });
      return;
    }

    existing.full_name = row.fund_name || existing.full_name;
    if (row.net_date < existing.min_date) {
      existing.min_date = row.net_date;
    }
    if (row.net_date > existing.max_date) {
      existing.max_date = row.net_date;
    }
    existing.row_count += 1;
  });

  return [...grouped.values()].sort((a, b) => a.short_name.localeCompare(b.short_name, "zh-CN"));
}

function groupFundRowsByShort(fundRows) {
  const grouped = new Map();

  fundRows.forEach((row) => {
    if (!grouped.has(row.fund_name_short)) {
      grouped.set(row.fund_name_short, []);
    }
    grouped.get(row.fund_name_short).push(row);
  });

  return grouped;
}

function groupBenchmarkRowsByCode(benchmarkRows) {
  const grouped = new Map();
  DIRECT_SUPABASE_BENCHMARK_OPTIONS.forEach((item) => {
    grouped.set(item.code, []);
  });

  benchmarkRows.forEach((row) => {
    if (!grouped.has(row.index_code)) {
      grouped.set(row.index_code, []);
    }
    grouped.get(row.index_code).push(row);
  });

  return grouped;
}

function buildDefaultStartDate(funds) {
  const maxDates = funds
    .map((item) => item.max_date)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  if (!maxDates.length) {
    return formatDateOnlyValue(new Date());
  }

  const latestDate = parseDateOnly(maxDates[maxDates.length - 1]);
  if (!latestDate) {
    return formatDateOnlyValue(new Date());
  }

  return formatDateOnlyValue(addDays(latestDate, -180));
}

function alignBenchmarkSeriesToDates(dateIndex, rows) {
  const aligned = [];
  let pointer = 0;
  let lastClose = null;

  dateIndex.forEach((date) => {
    while (pointer < rows.length && rows[pointer].trade_date <= date) {
      const nextClose = toFiniteNumber(rows[pointer].close_price);
      if (nextClose != null) {
        lastClose = nextClose;
      }
      pointer += 1;
    }

    aligned.push(lastClose);
  });

  return aligned;
}

function forwardFillDateSeries(dateIndex, valuesByDate) {
  let lastValue = null;
  return dateIndex.map((date) => {
    if (valuesByDate.has(date)) {
      const nextValue = toFiniteNumber(valuesByDate.get(date));
      if (nextValue != null) {
        lastValue = nextValue;
      }
    }
    return lastValue;
  });
}

function getLastValueOnOrBefore(rows, cutoffDate, getter) {
  let lastValue = null;

  for (const row of rows) {
    if (row.net_date > cutoffDate) {
      break;
    }

    const value = toFiniteNumber(getter(row));
    if (value != null) {
      lastValue = value;
    }
  }

  return lastValue;
}

function computeDrawdownSeries(values) {
  if (!Array.isArray(values) || !values.length) {
    return [];
  }

  let runningMax = null;
  return values.map((value) => {
    const numeric = toFiniteNumber(value);
    if (numeric == null || numeric <= 0) {
      return 0;
    }

    runningMax = runningMax == null ? numeric : Math.max(runningMax, numeric);
    if (!(runningMax > 0)) {
      return 0;
    }

    return safeFloat(((runningMax - numeric) / runningMax) * 100, 6) || 0;
  });
}

function loadSavedPortfolios() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => sanitizePortfolioRecord(item))
      .filter(Boolean)
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  } catch (error) {
    return [];
  }
}

function saveSavedPortfolios(portfolios) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolios, null, 2));
  } catch (error) {
    throw new Error("当前浏览器无法写入 localStorage，保存 FOF 组合失败。");
  }
}

function sanitizePortfolioRecord(item) {
  const id = String(item?.id || "").trim();
  const name = String(item?.name || "").trim();
  const requestedStartDate = formatDateOnlyValue(item?.requested_start_date);
  const createdAt = String(item?.created_at || "").trim();

  if (!id || !name || !requestedStartDate) {
    return null;
  }

  const members = Array.isArray(item?.members)
    ? item.members.map((member) => {
      const fundNameShort = String(member?.fund_name_short || "").trim();
      const inputWeight = toFiniteNumber(member?.input_weight ?? member?.weight);
      if (!fundNameShort || inputWeight == null || inputWeight <= 0) {
        return null;
      }
      return {
        fund_name_short: fundNameShort,
        input_weight: inputWeight,
      };
    }).filter(Boolean)
    : [];

  if (!members.length) {
    return null;
  }

  return {
    id,
    name,
    requested_start_date: requestedStartDate,
    created_at: createdAt || formatDateTimeValue(new Date()),
    members,
  };
}

function generatePortfolioId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID().replace(/-/g, "");
  }
  return `fof_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function parseWeight(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function updateSelectedStats() {
  const total = state.selectedFunds.reduce((sum, item) => {
    const weight = parseWeight(item.weightInput);
    return sum + (Number.isFinite(weight) ? weight : 0);
  }, 0);

  setText("selectedFundCount", String(state.selectedFunds.length));
  setText("weightTotal", total.toFixed(2));
}

function parseDateInput(value) {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    throw new Error("开始时间格式不正确，请使用 YYYY-MM-DD。");
  }
  return formatDateOnlyValue(parsed);
}

function parseDateOnly(value) {
  if (value instanceof Date) {
    const copy = new Date(value.getTime());
    return Number.isNaN(copy.getTime()) ? null : copy;
  }

  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatDateOnlyValue(value) {
  const date = parseDateOnly(value);
  if (!date) {
    if (typeof value === "string") {
      const match = value.match(/\d{4}-\d{2}-\d{2}/);
      return match ? match[0] : null;
    }
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTimeValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function getMinDate(values) {
  return values.filter(Boolean).sort((a, b) => a.localeCompare(b))[0] || null;
}

function getMaxDate(values) {
  const ordered = values.filter(Boolean).sort((a, b) => a.localeCompare(b));
  return ordered.length ? ordered[ordered.length - 1] : null;
}

function getMaxNumber(values) {
  return values.reduce((maxValue, value) => {
    const numeric = toFiniteNumber(value);
    if (numeric == null) {
      return maxValue;
    }
    return maxValue == null ? numeric : Math.max(maxValue, numeric);
  }, null);
}

function safeFloat(value, digits = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number(numeric.toFixed(digits));
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function formatValue(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) {
    return "--";
  }
  return Number(value).toFixed(digits);
}

function formatPercent(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) {
    return "--";
  }
  return `${Number(value).toFixed(digits)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttr(value) {
  return escapeHtml(value);
}

function showStatus(message, type = "info", keep = false) {
  const statusBar = document.getElementById("statusBar");
  statusBar.textContent = message;
  statusBar.className = `status-bar ${type} visible`;

  if (!keep && (type === "success" || type === "info")) {
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => {
      statusBar.className = "status-bar";
      statusBar.textContent = "";
    }, 3500);
  }
}
