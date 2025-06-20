document.addEventListener('DOMContentLoaded', function () {
    console.log("DOM 로드 완료. 스크립트 초기화 시작 (GitHub Pages Ver.)");

    // --- CONFIGURATION (단순화) ---
    const INDICATORS = {
        date: { name: '날짜' },
        kospi: { name: 'KOSPI(대용)', color: '#007AFF', format: (v) => v.toFixed(2) },
        usd_krw: { name: '환율', color: '#FF9500', format: (v) => v.toFixed(2) },
    };
    const TABLE_PAGE_SIZE = 10;

    // --- STATE ---
    let fullData = [];
    let currentData = [];
    let currentPage = 1;

    // --- DOM ELEMENTS (단순화) ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const apiKeySection = document.getElementById('api-key-section');
    const dashboardContainer = document.getElementById('dashboard-main-container');
    const marketApiKeyInput = document.getElementById('market-api-key');
    const loadDataBtn = document.getElementById('load-data-btn');
    const dateRangePickerEl = document.getElementById('date-range');
    const refreshBtn = document.getElementById('refresh-btn');
    // ... (나머지 필요한 DOM 요소들)
    const downloadCsvBtn = document.getElementById('download-csv');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const pageInfoEl = document.getElementById('page-info');

    // --- CHART INSTANCES ---
    const mainChart = echarts.init(document.getElementById('main-timeseries-chart'));
    const scatterPlot = echarts.init(document.getElementById('scatter-plot'));
    const sparklineCharts = {};

    // --- API & DATA HANDLING (직접 호출 방식으로 변경) ---
    async function fetchAlphaData(apiKey, type, symbol) {
        // 백엔드 프록시 대신 Alpha Vantage URL 직접 호출
        const func = type === 'stock' ? 'TIME_SERIES_DAILY_ADJUSTED' : 'FX_DAILY'; // Adjusted로 변경하여 수정주가 사용
        const symbolQuery = func === 'FX_DAILY' ? `from_symbol=${symbol.split('/')[0]}&to_symbol=${symbol.split('/')[1]}` : `symbol=${symbol}`;
        const url = `https://www.alphavantage.co/query?function=${func}&${symbolQuery}&outputsize=full&apikey=${apiKey}`;
        
        console.log(`Requesting Alpha Vantage: ${url.replace(apiKey, 'REDACTED')}`);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`API server status: ${response.status}`);
        
        const data = await response.json();
        const timeSeriesKey = Object.keys(data).find(k => k.includes('Time Series') || k.includes('FX Daily'));
        if (!timeSeriesKey || !data[timeSeriesKey]) {
            console.warn(`Alpha Vantage: No data for ${symbol}`, data);
            throw new Error(data['Information'] || data['Error Message'] || 'Invalid data structure');
        }
        
        const timeSeries = data[timeSeriesKey];
        return Object.keys(timeSeries).map(date => {
            const entry = timeSeries[date];
            // 주식은 '5. adjusted close', 환율은 '4. close' 키 사용
            const closeKey = Object.keys(entry).find(k => k.includes('adjusted close') || k.includes('close'));
            return { date: date, value: parseFloat(entry[closeKey]) };
        });
    }
    
    function mergeData(kospiData, fxData) {
        const dataMap = new Map();
        fxData.forEach(item => dataMap.set(item.date, { date: item.date, usd_krw: item.value }));
        kospiData.forEach(item => {
            if (dataMap.has(item.date)) {
                dataMap.get(item.date).kospi = item.value;
            }
        });
        return Array.from(dataMap.values()).filter(d => d.kospi && d.usd_krw).sort((a,b) => new Date(a.date) - new Date(b.date));
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
            // KOSPI 대용으로 미국 대표 S&P 500 ETF (SPY) 사용
            const kospiPromise = fetchAlphaData(marketKey, 'stock', 'SPY'); 
            const fxPromise = fetchAlphaData(marketKey, 'fx', 'USD/KRW');

            const [kospiResult, fxResult] = await Promise.all([kospiPromise, fxPromise]);
            
            console.log('✅ KOSPI(대용) 데이터 로딩 성공');
            console.log('✅ USD/KRW 데이터 로딩 성공');

            fullData = mergeData(kospiResult, fxResult);
            if (fullData.length === 0) throw new Error("데이터를 병합하는 데 실패했습니다.");
            
            setupDashboardUI();
            updateDashboard();
            apiKeySection.classList.add('hidden');
            dashboardContainer.classList.remove('hidden');

        } catch (error) {
            alert(`데이터 로딩 실패: ${error.message}\n\nAPI 키가 유효한지, 또는 일일 사용량을 초과하지 않았는지 확인해주세요.`);
            console.error(error);
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    }

    function setupDashboardUI() {
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
        currentPage = 1;
        if (currentData.length === 0) { alert('선택된 기간에 데이터가 없습니다.'); return; }
        
        updateKpiCards();
        updateMainChart();
        updateScatterPlot();
        updateDataTable();
    }
    
    function updateKpiCards() {
        const latest = currentData[currentData.length - 1];
        const prev = currentData.length > 1 ? currentData[currentData.length - 2] : latest;

        // KOSPI (대용)
        updateCard('kpi-kospi', latest.kospi, latest.kospi - prev.kospi, (latest.kospi / prev.kospi - 1) * 100, 2);
        renderSparkline('sparkline-kospi', currentData.map(d => d.kospi), INDICATORS.kospi.color);
        // USD/KRW
        updateCard('kpi-usd-krw', latest.usd_krw, latest.usd_krw - prev.usd_krw, (latest.usd_krw / prev.usd_krw - 1) * 100, 2);
        renderSparkline('sparkline-usd-krw', currentData.map(d => d.usd_krw), INDICATORS.usd_krw.color);
    }
    
    function updateMainChart() {
        mainChart.setOption({
            tooltip: { trigger: 'axis' },
            legend: { data: ['KOSPI(대용)', '환율'] },
            grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
            xAxis: { type: 'category', data: currentData.map(d => d.date) },
            yAxis: [{ type: 'value', name: 'KOSPI(대용)' }, { type: 'value', name: '환율', position: 'right' }],
            series: [
                { name: 'KOSPI(대용)', type: 'line', yAxisIndex: 0, data: currentData.map(d => d.kospi), showSymbol: false, color: INDICATORS.kospi.color },
                { name: '환율', type: 'line', yAxisIndex: 1, data: currentData.map(d => d.usd_krw), showSymbol: false, color: INDICATORS.usd_krw.color }
            ],
            dataZoom: [{ type: 'inside' }, { type: 'slider' }]
        }, true);
    }
    
    function updateScatterPlot() {
        scatterPlot.setOption({
            grid: { containLabel: true },
            tooltip: { trigger: 'item', formatter: (p) => `KOSPI(대용): ${p.value[0].toFixed(2)}<br/>환율: ${p.value[1].toFixed(2)}` },
            xAxis: { type: 'value', name: 'KOSPI(대용)', scale: true },
            yAxis: { type: 'value', name: '환율', scale: true },
            series: [{ symbolSize: 8, data: currentData.map(d => [d.kospi, d.usd_krw]), type: 'scatter' }]
        });
    }

    // --- 나머지 헬퍼 함수들 (데이터 테이블 등) ---
    function updateDataTable() {
        const tableBody = document.querySelector('#data-table tbody'); const tableHead = document.querySelector('#data-table thead');
        tableBody.innerHTML = ''; tableHead.innerHTML = ''; if (currentData.length === 0) return;
        const headers = ['date', 'kospi', 'usd_krw'];
        const headerRow = document.createElement('tr');
        headers.forEach(key => { const th = document.createElement('th'); th.textContent = INDICATORS[key].name; headerRow.appendChild(th); });
        tableHead.appendChild(headerRow);
        const pageData = currentData.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE);
        pageData.forEach(rowData => { const row = document.createElement('tr'); headers.forEach(key => { const cell = document.createElement('td'); const value = rowData[key]; cell.textContent = typeof value === 'number' ? value.toFixed(2) : value; row.appendChild(cell); }); tableBody.appendChild(row); });
        const maxPage = Math.ceil(currentData.length / TABLE_PAGE_SIZE);
        pageInfoEl.textContent = `Page ${currentPage} of ${maxPage}`;
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === maxPage;
    }
    function updateCard(id, value, change, percent, digits) { const card = document.getElementById(id); card.querySelector('.value').textContent = value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }); card.querySelector('.change').textContent = `${percent.toFixed(2)}%`; card.querySelector('.change').className = `change ${change >= 0 ? 'positive' : 'negative'}`; }
    function renderSparkline(id, data, color) { if (!sparklineCharts[id]) sparklineCharts[id] = echarts.init(document.getElementById(id)); sparklineCharts[id].setOption({ grid: { top: 5, bottom: 5, left: 5, right: 5 }, xAxis: { type: 'category', show: false }, yAxis: { type: 'value', show: false }, series: [{ type: 'line', data, showSymbol: false, lineStyle: { color, width: 2 } }] }); }
    function downloadCSV() { if (currentData.length === 0) return; const headers = ['date', 'kospi', 'usd_krw']; const csvString = [headers.join(','), ...currentData.map(row => headers.map(k => row[k]).join(','))].join('\n'); const blob = new Blob([`\uFEFF${csvString}`], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'market_data.csv'; document.body.appendChild(link); link.click(); document.body.removeChild(link); }

    // --- Start the App ---
    init();
});