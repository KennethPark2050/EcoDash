// script.js (최종 호출 방식 검증용 - 전체 코드)

document.addEventListener('DOMContentLoaded', function () {
    console.log("DOM 로드 완료. ECOS API 최종 테스트 시작.");

    // --- DOM ELEMENTS ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const apiKeySection = document.getElementById('api-key-section');
    const dashboardContainer = document.getElementById('dashboard-main-container');
    const ecosApiKeyInput = document.getElementById('ecos-api-key');
    const loadDataBtn = document.getElementById('load-data-btn');
    const resultLogEl = document.getElementById('result-log');
    const testCardValueEl = document.querySelector('#kpi-test_data .value');
    
    // --- ECOS_CODES (100% 동작 보장 코드로 단일화) ---
    const ECOS_CODES = {
        reserve_base_money: { statcode: '102Y004', itemcode: 'BMAA01', cycle: 'M' },
    };

    // --- API & DATA HANDLING ---
    async function fetchEcosData(apiKey, codeInfo, startDate, endDate) {
        const params = new URLSearchParams({ apikey: apiKey, statcode: codeInfo.statcode, cycle: codeInfo.cycle, start: startDate, end: endDate, itemcode: codeInfo.itemcode });
        // Vercel 환경에서는 /api/ecos 경로를 사용
        const url = `/api/ecos?${params.toString()}`; 
        
        console.log(`Requesting ECOS: ${url.replace(apiKey, 'REDACTED')}`);
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`[Front-end] Server responded with status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.error) {
            // 서버에서 보낸 에러 메시지를 그대로 throw
            throw new Error(`[API Error] ${data.details || data.error}`);
        }

        if (data.StatisticSearch && data.StatisticSearch.row) {
            return data.StatisticSearch.row.map(item => ({ 
                date: item.TIME, 
                value: parseFloat(item.DATA_VALUE) 
            }));
        }
        
        // 데이터가 없는 경우
        return []; 
    }
    
    // --- INITIALIZATION & EVENT LISTENERS ---
    function init() {
        ecosApiKeyInput.value = localStorage.getItem('ecosApiKey') || '';
        loadDataBtn.addEventListener('click', runFinalTest);
    }

    // --- FINAL TEST FUNCTION ---
    async function runFinalTest() {
        const ecosKey = ecosApiKeyInput.value.trim();
        if (!ecosKey) {
            alert('ECOS API 키를 입력해야 합니다.');
            return;
        }
        localStorage.setItem('ecosApiKey', ecosKey);
        loadingOverlay.classList.remove('hidden');
        resultLogEl.textContent = 'API 호출을 시작합니다...';

        try {
            const today = new Date();
            const ecosMonthlyEndDate = today.toISOString().slice(0, 7).replace('-', '');
            today.setFullYear(today.getFullYear() - 5);
            const ecosMonthlyStartDate = today.toISOString().slice(0, 7).replace('-', '');

            const testData = await fetchEcosData(ecosKey, ECOS_CODES.reserve_base_money, ecosMonthlyStartDate, ecosMonthlyEndDate);

            if (testData.length > 0) {
                console.log('✅ ECOS 데이터 로딩 성공!', testData);
                resultLogEl.textContent = '✅ ECOS API 호출 성공!\n\n';
                resultLogEl.textContent += `가져온 데이터 개수: ${testData.length}\n`;
                resultLogEl.textContent += `최신 데이터: ${testData[testData.length - 1].date} / ${testData[testData.length - 1].value.toLocaleString()}`;
                testCardValueEl.textContent = testData[testData.length-1].value.toLocaleString();
            } else {
                throw new Error("API 호출은 성공했으나, 반환된 데이터가 없습니다.");
            }
            
            apiKeySection.classList.add('hidden');
            dashboardContainer.classList.remove('hidden');

        } catch (error) {
            console.error('❌ ECOS 데이터 로딩 실패:', error);
            resultLogEl.textContent = `❌ ECOS API 호출 실패!\n\n에러 메시지: ${error.message}`;
            apiKeySection.classList.add('hidden');
            dashboardContainer.classList.remove('hidden');
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    }
    
    // --- Start the App ---
    init();
});