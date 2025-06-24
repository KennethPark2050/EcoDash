// script.js (글로벌 시장 분석 대시보드 - 전체 코드)

document.addEventListener('DOMContentLoaded', function () {
    console.log("DOM 로드 완료. 글로벌 시장 분석 대시보드 초기화 시작.");

    // --- CONFIGURATION ---
    const INDICATORS = {
        date: { name: '날짜' },
        sp500: { name: 'S&P 500 (SPY)', color: '#007AFF', yAxisIndex: 0, format: (v) => v.toFixed(2) },
        nasdaq: { name: 'Nasdaq 100 (QQQ)', color: '#5856D6', yAxisIndex: 0, format: (v) => v.toFixed(2) },
        oil: { name: 'WTI 유가', color: '#AF52DE', yAxisIndex: 0, format: (v) => `$${v.toFixed(2)}` },
        bond10y: { name: '美 국채 10Y', color: '#FF3B30', yAxisIndex: 1, format: (v) => `${v.toFixed(2)}%` },
        bond2y: { name: '美 국채 2Y', color: '#FF9500', yAxisIndex: 1, format: (v) => `${v.toFixed(2)}%` },
        usdkrw: { name: 'USD/KRW 환율', color: '#34C759', yAxisIndex: 0, format: (v) => v.toFixed(2) },
    };
    const MAIN_CHART_INDICATORS = ['sp500', 'nasdaq', 'oil', 'bond10y', 'usdkrw'];
    const TABLE_PAGE_SIZE = 10;

    // --- STATE, DOM, CHART Instances ---
    let fullData = [];
    let currentData = [];
    let currentPage = 1;
    // ... 모든 DOM, Chart 인스턴스 변수들 ...
    const loadingOverlay = document.getElementById('loading-overlay');
    const apiKeySection = document.getElementById('api-key-section');
    const dashboardContainer = document.getElementById('dashboard-main-container');
    const marketApiKeyInput = document.getElementById('market-api-key');
    const loadDataBtn = document.getElementById('load-data-btn');
    const dateRangePickerEl = document.getElementById('date-range');
    const indicatorTogglesEl = document.getElementById('indicator-toggles');
    const refreshBtn = document.getElementById('refresh-btn');
    
    const mainChart = echarts.init(document.getElementById('main-timeseries-chart'));
    const yieldSpreadChart = echarts.init(document.getElementById('yield-spread-chart'));
    const scatterPlot = echarts.init(document.getElementById('scatter-plot'));

    // --- API & DATA HANDLING ---
    async function fetchAlphaData(apiKey, func, params = {}) {
        const queryParams = new URLSearchParams({ function: func, apikey: apiKey, ...params });
        // GitHub Pages 등에서 직접 호출하므로 전체 URL 사용
        const url = `https://www.alphavantage.co/query?${queryParams.toString()}`;
        
        console.log(`Requesting Alpha Vantage: ${func} with params`, params);

        // API 호출 한도(분당 5회)를 피하기 위한 약간의 지연 추가
        await new Promise(resolve => setTimeout(resolve, 13000)); // 13초 대기

        const response = await fetch(url);
        if (!response.ok) throw new Error(`API server status: ${response.ok}`);
        
        const data = await response.json();
        const timeSeriesKey = Object.keys(data).find(k => k.includes('Time Series') || k.includes('data') || k.includes('Daily'));
        if (!timeSeriesKey || !data[timeSeriesKey]) {
            console.warn(`Alpha Vantage: No data for ${func}`, data);
            throw new Error(data['Information'] || data['Error Message'] || 'Invalid data structure');
        }
        
        // 데이터 형식에 따라 파싱 로직 분기
        const seriesData = data[timeSeriesKey];
        if (Array.isArray(seriesData)) { // 경제 지표 (CPI, 금리 등)
            return seriesData.map(item => ({ date: item.date, value: parseFloat(item.value) })).reverse();
        } else { // 주식, 환율
            return Object.keys(seriesData).map(date => {
                const entry = seriesData[date];
                const closeKey = Object.keys(entry).find(k => k.includes('close'));
                return { date: date, value: parseFloat(entry[closeKey]) };
            });
        }
    }

    function mergeData(dataStreams) {
        const dataMap = new Map();
        const allDataPoints = Object.values(dataStreams).flat();
        if (allDataPoints.length === 0) return [];

        let minDateStr = "9999-12-31", maxDateStr = "1900-01-01";
        allDataPoints.forEach(d => { if(d.value) { if (d.date < minDateStr) minDateStr = d.date; if (d.date > maxDateStr) maxDateStr = d.date; }});
        
        for (let d = new Date(minDateStr); d <= new Date(maxDateStr); d.setDate(d.getDate() + 1)) {
            dataMap.set(d.toISOString().slice(0, 10), { date: d.toISOString().slice(0, 10) });
        }

        for (const key in dataStreams) {
            dataStreams[key].forEach(item => {
                if (dataMap.has(item.date)) { dataMap.get(item.date)[key] = item.value; }
            });
        }
        
        let lastValues = {};
        return Array.from(dataMap.values()).sort((a,b) => new Date(a.date) - new Date(b.date)).map(entry => {
            for (const key in INDICATORS) {
                if (key === 'date') continue;
                if (entry[key] !== undefined && entry[key] !== null && !isNaN(entry[key])) { lastValues[key] = entry[key]; }
                else if (lastValues[key] !== undefined) { entry[key] = lastValues[key]; }
                else { entry[key] = null; }
            }
            return entry;
        });
    }

    // --- INITIALIZATION & EVENT LISTENERS ---
    function init() {
        marketApiKeyInput.value = localStorage.getItem('marketApiKey') || '';
        loadDataBtn.addEventListener('click', loadAndInitializeDashboard);
        refreshBtn.addEventListener('click', () => updateDashboard());
    }

    // script.js 파일의 loadAndInitializeDashboard 함수만 이 코드로 교체하세요.

    // script.js 파일의 loadAndInitializeDashboard 함수만 이 코드로 교체하세요.

    async function loadAndInitializeDashboard() {
        const marketKey = marketApiKeyInput.value.trim();
        if (!marketKey) { alert('Alpha Vantage API 키를 입력해야 합니다.'); return; }
        localStorage.setItem('marketApiKey', marketKey);
        loadingOverlay.classList.remove('hidden');

        try {
            // --- 오직 하나의 API만 테스트 ---
            // 가장 기본적이고 성공 확률이 높은 환율(FX_DAILY)만 남깁니다.
            const dataPromises = {
                usdkrw: fetchAlphaData(marketKey, 'FX_DAILY', { from_symbol: 'USD', to_symbol: 'KRW' }),
            };

            const results = await Promise.allSettled(Object.values(dataPromises));
            const dataStreams = {};
            const availableIndicators = [];

            results.forEach((result, index) => {
                const key = Object.keys(dataPromises)[index];
                if (result.status === 'fulfilled' && result.value.length > 0) {
                    console.log(`✅ ${key} 데이터 로딩 성공`);
                    dataStreams[key] = result.value;
                    availableIndicators.push(key);
                } else {
                    console.error(`❌ ${key} 데이터 로딩 실패:`, result.reason || '데이터 없음');
                }
            });
            
            if (availableIndicators.length === 0) {
                throw new Error("모든 API에서 데이터를 가져오는 데 실패했습니다. API 키가 유효한지 확인해주세요.");
            }
            
            fullData = mergeData(dataStreams);
            if (fullData.length === 0) {
                throw new Error("유효한 데이터를 병합하는 데 실패했습니다.");
            }
            
            setupDashboardUI();
            updateDashboard();
            apiKeySection.classList.add('hidden');
            dashboardContainer.classList.remove('hidden');

        } catch (error) {
            alert(`데이터 로딩 실패: ${error.message}`);
            console.error(error);
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    }
    
    // --- UI UPDATE FUNCTIONS ---
    function setupDashboardUI() {
        indicatorTogglesEl.innerHTML = '';
        MAIN_CHART_INDICATORS.forEach(key => {
            if (fullData[0][key] !== null) { // 데이터가 있는 지표만 토글 생성
                const label = document.createElement('label');
                label.innerHTML = `<input type="checkbox" name="indicator" value="${key}" checked> ${INDICATORS[key].name}`;
                indicatorTogglesEl.appendChild(label);
            }
        });
        indicatorTogglesEl.querySelectorAll('input').forEach(toggle => toggle.addEventListener('change', updateMainChart));

        const lastDate = fullData[fullData.length - 1].date;
        const oneYearAgo = new Date(lastDate);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        flatpickr(dateRangePickerEl, {
            mode: "range", dateFormat: "Y-m-d",
            defaultDate: [oneYearAgo.toISOString().slice(0, 10), lastDate],
            minDate: fullData[0].date, maxDate: lastDate
        });
    }

    function updateDashboard() {
        const dateRange = dateRangePickerEl.value.split(' to ');
        if (dateRange.length < 2) return;
        currentData = fullData.filter(d => d.date >= dateRange[0] && d.date <= dateRange[1]);
        if (currentData.length === 0) return;
        
        updateKpiCards();
        updateMainChart();
        updateSubCharts();
        updateDataTable();
    }
    
    // ... 이하 나머지 UI 업데이트 함수들 (updateKpiCards, updateMainChart 등)은
    // 이전에 제공한 완성된 코드를 기반으로, 변수명만 이 스크립트에 맞게 수정하여 사용합니다.
    // 간결함을 위해 아래에 다시 첨부합니다.

    function updateKpiCards() { /* ... */ }
    function updateMainChart() { /* ... */ }
    function updateSubCharts() { /* ... */ }
    function updateDataTable() { /* ... */ }

    init();
});

// =============================================================
// 위 스크립트의 생략된 함수들을 여기에 붙여넣어 완성하세요.
// =============================================================
function updateKpiCards() {
    const latest = currentData[currentData.length - 1];
    const prev = currentData.length > 1 ? currentData[currentData.length - 2] : latest;
    Object.keys(INDICATORS).forEach(key => {
        if (key === 'date' || latest[key] === null) return;
        const cardEl = document.getElementById(`kpi-${key.replace('10y', 'bond10y').replace('2y', 'bond2y').replace('sp500', 'sp500').replace('nasdaq', 'nasdaq').replace('oil', 'oil').replace('usdkrw', 'usdkrw')}`);
        if (!cardEl) return;
        const value = latest[key];
        cardEl.querySelector('.value').textContent = INDICATORS[key].format(value);
        if (prev[key] !== null) {
            const change = value - prev[key];
            const percent = (value / prev[key] - 1) * 100;
            cardEl.querySelector('.change').textContent = key.includes('bond') ? `${change.toFixed(3)}p` : `${percent.toFixed(2)}%`;
            cardEl.querySelector('.change').className = `change ${change >= 0 ? 'positive' : 'negative'}`;
        }
    });
}
function updateMainChart() {
    const selectedIndicators = Array.from(document.querySelectorAll('#indicator-toggles input:checked')).map(cb => cb.value);
    const series = selectedIndicators.map(key => ({ name: INDICATORS[key].name, type: 'line', yAxisIndex: INDICATORS[key].yAxisIndex, data: currentData.map(d => d[key]), showSymbol: false, color: INDICATORS[key].color }));
    mainChart.setOption({ tooltip: { trigger: 'axis' }, legend: { data: selectedIndicators.map(key => INDICATORS[key].name), top: 10 }, grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true }, xAxis: { type: 'category', data: currentData.map(d => d.date) }, yAxis: [{ type: 'value', name: 'Price / Index' }, { type: 'value', name: 'Yield (%)', position: 'right' }], series, dataZoom: [{ type: 'inside' }, { type: 'slider' }] }, true);
}
function updateSubCharts() {
    if (currentData[0].bond10y !== null && currentData[0].bond2y !== null) {
        const yieldSpreadData = currentData.map(d => ({ date: d.date, value: d.bond10y - d.bond2y }));
        yieldSpreadChart.setOption({ tooltip: { trigger: 'axis' }, grid: { left: '15%', right: '5%' }, xAxis: { type: 'category', data: yieldSpreadData.map(d => d.date) }, yAxis: { type: 'value', name: 'Spread (%)' }, series: [{ name: '10Y-2Y', type: 'line', showSymbol: false, data: yieldSpreadData.map(d => d.value.toFixed(2)), areaStyle: {}, markLine: { data: [{ yAxis: 0 }], symbol: 'none' } }] });
    }
    if (currentData[0].sp500 !== null && currentData[0].oil !== null) {
        scatterPlot.setOption({ grid: { containLabel: true }, tooltip: { trigger: 'item' }, xAxis: { type: 'value', name: 'S&P 500' }, yAxis: { type: 'value', name: 'WTI 유가' }, series: [{ symbolSize: 8, data: currentData.map(d => [d.sp500, d.oil]), type: 'scatter' }] });
    }
}
function updateDataTable() {
    const tableBody = document.querySelector('#data-table tbody');
    const tableHead = document.querySelector('#data-table thead');
    tableBody.innerHTML = ''; tableHead.innerHTML = '';
    const headers = Object.keys(INDICATORS).filter(key => fullData[0][key] !== null);
    const headerRow = document.createElement('tr');
    headers.forEach(key => { const th = document.createElement('th'); th.textContent = INDICATORS[key].name; headerRow.appendChild(th); });
    tableHead.appendChild(headerRow);
    const pageData = currentData.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE);
    pageData.forEach(rowData => { const row = document.createElement('tr'); headers.forEach(key => { const cell = document.createElement('td'); const value = rowData[key]; cell.textContent = (value !== null) ? INDICATORS[key].format(value) : 'N/A'; row.appendChild(cell); }); tableBody.appendChild(row); });
    const maxPage = Math.ceil(currentData.length / TABLE_PAGE_SIZE);
    document.getElementById('page-info').textContent = `Page ${currentPage} of ${maxPage}`;
    document.getElementById('prev-page').disabled = currentPage === 1;
    document.getElementById('next-page').disabled = currentPage === maxPage;
}