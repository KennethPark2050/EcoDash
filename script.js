document.addEventListener('DOMContentLoaded', function () {
    console.log("DOM 로드 완료. 스크립트 초기화 시작.");

    // --- CONFIGURATION ---
    const INDICATORS = {
        date: { name: '날짜' },
        kospi: { name: 'KOSPI(대용)', color: '#007AFF', yAxisIndex: 0, format: (v) => v.toFixed(2) },
        usd_krw: { name: '환율', color: '#FF9500', yAxisIndex: 1, format: (v) => v.toFixed(2) },
        cpi: { name: 'CPI(YoY)', color: '#34C759', yAxisIndex: 1, format: (v) => v.toFixed(2) + '%' },
        bond_10y: { name: '국고채10Y', color: '#FF3B30', yAxisIndex: 1, format: (v) => v.toFixed(2) + '%' },
        bond_3y: { name: '국고채3Y', color: '#5856D6', yAxisIndex: 1, format: (v) => v.toFixed(2) + '%' },
        m2: { name: 'M2(YoY)', color: '#AF52DE', yAxisIndex: 1, format: (v) => v.toFixed(2) + '%' },
    };
    const MAIN_CHART_INDICATORS = ['kospi', 'cpi', 'bond_10y', 'usd_krw', 'm2'];
    const SCATTER_OPTIONS = ['kospi', 'usd_krw', 'cpi', 'bond_10y', 'm2'];
    const TABLE_PAGE_SIZE = 10;
    const ECOS_CODES = {
        cpi: { statcode: '901Y001', itemcode: '0', cycle: 'M' },
        bond_10y: { statcode: '060Y001', itemcode: '0102000', cycle: 'D' },
        bond_3y: { statcode: '060Y001', itemcode: '0101000', cycle: 'D' },
        m2: { statcode: '002Y008', itemcode: 'BBMA01', cycle: 'M', yoy: true },
    };

    // --- STATE ---
    let fullData = [];
    let currentData = [];
    let currentPage = 1;
    let availableIndicators = [];

    // --- DOM ELEMENTS ---
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
    const scatterXSelect = document.getElementById('scatter-x');
    const scatterYSelect = document.getElementById('scatter-y');
    const downloadCsvBtn = document.getElementById('download-csv');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const pageInfoEl = document.getElementById('page-info');

    // --- CHART INSTANCES ---
    const mainChart = echarts.init(document.getElementById('main-timeseries-chart'));
    const monthlyReturnHeatmap = echarts.init(document.getElementById('monthly-return-heatmap'));
    const yieldSpreadChart = echarts.init(document.getElementById('yield-spread-chart'));
    const scatterPlot = echarts.init(document.getElementById('scatter-plot'));
    const sparklineCharts = {};
    
    // --- API & DATA HANDLING ---
    async function fetchEcosData(apiKey, codeInfo, startDate, endDate) {
        const params = new URLSearchParams({ apikey: apiKey, statcode: codeInfo.statcode, cycle: codeInfo.cycle, start: startDate, end: endDate, itemcode: codeInfo.itemcode });
        const url = `/api/ecos?${params.toString()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        if (data.StatisticSearch && data.StatisticSearch.row) {
            let parsed = data.StatisticSearch.row.map(item => ({ date: item.TIME.replace(/(\d{4})(\d{2})(\d{2})?/, '$1-$2-$3').slice(0, 10), value: parseFloat(item.DATA_VALUE) }));
            if (codeInfo.yoy) { parsed = parsed.map((item, i, arr) => { if (i < 12) return { ...item, value: null }; const prevYearValue = arr[i - 12].value; const yoy = prevYearValue ? ((item.value / prevYearValue - 1) * 100) : null; return { ...item, value: yoy }; }).filter(item => item.value !== null); }
            return parsed;
        } return [];
    }

    async function fetchAlphaData(apiKey, type, symbol) {
        const func = type === 'stock' ? 'TIME_SERIES_DAILY' : 'FX_DAILY';
        const params = new URLSearchParams({ func, symbol, apikey: apiKey });
        const url = `/api/alpha?${params.toString()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        const timeSeriesKey = Object.keys(data).find(k => k.includes('Time Series') || k.includes('FX Daily'));
        if (!timeSeriesKey || !data[timeSeriesKey]) { console.warn(`Alpha Vantage: No data for ${symbol}`, data); return []; }
        const timeSeries = data[timeSeriesKey];
        return Object.keys(timeSeries).map(date => { const entry = timeSeries[date]; const closeKey = Object.keys(entry).find(k => k.includes('close')); return { date: date, value: parseFloat(entry[closeKey]) }; });
    }

    function mergeData(dataStreams) {
        const dataMap = new Map();
        const dailyData = Object.values(dataStreams).flat();
        const allDates = [...new Set(dailyData.map(d => d.date))].sort();
        allDates.forEach(date => dataMap.set(date, { date }));
        for (const key in dataStreams) {
            const isMonthly = ECOS_CODES[key] && ECOS_CODES[key].cycle === 'M';
            dataStreams[key].forEach(item => {
                if (isMonthly) {
                    const yearMonth = item.date.slice(0, 7);
                    for (const dateOnMap of dataMap.keys()) {
                        if (dateOnMap.startsWith(yearMonth)) {
                            const entry = dataMap.get(dateOnMap); entry[key] = item.value; dataMap.set(dateOnMap, entry);
                        }
                    }
                } else { if (dataMap.has(item.date)) { const entry = dataMap.get(item.date); entry[key] = item.value; dataMap.set(item.date, entry); } }
            });
        }
        let lastValues = {};
        return Array.from(dataMap.values()).map(entry => { for (const key in INDICATORS) { if (key === 'date') continue; if (entry[key] !== undefined) { lastValues[key] = entry[key]; } else if (lastValues[key] !== undefined) { entry[key] = lastValues[key]; } else { entry[key] = null; } } return entry; }).filter(d => Object.keys(d).length > 2);
    }

    // --- INITIALIZATION & EVENT LISTENERS ---
    function init() {
        console.log("init 함수 실행. 이벤트 리스너 등록 시도.");
        if (!loadDataBtn) { console.error("CRITICAL: '데이터 불러오기' 버튼을 찾을 수 없습니다. HTML의 id가 'load-data-btn'인지 확인하세요."); return; }
        
        ecosApiKeyInput.value = localStorage.getItem('ecosApiKey') || '';
        marketApiKeyInput.value = localStorage.getItem('marketApiKey') || '';
        
        loadDataBtn.addEventListener('click', () => { console.log("'데이터 불러오기' 버튼 클릭됨. 데이터 로딩 시작."); loadAndInitializeDashboard(); });
        refreshBtn.addEventListener('click', () => updateDashboard(false));
        dualAxisToggle.addEventListener('change', updateMainChart);
        [scatterXSelect, scatterYSelect].forEach(select => select.addEventListener('change', updateScatterPlot));
        downloadCsvBtn.addEventListener('click', downloadCSV);
        prevPageBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; updateDataTable(); } });
        nextPageBtn.addEventListener('click', () => { if (currentPage < Math.ceil(currentData.length / TABLE_PAGE_SIZE)) { currentPage++; updateDataTable(); } });
        
        console.log("이벤트 리스너 등록 완료.");
    }

