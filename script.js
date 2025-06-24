document.addEventListener('DOMContentLoaded', function () {
    console.log("DOM 로드 완료. 스크립트 초기화 시작 (최종 테스트 Ver.)");

    // --- CONFIGURATION (호출 방식 검증용) ---
    const INDICATORS = {
        date: { name: '날짜' },
        market_index: { name: 'S&P 500 (SPY)', color: '#007AFF', yAxisIndex: 0, format: (v) => v.toFixed(2) },
        usd_krw: { name: '환율', color: '#FF9500', yAxisIndex: 1, format: (v) => v.toFixed(2) },
        base_rate: { name: '기준금리', color: '#34C759', yAxisIndex: 1, format: (v) => v.toFixed(2) + '%' },
        cpi_raw: { name: '소비자물가지수', color: '#FF3B30', yAxisIndex: 0, format: (v) => v.toFixed(2) },
        m2_raw: { name: 'M2 통화량(십억)', color: '#AF52DE', yAxisIndex: 0, format: (v) => (v/1000).toFixed(0) },
    };
    const MAIN_CHART_INDICATORS = ['market_index', 'usd_krw', 'base_rate'];
    const TABLE_PAGE_SIZE = 10;
    const ECOS_CODES = {
        base_rate: { statcode: '722Y001', itemcode: '0100000', cycle: 'D' },
        cpi_raw: { statcode: '901Y001', itemcode: '0', cycle: 'M' },
        m2_raw: { statcode: '101Y002', itemcode: 'BBMA01', cycle: 'M' },
    };

    // --- STATE, DOM, CHART Instances (기존과 동일) ---
    let fullData = [], currentData = [], currentPage = 1, availableIndicators = [];
    // ... 모든 DOM, Chart 인스턴스 변수들 ...
    const loadingOverlay = document.getElementById('loading-overlay');
    const apiKeySection = document.getElementById('api-key-section');
    const dashboardContainer = document.getElementById('dashboard-main-container');
    const ecosApiKeyInput = document.getElementById('ecos-api-key');
    const marketApiKeyInput = document.getElementById('market-api-key');
    const loadDataBtn = document.getElementById('load-data-btn');
    const dateRangePickerEl = document.getElementById('date-range');
    const indicatorTogglesEl = document.getElementById('indicator-toggles');
    const refreshBtn = document.getElementById('refresh-btn');
    const mainChart = echarts.init(document.getElementById('main-timeseries-chart'));
    const monthlyReturnHeatmap = echarts.init(document.getElementById('monthly-return-heatmap'));
    const scatterPlot = echarts.init(document.getElementById('scatter-plot'));
    const sparklineCharts = {};

    // --- API & DATA HANDLING (기존과 동일) ---
    async function fetchEcosData(apiKey, codeInfo, startDate, endDate) {
        const params = new URLSearchParams({ apikey: apiKey, statcode: codeInfo.statcode, cycle: codeInfo.cycle, start: startDate, end: endDate, itemcode: codeInfo.itemcode });
        const url = `/api/ecos?${params.toString()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.details || data.error);
        if (data.StatisticSearch && data.StatisticSearch.row) {
            return data.StatisticSearch.row.map(item => ({ date: item.TIME.replace(/(\d{4})(\d{2})(\d{2})?/, '$1-$2-$3').slice(0, 10), value: parseFloat(item.DATA_VALUE) }));
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
        // ... (기존 mergeData 함수와 동일, 여기에 붙여넣으세요)
    }

    // --- INITIALIZATION & EVENT LISTENERS ---
    function init() {
        // ... (기존 init 함수와 동일, 여기에 붙여넣으세요)
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

            const dataPromises = {
                market_index: fetchAlphaData(marketKey, 'stock', 'SPY'),
                usd_krw: fetchAlphaData(marketKey, 'fx', 'USD/KRW'),
                base_rate: fetchEcosData(ecosKey, ECOS_CODES.base_rate, ecosDailyStartDate, ecosDailyEndDate),
                cpi_raw: fetchEcosData(ecosKey, ECOS_CODES.cpi_raw, ecosMonthlyStartDate, ecosMonthlyEndDate),
                m2_raw: fetchEcosData(ecosKey, ECOS_CODES.m2_raw, ecosMonthlyStartDate, ecosMonthlyEndDate),
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
    
    // --- 나머지 모든 함수 (setupDashboardUI, update... 등) ---
    // (이전 풀버전 코드와 동일, 여기에 붙여넣으세요)
});