// script.js (최종 검증 및 완전체 버전)

document.addEventListener('DOMContentLoaded', function () {
    console.log("DOM 로드 완료. 스크립트 초기화 시작 (최종 테스트 Ver.)");

    // --- CONFIGURATION ---
    const INDICATORS = {
        date: { name: '날짜' },
        market_index: { name: 'S&P 500 (SPY)', color: '#007AFF', yAxisIndex: 0, format: (v) => v.toFixed(2) },
        usd_krw: { name: '환율', color: '#FF9500', yAxisIndex: 1, format: (v) => v.toFixed(2) },
        base_rate: { name: '기준금리', color: '#34C759', yAxisIndex: 1, format: (v) => v.toFixed(2) + '%' },
        cpi_raw: { name: '소비자물가지수', color: '#FF3B30', yAxisIndex: 0, format: (v) => v.toFixed(2) },
        m1_raw: { name: 'M1 통화량(십억)', color: '#AF52DE', yAxisIndex: 0, format: (v) => v.toLocaleString() },
    };
    const MAIN_CHART_INDICATORS = ['market_index', 'usd_krw', 'base_rate', 'cpi_raw'];
    const TABLE_PAGE_SIZE = 10;
    const ECOS_CODES = {
        base_rate: { statcode: '722Y001', itemcode: '0100000', cycle: 'D' },
        cpi_raw: { statcode: '901Y001', itemcode: '0', cycle: 'M' },
        m1_raw: { statcode: '101Y001', itemcode: 'AAMA01', cycle: 'M' },
    };

    // --- STATE, DOM, CHART Instances ---
    let fullData = [], currentData = [], currentPage = 1, availableIndicators = [];
    const loadingOverlay = document.getElementById('loading-overlay');
    const apiKeySection = document.getElementById('api-key-section');
    const dashboardContainer = document.getElementById('dashboard-main-container');
    const ecosApiKeyInput = document.getElementById('ecos-api-key');
    const marketApiKeyInput = document.getElementById('market-api-key');
    const loadDataBtn = document.getElementById('load-data-btn');
    const dateRangePickerEl = document.getElementById('date-range');
    const indicatorTogglesEl = document.getElementById('indicator-toggles');
    const refreshBtn = document.getElementById('refresh-btn');
    const dualAxisToggle = document.getElementById('dual-axis-toggle');
    const scatterPlotEl = document.getElementById('scatter-plot');
    const downloadCsvBtn = document.getElementById('download-csv');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const pageInfoEl = document.getElementById('page-info');

    const mainChart = echarts.init(document.getElementById('main-timeseries-chart'));
    const monthlyReturnHeatmap = echarts.init(document.getElementById('monthly-return-heatmap'));
    const scatterPlot = echarts.init(scatterPlotEl);
    const sparklineCharts = {};

    // --- API & DATA HANDLING ---
    async function fetchEcosData(apiKey, codeInfo, startDate, endDate) {
        const params = new URLSearchParams({ apikey: apiKey, statcode: codeInfo.statcode, cycle: codeInfo.cycle, start: startDate, end: endDate, itemcode: codeInfo.itemcode });
        const url = `/api/ecos?${params.toString()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.details || data.error);
        if (data.StatisticSearch && data.StatisticSearch.row) {
            return data.StatisticSearch.row.map(item => ({ date: item.TIME.replace(/(\d{4})([Q])?(\d{2})(\d{2})?/, (match, p1, p2, p3) => p2 === 'Q' ? `${p1}-Q${p3}` : `${p1}-${p3}`).slice(0, 10), value: parseFloat(item.DATA_VALUE) }));
        } return [];
    }
    async function fetchAlphaData(apiKey, type, symbol) {
        const func = type === 'stock' ? 'TIME_SERIES_DAILY_ADJUSTED' : 'FX_DAILY';
        const params = new URLSearchParams({ func, symbol, apikey: apiKey });
        const url = `/api/alpha?${params.toString()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.details || data.error);
        const timeSeriesKey = Object.keys(data).find(k => k.includes('Time Series') || k.includes('FX Daily'));
        if (!timeSeriesKey || !data[timeSeriesKey]) { throw new Error(data['Information'] || data['Error Message'] || 'Invalid data structure'); }
        const timeSeries = data[timeSeriesKey];
        return Object.keys(timeSeries).map(date => {
            const entry = timeSeries[date];
            const closeKey = Object.keys(entry).find(k => k.includes('adjusted close') || k.includes('close'));
            return { date: date, value: parseFloat(entry[closeKey]) };
        });
    }
    function mergeData(dataStreams) {
        const dataMap = new Map();
        const allDataPoints = Object.values(dataStreams).flat();
        if (allDataPoints.length === 0) return [];
        let minDateStr = "9999-12-31", maxDateStr = "1900-01-01";
        allDataPoints.forEach(d => { if (d.date < minDateStr) minDateStr = d.date; if (d.date > maxDateStr) maxDateStr = d.date; });
        for (let d = new Date(minDateStr); d <= new Date(maxDateStr); d.setDate(d.getDate() + 1)) {
            dataMap.set(d.toISOString().slice(0, 10), { date: d.toISOString().slice(0, 10) });
        }
        for (const key in dataStreams) {
            const cycle = ECOS_CODES[key]?.cycle;
            dataStreams[key].forEach(item => {
                if (cycle === 'M' || cycle === 'Q') {
                    const itemDate = new Date(item.date.replace(/-Q(\d)/, (m, q) => `-${(q*3-2).toString().padStart(2,'0')}-01`));
                    const year = itemDate.getFullYear();
                    const period = cycle === 'M' ? itemDate.getMonth() : Math.floor(itemDate.getMonth() / 3);
                    for (const [dateOnMap, entry] of dataMap.entries()) {
                        const mapDate = new Date(dateOnMap);
                        const mapYear = mapDate.getFullYear();
                        const mapPeriod = cycle === 'M' ? mapDate.getMonth() : Math.floor(mapDate.getMonth() / 3);
                        if (mapYear === year && mapPeriod === period) { entry[key] = item.value; }
                    }
                } else { if (dataMap.has(item.date)) { dataMap.get(item.date)[key] = item.value; } }
            });
        }
        let lastValues = {};
        return Array.from(dataMap.values()).sort((a, b) => new Date(a.date) - new Date(b.date)).map(entry => {
            for (const key in INDICATORS) {
                if (key === 'date') continue;
                if (entry[key] !== undefined && entry[key] !== null) { lastValues[key] = entry[key]; }
                else if (lastValues[key] !== undefined) { entry[key] = lastValues[key]; }
                else { entry[key] = null; }
            }
            return entry;
        });
    }

    // --- INITIALIZATION & EVENT LISTENERS ---
    function init() {
        console.log("init 함수 실행.");
        if (!loadDataBtn) { console.error("CRITICAL: '데이터 불러오기' 버튼을 찾을 수 없습니다."); return; }
        ecosApiKeyInput.value = localStorage.getItem('ecosApiKey') || '';
        marketApiKeyInput.value = localStorage.getItem('marketApiKey') || '';
        loadDataBtn.addEventListener('click', loadAndInitializeDashboard);
        refreshBtn.addEventListener('click', () => updateDashboard(false));
    }

    // --- LOAD & INITIALIZE DASHBOARD ---
    async function loadAndInitializeDashboard() {
        console.log("'데이터 불러오기' 버튼 클릭됨.");
        const ecosKey = ecosApiKeyInput.value.trim();
        const marketKey = marketApiKeyInput.value.trim();
        if (!ecosKey || !marketKey) { alert('두 개의 API 키를 모두 입력해야 합니다.'); return; }
        localStorage.setItem('ecosApiKey', ecosKey);
        localStorage.setItem('marketApiKey', marketKey);
        loadingOverlay.classList.remove('hidden');

        try {
            const today = new Date();
            const endDate = today.toISOString().slice(0, 10);
            const startDateDt = new Date();
            startDateDt.setFullYear(today.getFullYear() - 5);
            const startDate = startDateDt.toISOString().slice(0, 10);
            const ecosDailyStartDate = startDate.replace(/-/g, '');
            const ecosDailyEndDate = endDate.replace(/-/g, '');
            const ecosMonthlyStartDate = startDate.slice(0, 7).replace('-', '');
            const ecosMonthlyEndDate = endDate.slice(0, 7).replace('-', '');
            const startYear = startDateDt.getFullYear();
            const startQuarter = Math.floor(startDateDt.getMonth() / 3) + 1;
            const endYear = today.getFullYear();
            const endQuarter = Math.floor(today.getMonth() / 3) + 1;
            const ecosQuarterlyStartDate = `${startYear}Q${startQuarter}`;
            const ecosQuarterlyEndDate = `${endYear}Q${endQuarter}`;

            const dataPromises = {
                market_index: fetchAlphaData(marketKey, 'stock', 'SPY'),
                usd_krw: fetchAlphaData(marketKey, 'fx', 'USD/KRW'),
                base_rate: fetchEcosData(ecosKey, ECOS_CODES.base_rate, ecosDailyStartDate, ecosDailyEndDate),
                gdp_private_consumption: fetchEcosData(ecosKey, ECOS_CODES.gdp_private_consumption, ecosQuarterlyStartDate, ecosQuarterlyEndDate),
                m1_raw: fetchEcosData(ecosKey, ECOS_CODES.m1_raw, ecosMonthlyStartDate, ecosMonthlyEndDate),
            };

            const results = await Promise.allSettled(Object.values(dataPromises));
            const dataStreams = {};
            availableIndicators = [];
            results.forEach((result, index) => {
                const key = Object.keys(dataPromises)[index];
                if (result.status === 'fulfilled' && result.value.length > 0) {
                    console.log(`✅ ${key} 데이터 로딩 성공`);
                    dataStreams[key] = result.value;
                    availableIndicators.push(key);
                } else {
                    console.error(`❌ ${key} 데이터 로딩 실패:`, result.reason || '데이터 없음');
                    const kpiCard = document.getElementById(`kpi-${key}`);
                    if (kpiCard) { kpiCard.classList.add('disabled'); kpiCard.querySelector('.value').textContent = 'N/A'; kpiCard.querySelector('.change').textContent = '데이터 로딩 실패'; }
                }
            });

            if (availableIndicators.length === 0) throw new Error("모든 API에서 데이터를 불러오는 데 실패했습니다.");
            fullData = mergeData(dataStreams);
            if (fullData.length === 0) throw new Error("유효한 데이터를 병합하는 데 실패했습니다.");
            
            setupDashboardUI();
            updateDashboard(true);
            apiKeySection.classList.add('hidden');
            dashboardContainer.classList.remove('hidden');

        } catch (error) {
            alert(`대시보드 초기화 실패: ${error.message}`);
            console.error(error);
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    }
    
    // --- UI UPDATE FUNCTIONS ---
    function setupDashboardUI() {
        indicatorTogglesEl.innerHTML = '';
        MAIN_CHART_INDICATORS.forEach(key => {
            if (availableIndicators.includes(key)) {
                const isChecked = ['market_index', 'base_rate'].includes(key);
                const label = document.createElement('label');
                label.innerHTML = `<input type="checkbox" name="indicator" value="${key}" ${isChecked ? 'checked' : ''}> ${INDICATORS[key].name}`;
                indicatorTogglesEl.appendChild(label);
            }
        });
        indicatorTogglesEl.querySelectorAll('input').forEach(toggle => toggle.addEventListener('change', updateMainChart));
        if (dualAxisToggle) dualAxisToggle.addEventListener('change', updateMainChart);
        
        const lastDate = fullData[fullData.length - 1].date;
        const oneYearAgo = new Date(lastDate);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        flatpickr(dateRangePickerEl, { mode: "range", dateFormat: "Y-m-d", defaultDate: [oneYearAgo.toISOString().slice(0, 10), lastDate], minDate: fullData[0].date, maxDate: lastDate });
    }

    function updateDashboard() {
        const dateRange = dateRangePickerEl.value.split(' to ');
        if (dateRange.length < 2) return;
        currentData = fullData.filter(d => d.date >= dateRange[0] && d.date <= dateRange[1]);
        if (currentData.length === 0) { return; }
        currentPage = 1;
        
        updateKpiCards();
        updateMainChart();
        updateSubCharts();
        updateDataTable();
    }

    function updateKpiCards() {
        const latest = currentData[currentData.length - 1];
        const prev = currentData.length > 1 ? currentData[currentData.length - 2] : latest;
        availableIndicators.forEach(key => {
            const cardEl = document.getElementById(`kpi-${key}`);
            if (!cardEl || latest[key] === null) return;
            const value = latest[key];
            cardEl.querySelector('.value').textContent = INDICATORS[key].format(value);
            if ((key === 'market_index' || key === 'usd_krw') && prev[key] !== null) {
                const change = value - prev[key];
                const percent = (value / prev[key] - 1) * 100;
                cardEl.querySelector('.change').textContent = `${percent.toFixed(2)}%`;
                cardEl.querySelector('.change').className = `change ${change >= 0 ? 'positive' : 'negative'}`;
            } else {
                 cardEl.querySelector('.change').textContent = '--';
            }
            renderSparkline(`sparkline-${key}`, currentData.map(d => d[key]), INDICATORS[key].color);
        });
    }

    function updateMainChart() {
        const selectedIndicators = Array.from(document.querySelectorAll('#indicator-toggles input:checked')).map(cb => cb.value).filter(key => availableIndicators.includes(key));
        const useDualAxis = dualAxisToggle ? dualAxisToggle.checked : true;
        const series = selectedIndicators.map(key => ({ name: INDICATORS[key].name, type: 'line', yAxisIndex: useDualAxis ? INDICATORS[key].yAxisIndex : 0, data: currentData.map(d => d[key]), showSymbol: false, color: INDICATORS[key].color }));
        const yAxis = useDualAxis ? [{ type: 'value', name: '주가지수/금액' }, { type: 'value', name: '환율/금리(%)', position: 'right' }] : [{ type: 'value' }];
        mainChart.setOption({ tooltip: { trigger: 'axis' }, legend: { data: selectedIndicators.map(key => INDICATORS[key].name) }, grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true }, xAxis: { type: 'category', data: currentData.map(d => d.date) }, yAxis, series, dataZoom: [{ type: 'inside' }, { type: 'slider' }] }, true);
    }
    
    function updateSubCharts() {
        if (availableIndicators.includes('market_index')) {
            const monthlyReturns = {};
            for (let i = 1; i < currentData.length; i++) { if (!currentData[i].market_index || !currentData[i-1].market_index) continue; const date = new Date(currentData[i].date); const year = date.getFullYear(); const month = date.getMonth(); if (!monthlyReturns[year]) monthlyReturns[year] = {}; if (!monthlyReturns[year][month]) monthlyReturns[year][month] = { start: currentData[i - 1].market_index, end: 0 }; monthlyReturns[year][month].end = currentData[i].market_index; }
            const heatmapData = []; const years = Object.keys(monthlyReturns).sort();
            years.forEach(year => { for (let month = 0; month < 12; month++) { if (monthlyReturns[year] && monthlyReturns[year][month]) { const monthData = monthlyReturns[year][month]; const monthlyReturn = (monthData.end / monthData.start - 1) * 100; heatmapData.push([years.indexOf(year), month, monthlyReturn]); } } });
            monthlyReturnHeatmap.setOption({ tooltip: { formatter: (p) => `${years[p.data[0]]}년 ${p.data[1] + 1}월: ${p.data[2].toFixed(2)}%` }, grid: { height: '60%', top: '10%' }, xAxis: { type: 'category', data: years }, yAxis: { type: 'category', data: '1월,2월,3월,4월,5월,6월,7월,8월,9월,10월,11월,12월'.split(',') }, visualMap: { min: -10, max: 10, calculable: true, orient: 'horizontal', left: 'center', bottom: '0%', inRange: { color: ['#FF3B30', '#ffffff', '#34C759'] } }, series: [{ type: 'heatmap', data: heatmapData, label: { show: true, formatter: (p) => p.value[2].toFixed(1) } }] });
        } else { monthlyReturnHeatmap.clear(); }
        
        if (availableIndicators.includes('market_index') && availableIndicators.includes('usd_krw')) {
            scatterPlot.setOption({ grid: { containLabel: true }, tooltip: { trigger: 'item', formatter: (p) => `${INDICATORS.market_index.name}: ${p.value[0].toFixed(2)}<br/>${INDICATORS.usd_krw.name}: ${p.value[1].toFixed(2)}` }, xAxis: { type: 'value', name: INDICATORS.market_index.name, scale: true }, yAxis: { type: 'value', name: INDICATORS.usd_krw.name, scale: true }, series: [{ symbolSize: 8, data: currentData.map(d => [d.market_index, d.usd_krw]), type: 'scatter' }] });
        } else { scatterPlot.clear(); }
    }

    function updateDataTable() {
        const tableBody = document.querySelector('#data-table tbody'); const tableHead = document.querySelector('#data-table thead');
        tableBody.innerHTML = ''; tableHead.innerHTML = ''; if (currentData.length === 0) return;
        const headers = Object.keys(INDICATORS).filter(key => availableIndicators.includes(key));
        const headerRow = document.createElement('tr'); headers.forEach(key => { const th = document.createElement('th'); th.textContent = INDICATORS[key].name; headerRow.appendChild(th); });
        tableHead.appendChild(headerRow);
        const pageData = currentData.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE);
        pageData.forEach(rowData => { const row = document.createElement('tr'); headers.forEach(key => { const cell = document.createElement('td'); const value = rowData[key]; cell.textContent = value !== null && value !== undefined ? (INDICATORS[key].format ? INDICATORS[key].format(value) : value) : 'N/A'; row.appendChild(cell); }); tableBody.appendChild(row); });
        const maxPage = Math.ceil(currentData.length / TABLE_PAGE_SIZE);
        pageInfoEl.textContent = `Page ${currentPage} of ${maxPage}`;
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === maxPage;
    }
    function renderSparkline(id, data, color) { const chartEl = document.getElementById(id); if (!chartEl) return; if (!sparklineCharts[id]) sparklineCharts[id] = echarts.init(chartEl); sparklineCharts[id].setOption({ grid: { top: 5, bottom: 5, left: 5, right: 5 }, xAxis: { type: 'category', show: false }, yAxis: { type: 'value', show: false }, series: [{ type: 'line', data, showSymbol: false, lineStyle: { color, width: 2 } }] }); }
    function downloadCSV() { if (currentData.length === 0) return; const headers = Object.keys(INDICATORS).filter(k => availableIndicators.includes(k)); const csvString = [headers.map(k => INDICATORS[k].name).join(','), ...currentData.map(row => headers.map(k => row[k] ?? 'N/A').join(','))].join('\n'); const blob = new Blob([`\uFEFF${csvString}`], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'economic_data.csv'; document.body.appendChild(link); link.click(); document.body.removeChild(link); }

    // --- Start the App ---
    init();
});