// script.js 파일의 이 함수만 교체하세요!

async function loadAndInitializeDashboard() {
    const ecosKey = ecosApiKeyInput.value.trim();
    const marketKey = marketApiKeyInput.value.trim();
    if (!ecosKey || !marketKey) { alert('두 개의 API 키를 모두 입력해야 합니다.'); return; }
    
    localStorage.setItem('ecosApiKey', ecosKey);
    localStorage.setItem('marketApiKey', marketKey);
    loadingOverlay.classList.remove('hidden');

    try {
        // --- 날짜 설정 최종 수정 (이 부분이 가장 중요합니다) ---
        const today = new Date();
        const endDate = today.toISOString().slice(0, 10); // 오늘 날짜 (예: "2024-06-20")
        
        const startDateDt = new Date();
        startDateDt.setFullYear(today.getFullYear() - 5); // 오늘로부터 5년 전
        const startDate = startDateDt.toISOString().slice(0, 10);
        
        // ECOS API용 날짜 형식 (오늘 날짜 기준)
        const ecosDailyStartDate = startDate.replace(/-/g, ''); // YYYYMMDD
        const ecosDailyEndDate = endDate.replace(/-/g, '');   // YYYYMMDD

        const ecosMonthlyStartDate = startDate.slice(0, 7).replace('-', ''); // YYYYMM
        const ecosMonthlyEndDate = endDate.slice(0, 7).replace('-', '');     // YYYYMM
        // --- 날짜 설정 종료 ---

        const dataPromises = {
            // 이 요청은 Alpha Vantage 무료 플랜 제약으로 실패할 수 있습니다. (정상)
            kospi: fetchAlphaData(marketKey, 'stock', '069500.KS'), 
            
            // 이 요청은 성공할 것입니다.
            usd_krw: fetchAlphaData(marketKey, 'fx', 'USD/KRW'), 
            
            // ECOS 요청들: 수정된 날짜 형식으로 요청합니다.
            cpi: fetchEcosData(ecosKey, ECOS_CODES.cpi, ecosMonthlyStartDate, ecosMonthlyEndDate), 
            bond_10y: fetchEcosData(ecosKey, ECOS_CODES.bond_10y, ecosDailyStartDate, ecosDailyEndDate), 
            bond_3y: fetchEcosData(ecosKey, ECOS_CODES.bond_3y, ecosDailyStartDate, ecosDailyEndDate), 
            m2: fetchEcosData(ecosKey, ECOS_CODES.m2, ecosMonthlyStartDate, ecosMonthlyEndDate), 
        };

        // 이 아래 부분은 이미 완벽하므로 수정할 필요 없습니다.
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
                const kpiCard = document.getElementById(`kpi-${key.replace('_', '-')}`);
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
    function setupDashboardUI() {
        indicatorTogglesEl.innerHTML = '';
        MAIN_CHART_INDICATORS.forEach(key => {
            if (availableIndicators.includes(key)) {
                const isChecked = ['kospi', 'cpi'].includes(key) && availableIndicators.includes(key);
                const label = document.createElement('label');
                label.innerHTML = `<input type="checkbox" name="indicator" value="${key}" ${isChecked ? 'checked' : ''}> ${INDICATORS[key].name}`;
                indicatorTogglesEl.appendChild(label);
            }
        });
        indicatorTogglesEl.querySelectorAll('input').forEach(toggle => toggle.addEventListener('change', updateMainChart));
        
        scatterXSelect.innerHTML = '';
        scatterYSelect.innerHTML = '';
        SCATTER_OPTIONS.forEach(key => {
            if (availableIndicators.includes(key)) {
                scatterXSelect.innerHTML += `<option value="${key}">${INDICATORS[key].name}</option>`;
                scatterYSelect.innerHTML += `<option value="${key}">${INDICATORS[key].name}</option>`;
            }
        });
        if (availableIndicators.includes('kospi')) scatterXSelect.value = 'kospi';
        if (availableIndicators.includes('usd_krw')) scatterYSelect.value = 'usd_krw';
        
        const lastDate = fullData[fullData.length - 1].date;
        const oneYearAgo = new Date(lastDate);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        flatpickr(dateRangePickerEl, { mode: "range", dateFormat: "Y-m-d", defaultDate: [oneYearAgo.toISOString().slice(0, 10), lastDate], minDate: fullData[0].date, maxDate: lastDate });
    }

    function updateDashboard(isFirstLoad) {
        const dateRange = dateRangePickerEl.value.split(' to ');
        if (dateRange.length < 2) return;
        currentData = fullData.filter(d => d.date >= dateRange[0] && d.date <= dateRange[1]);
        currentPage = 1;
        if (currentData.length === 0) { alert('선택된 기간에 데이터가 없습니다.'); return; }
        updateKpiCards();
        updateMainChart();
        updateSubCharts();
        updateScatterPlot();
        updateDataTable();
    }
    
    // ... 이하 모든 update/render 함수는 이전 답변의 최종본과 동일하여 생략 ...
    // updateKpiCards, updateMainChart, updateSubCharts, updateScatterPlot, updateDataTable,
    // updateCard, renderSparkline, downloadCSV 함수들을 여기에 붙여넣으세요.
    // 간결함을 위해 아래에 다시 첨부합니다.

    function updateKpiCards() { /* ... */ } // 아래 함수들로 채워주세요.
    function updateMainChart() { /* ... */ }
    function updateSubCharts() { /* ... */ }
    function updateScatterPlot() { /* ... */ }
    function updateDataTable() { /* ... */ }
    function updateCard(id, value, change, percent, digits) { /* ... */ }
    function renderSparkline(id, data, color) { /* ... */ }
    function downloadCSV() { /* ... */ }

    // --- Start the App ---
    init();
});


