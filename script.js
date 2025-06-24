// script.js (최종 호출 방식 검증용 - 전체 코드)

document.addEventListener('DOMContentLoaded', function () {
    console.log("DOM 로드 완료. 스크립트 초기화 시작 (최종 테스트 Ver.)");

    // --- CONFIGURATION (호출 방식 검증용으로 대폭 수정) ---
    const INDICATORS = {
        date: { name: '날짜' },
        market_index: { name: 'S&P 500 (SPY)', color: '#007AFF', yAxisIndex: 0, format: (v) => v.toFixed(2) },
        usd_krw: { name: '환율', color: '#FF9500', yAxisIndex: 1, format: (v) => v.toFixed(2) },
        base_rate: { name: '기준금리', color: '#34C759', yAxisIndex: 1, format: (v) => v.toFixed(2) + '%' },
        gdp_private_consumption: { name: '민간소비(십억)', color: '#FF3B30', yAxisIndex: 0, format: (v) => v.toLocaleString() },
        m1_raw: { name: 'M1 통화량(십억)', color: '#AF52DE', yAxisIndex: 0, format: (v) => v.toLocaleString() },
    };
    const MAIN_CHART_INDICATORS = ['market_index', 'usd_krw', 'base_rate'];
    const TABLE_PAGE_SIZE = 10;
    const ECOS_CODES = {
        base_rate: { statcode: '722Y001', itemcode: '0100000', cycle: 'D' },
        gdp_private_consumption: { statcode: '200Y001', itemcode: '1110101', cycle: 'Q' },
        m1_raw: { statcode: '101Y001', itemcode: 'AAMA01', cycle: 'M' },
    };

    // --- STATE ---
    let fullData = [], currentData = [], currentPage = 1, availableIndicators = [];

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
    const scatterPlotEl = document.getElementById('scatter-plot');
    const downloadCsvBtn = document.getElementById('download-csv');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const pageInfoEl = document.getElementById('page-info');

    // --- CHART INSTANCES ---
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

        let minDate = new Date(), maxDate = new Date('1900-01-01');
        allDataPoints.forEach(d => {
            const date = new Date(d.date.replace(/-Q(\d)/, (m, q) => `-${(q*3-2).toString().padStart(2,'0')}-01`));
            if (date < minDate) minDate = date;
            if (date > maxDate) maxDate = date;
        });
        
        for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 1)) {
            dataMap.set(d.toISOString().slice(0, 10), { date: d.toISOString().slice(0, 10) });
        }
        
        for (const key in dataStreams) {
            const cycle = ECOS_CODES[key]?.cycle;
            dataStreams[key].forEach(item => {
                if (cycle === 'M' || cycle === 'Q') {
                    const itemDate = new Date(item.date.replace(/-Q(\d)/, (m, q) => `-${(q*3-2).toString().padStart(2,'0')}-01`));
                    const year = itemDate.getFullYear();
                    const period = cycle === 'M' ? itemDate.getMonth() : Math.floor(itemDate.getMonth() / 3);
                    
                    for (const dateOnMap of dataMap.keys()) {
                        const mapDate = new Date(dateOnMap);
                        const mapYear = mapDate.getFullYear();
                        const mapPeriod = cycle === 'M' ? mapDate.getMonth() : Math.floor(mapDate.getMonth() / 3);
                        if (mapYear === year && mapPeriod === period) {
                            const entry = dataMap.get(dateOnMap); entry[key] = item.value; dataMap.set(dateOnMap, entry);
                        }
                    }
                } else { if (dataMap.has(item.date)) { const entry = dataMap.get(item.date); entry[key] = item.value; dataMap.set(item.date, entry); } }
            });
        }
        let lastValues = {};
        return Array.from(dataMap.values()).sort((a,b) => new Date(a.date) - new Date(b.date)).map(entry => {
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

    // --- loadAndInitializeDashboard (최종 테스트 버전) ---
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
    
    // --- 나머지 모든 함수 (UI 업데이트 및 헬퍼) ---
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
        indicatorTogglesEl.querySelectorAll('input').forEach(toggle => {
            toggle.addEventListener('change', updateMainChart);
        });
        
        const lastDate = fullData[fullData.length - 1].date;
        const oneYearAgo = new Date(lastDate);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        flatpickr(dateRangePickerEl, { mode: "range", dateFormat: "Y-m-d", defaultDate: [oneYearAgo.toISOString().slice(0, 10), lastDate], minDate: fullData[0].date, maxDate: lastDate });
    }
    function updateDashboard() {
        const dateRange = dateRangePickerEl.value.split(' to ');
        if (dateRange.length < 2) return;
        currentData = fullData.filter(d => d.date >= dateRange[0] && d.date <= dateRange[1]);
        currentPage = 1;
        if (currentData.length === 0) { alert('선택된 기간에 데이터가 없습니다.'); return; }
        // 모든 UI 업데이트 함수 호출
    }
    // ... (이전 코드의 updateKpiCards, updateMainChart, updateSubCharts, updateDataTable 등 모든 UI 관련 함수를 여기에 붙여넣으세요)

    // --- Start the App ---
    init();
});