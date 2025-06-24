// script.js (글로벌 거시 경제 대시보드 - 최종 전체 코드)

document.addEventListener('DOMContentLoaded', function () {
    console.log("DOM 로드 완료. 글로벌 거시 경제 대시보드 초기화 시작.");

    // --- CONFIGURATION (무료 API 기반) ---
    const INDICATORS = {
        date: { name: '날짜' },
        oil: { name: 'WTI 유가', color: '#AF52DE', yAxisIndex: 0, format: (v) => `$${v.toFixed(2)}` },
        bond10y: { name: '美 국채 10Y', color: '#FF3B30', yAxisIndex: 1, format: (v) => `${v.toFixed(2)}%` },
        bond2y: { name: '美 국채 2Y', color: '#FF9500', yAxisIndex: 1, format: (v) => `${v.toFixed(2)}%` },
        usdkrw: { name: 'USD/KRW 환율', color: '#34C759', yAxisIndex: 0, format: (v) => v.toFixed(2) },
    };
    const MAIN_CHART_INDICATORS = ['oil', 'bond10y', 'usdkrw'];
    const TABLE_PAGE_SIZE = 10;

    // --- STATE, DOM, CHART Instances ---
    let fullData = [];
    let currentData = [];
    let currentPage = 1;
    let availableIndicators = [];
    
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
        // Vercel 환경이므로 /api/alpha 프록시를 통해 호출
        const queryParams = new URLSearchParams({ func, apikey: apiKey, ...params });
        const url = `/api/alpha?${queryParams.toString()}`;
        
        console.log(`Requesting Alpha Vantage: ${func} with params`, params);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`API 서버가 상태 코드 ${response.status}(으)로 응답했습니다.`);
        
        const data = await response.json();
        // Vercel 프록시에서 보낸 에러 처리
        if (data.error) throw new Error(`[API Error] ${data.details['Error Message'] || data.details['Information'] || data.error}`);

        const timeSeriesKey = Object.keys(data).find(k => k.includes('data') || k.includes('Daily'));
        if (!timeSeriesKey || !data[timeSeriesKey]) {
            throw new Error('API 응답에서 유효한 데이터 시리즈를 찾을 수 없습니다.');
        }
        
        const seriesData = data[timeSeriesKey];
        if (Array.isArray(seriesData)) { // 경제 지표 (CPI, 금리 등)
            return seriesData.map(item => ({ date: item.date, value: parseFloat(item.value) || null })).reverse();
        } else { // 환율
            return Object.keys(seriesData).map(date => {
                const entry = seriesData[date];
                const closeKey = Object.keys(entry).find(k => k.includes('close'));
                return { date: date, value: parseFloat(entry[closeKey]) || null };
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
            dataStreams[key].forEach(item => { if (dataMap.has(item.date)) { dataMap.get(item.date)[key] = item.value; } });
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

    async function loadAndInitializeDashboard() {
        const marketKey = marketApiKeyInput.value.trim();
        if (!marketKey) { alert('Alpha Vantage API 키를 입력해야 합니다.'); return; }
        localStorage.setItem('marketApiKey', marketKey);
        loadingOverlay.classList.remove('hidden');

        try {
            const dataEndpoints = {
                usdkrw: { func: 'FX_DAILY', params: { from_symbol: 'USD', to_symbol: 'KRW' } },
                oil: { func: 'WTI', params: { interval: 'daily' } },
                bond10y: { func: 'TREASURY_YIELD', params: { interval: 'daily', maturity: '10year' } },
                bond2y: { func: 'TREASURY_YIELD', params: { interval: 'daily', maturity: '2year' } },
            };
            const dataStreams = {};
            availableIndicators = [];

            for (const key in dataEndpoints) {
                console.log(`[Requesting] ${key}...`);
                try {
                    await new Promise(resolve => setTimeout(resolve, 13000)); 
                    const endpoint = dataEndpoints[key];
                    const result = await fetchAlphaData(marketKey, endpoint.func, endpoint.params);
                    if (result.length > 0) {
                        console.log(`✅ ${key} 데이터 로딩 성공`);
                        dataStreams[key] = result;
                        availableIndicators.push(key);
                    } else { console.warn(`⚠️ ${key} 데이터는 비어있습니다.`); }
                } catch (error) { console.error(`❌ ${key} 데이터 로딩 실패:`, error); }
            }
            
            if (availableIndicators.length === 0) throw new Error("모든 API에서 데이터를 가져오는 데 실패했습니다. API 키나 네트워크를 확인해주세요.");
            
            fullData = mergeData(dataStreams);
            if (fullData.length === 0) throw new Error("유효한 데이터를 병합하는 데 실패했습니다.");
            
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
            if (availableIndicators.includes(key)) {
                const label = document.createElement('label');
                label.innerHTML = `<input type="checkbox" name="indicator" value="${key}" checked> ${INDICATORS[key].name}`;
                indicatorTogglesEl.appendChild(label);
            }
        });
        indicatorTogglesEl.querySelectorAll('input').forEach(toggle => toggle.addEventListener('change', updateMainChart));
        const lastDate = fullData[fullData.length - 1].date;
        const oneYearAgo = new Date(lastDate);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        flatpickr(dateRangePickerEl, { mode: "range", dateFormat: "Y-m-d", defaultDate: [oneYearAgo.toISOString().slice(0, 10), lastDate], minDate: fullData[0].date, maxDate: lastDate });
    }

    function updateDashboard() {
        const dateRange = dateRangePickerEl.value.split(' to ');
        if (dateRange.length < 2) return;
        currentData = fullData.filter(d => d.date >= dateRange[0] && d.date <= dateRange[1]);
        if (currentData.length === 0) return;
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
        if (availableIndicators.includes('bond10y') && availableIndicators.includes('bond2y')) {
            const yieldSpreadData = currentData.map(d => ({ date: d.date, value: d.bond10y - d.bond2y }));
            yieldSpreadChart.setOption({ tooltip: { trigger: 'axis' }, grid: { left: '15%', right: '5%' }, xAxis: { type: 'category', data: yieldSpreadData.map(d => d.date) }, yAxis: { type: 'value', name: 'Spread (%)' }, series: [{ name: '10Y-2Y', type: 'line', showSymbol: false, data: yieldSpreadData.map(d => d.value.toFixed(2)), areaStyle: { opacity: 0.3 }, markLine: { data: [{ yAxis: 0, lineStyle: { color: '#888', type: 'dashed' }}], symbol: 'none' } }] });
        } else { yieldSpreadChart.clear(); }
        
        if (availableIndicators.includes('oil') && availableIndicators.includes('usdkrw')) {
            scatterPlot.setOption({ grid: { containLabel: true }, tooltip: { trigger: 'item', formatter: (p) => `유가: ${p.value[0]}<br/>환율: ${p.value[1]}` }, xAxis: { type: 'value', name: 'WTI 유가', scale: true }, yAxis: { type: 'value', name: 'USD/KRW 환율', scale: true }, series: [{ symbolSize: 8, data: currentData.map(d => [d.oil, d.usdkrw]), type: 'scatter' }] });
        } else { scatterPlot.clear(); }
    }

    function updateDataTable() {
        const tableBody = document.querySelector('#data-table tbody'); const tableHead = document.querySelector('#data-table thead');
        tableBody.innerHTML = ''; tableHead.innerHTML = ''; if (currentData.length === 0) return;
        const headers = ['date', ...availableIndicators];
        const headerRow = document.createElement('tr'); headers.forEach(key => { const th = document.createElement('th'); th.textContent = INDICATORS[key].name; headerRow.appendChild(th); });
        tableHead.appendChild(headerRow);
        const pageData = currentData.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE);
        pageData.forEach(rowData => { const row = document.createElement('tr'); headers.forEach(key => { const cell = document.createElement('td'); const value = rowData[key]; cell.textContent = (value !== null) ? (INDICATORS[key].format ? INDICATORS[key].format(value) : value) : 'N/A'; row.appendChild(cell); }); tableBody.appendChild(row); });
        const maxPage = Math.ceil(currentData.length / TABLE_PAGE_SIZE);
        document.getElementById('page-info').textContent = `Page ${currentPage} of ${maxPage}`;
        document.getElementById('prev-page').disabled = currentPage === 1;
        document.getElementById('next-page').disabled = currentPage === maxPage;
    }
    
    // --- Start the App ---
    init();
});