// =============================================================
// 위 스크립트의 생략된 함수들을 여기에 붙여넣어 완성하세요.
// =============================================================
function updateKpiCards() {
    const latest = currentData[currentData.length - 1];
    const prev = currentData.length > 1 ? currentData[currentData.length - 2] : latest;
    availableIndicators.forEach(key => {
        if (latest[key] === undefined || latest[key] === null) return;
        const kpiId = `kpi-${key.replace('_', '-')}`;
        const cardEl = document.getElementById(kpiId);
        if (!cardEl) return;
        if (key === 'kospi' || key === 'usd_krw') { updateCard(kpiId, latest[key], latest[key] - prev[key], (latest[key] / prev[key] - 1) * 100, 2); }
        else if (key === 'cpi' || key === 'm2') { cardEl.querySelector('.value').textContent = `${latest[key].toFixed(2)}%`; cardEl.querySelector('.change').textContent = `(YoY)`; }
        else if (key.includes('bond')) { const bondChange = latest[key] - prev[key]; cardEl.querySelector('.value').textContent = `${latest[key].toFixed(2)}%`; cardEl.querySelector('.change').textContent = `${bondChange.toFixed(3)}p`; cardEl.querySelector('.change').className = `change ${bondChange >= 0 ? 'positive' : 'negative'}`; }
        renderSparkline(`sparkline-${key.replace('_', '-')}`, currentData.map(d => d[key]), INDICATORS[key].color);
    });
}
function updateMainChart() {
    const selectedIndicators = Array.from(document.querySelectorAll('#indicator-toggles input:checked')).map(cb => cb.value).filter(key => currentData.length > 0 && currentData[0][key] !== undefined);
    const useDualAxis = document.getElementById('dual-axis-toggle').checked;
    const series = selectedIndicators.map(key => ({ name: INDICATORS[key].name, type: 'line', yAxisIndex: useDualAxis ? INDICATORS[key].yAxisIndex : 0, data: currentData.map(d => d[key]), showSymbol: false, color: INDICATORS[key].color, emphasis: { focus: 'series' } }));
    const yAxis = useDualAxis ? [{ type: 'value', name: '주가지수/금액', axisLine: { show: true } }, { type: 'value', name: '환율/금리(%)', axisLine: { show: true } }] : [{ type: 'value' }];
    echarts.init(document.getElementById('main-timeseries-chart')).setOption({ tooltip: { trigger: 'axis' }, legend: { data: selectedIndicators.map(key => INDICATORS[key].name) }, grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true }, xAxis: { type: 'category', data: currentData.map(d => d.date) }, yAxis, series, dataZoom: [{ type: 'inside' }, { type: 'slider' }] }, true);
}
function updateSubCharts() {
    const monthlyReturnHeatmap = echarts.init(document.getElementById('monthly-return-heatmap'));
    if (availableIndicators.includes('kospi')) {
        const monthlyReturns = {};
        for (let i = 1; i < currentData.length; i++) { const date = new Date(currentData[i].date); const year = date.getFullYear(); const month = date.getMonth(); if (!monthlyReturns[year]) monthlyReturns[year] = {}; if (!monthlyReturns[year][month]) monthlyReturns[year][month] = { start: currentData[i - 1].kospi, end: 0 }; monthlyReturns[year][month].end = currentData[i].kospi; }
        const heatmapData = []; const years = Object.keys(monthlyReturns).sort();
        years.forEach(year => { for (let month = 0; month < 12; month++) { if (monthlyReturns[year][month]) { const monthData = monthlyReturns[year][month]; const monthlyReturn = (monthData.end / monthData.start - 1) * 100; heatmapData.push([years.indexOf(year), month, monthlyReturn]); } } });
        monthlyReturnHeatmap.setOption({ tooltip: { formatter: (p) => `${years[p.data[0]]}년 ${p.data[1] + 1}월: ${p.data[2].toFixed(2)}%` }, grid: { height: '60%' }, xAxis: { type: 'category', data: years }, yAxis: { type: 'category', data: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'] }, visualMap: { min: -15, max: 15, calculable: true, orient: 'horizontal', left: 'center', bottom: '0%', inRange: { color: ['#FF3B30', '#ffffff', '#34C759'] } }, series: [{ type: 'heatmap', data: heatmapData, label: { show: true, formatter: (p) => p.value[2].toFixed(1) } }] });
    } else { monthlyReturnHeatmap.clear(); }
    const yieldSpreadChart = echarts.init(document.getElementById('yield-spread-chart'));
    if (availableIndicators.includes('bond_10y') && availableIndicators.includes('bond_3y')) {
        const yieldSpreadData = currentData.map(d => ({ date: d.date, value: (d.bond_10y - d.bond_3y) }));
        yieldSpreadChart.setOption({ tooltip: { trigger: 'axis' }, grid: { left: '3%', right: '10%', containLabel: true }, xAxis: { type: 'category', data: yieldSpreadData.map(d => d.date) }, yAxis: { type: 'value', name: 'Spread(%)', axisLabel: { formatter: '{value}%' } }, series: [{ name: '10Y-3Y 스프레드', type: 'line', showSymbol: false, data: yieldSpreadData.map(d => d.value.toFixed(2)), areaStyle: {}, markLine: { data: [{ yAxis: 0 }], symbol: 'none' } }] });
    } else { yieldSpreadChart.clear(); }
}
function updateScatterPlot() {
    const scatterPlot = echarts.init(document.getElementById('scatter-plot'));
    const xKey = document.getElementById('scatter-x').value; const yKey = document.getElementById('scatter-y').value;
    if (!xKey || !yKey || !availableIndicators.includes(xKey) || !availableIndicators.includes(yKey)) { scatterPlot.clear(); return; }
    const data = currentData.map(d => [d[xKey], d[yKey]]);
    scatterPlot.setOption({ grid: { containLabel: true }, tooltip: { trigger: 'item', formatter: (p) => `${INDICATORS[xKey].name}: ${p.value[0].toFixed(2)}<br/>${INDICATORS[yKey].name}: ${p.value[1].toFixed(2)}` }, xAxis: { type: 'value', name: INDICATORS[xKey].name, nameLocation: 'middle', nameGap: 25, scale: true }, yAxis: { type: 'value', name: INDICATORS[yKey].name, nameLocation: 'middle', nameGap: 50, scale: true }, series: [{ symbolSize: 8, data, type: 'scatter', color: '#007AFF' }] });
}
function updateDataTable() {
    const tableBody = document.querySelector('#data-table tbody'); const tableHead = document.querySelector('#data-table thead');
    tableBody.innerHTML = ''; tableHead.innerHTML = ''; if (currentData.length === 0) return;
    const headers = Object.keys(INDICATORS).filter(key => availableIndicators.includes(key));
    const headerRow = document.createElement('tr');
    headers.forEach(key => { const th = document.createElement('th'); th.textContent = INDICATORS[key].name; headerRow.appendChild(th); });
    tableHead.appendChild(headerRow);
    const pageData = currentData.slice((currentPage - 1) * 10, currentPage * 10);
    pageData.forEach(rowData => { const row = document.createElement('tr'); headers.forEach(key => { const cell = document.createElement('td'); const value = rowData[key]; cell.textContent = value !== null ? (INDICATORS[key].format ? INDICATORS[key].format(value) : value) : 'N/A'; row.appendChild(cell); }); tableBody.appendChild(row); });
    const maxPage = Math.ceil(currentData.length / 10);
    document.getElementById('page-info').textContent = `Page ${currentPage} of ${maxPage}`;
    document.getElementById('prev-page').disabled = currentPage === 1;
    document.getElementById('next-page').disabled = currentPage === maxPage;
}
function updateCard(id, value, change, percent, digits) { const card = document.getElementById(id); card.querySelector('.value').textContent = value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }); card.querySelector('.change').textContent = `${percent.toFixed(2)}%`; card.querySelector('.change').className = `change ${change >= 0 ? 'positive' : 'negative'}`; }
function renderSparkline(id, data, color) { if (!sparklineCharts[id]) sparklineCharts[id] = echarts.init(document.getElementById(id)); sparklineCharts[id].setOption({ grid: { top: 5, bottom: 5, left: 5, right: 5 }, xAxis: { type: 'category', show: false }, yAxis: { type: 'value', show: false }, series: [{ type: 'line', data, showSymbol: false, lineStyle: { color, width: 2 } }] }); }
function downloadCSV() {
    if (currentData.length === 0) return;
    const headers = Object.keys(INDICATORS).filter(k => availableIndicators.includes(k)).map(k => INDICATORS[k].name);
    const keys = Object.keys(INDICATORS).filter(k => availableIndicators.includes(k));
    const csvString = [headers.join(','), ...currentData.map(row => keys.map(k => row[k] ?? 'N/A').join(','))].join('\n');
    const blob = new Blob([`\uFEFF${csvString}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'korea_economic_data.csv'; document.body.appendChild(link); link.click(); document.body.removeChild(link);
}