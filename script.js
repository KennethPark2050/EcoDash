// script.js (최종 M2 단일 호출 테스트용 - 전체 코드)

document.addEventListener('DOMContentLoaded', function () {
    console.log("DOM 로드 완료. ECOS API 최종 M2 테스트 시작.");

    // --- CONFIGURATION (M2 테스트용으로 극단적 단순화) ---
    const INDICATORS = {
        date: { name: '날짜' },
        m2_raw: { name: 'M2 통화량(십억)', color: '#AF52DE', format: (v) => v.toLocaleString() },
    };
    const ECOS_CODES = {
        // M2(광의통화, 평잔, 원계열) - 가장 확실한 코드 조합
        m2_raw: { statcode: '101Y002', itemcode: 'BBMA01', cycle: 'M' },
    };

    // --- DOM ELEMENTS ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const apiKeySection = document.getElementById('api-key-section');
    const dashboardContainer = document.getElementById('dashboard-main-container');
    const ecosApiKeyInput = document.getElementById('ecos-api-key');
    const marketApiKeyInput = document.getElementById('market-api-key'); // HTML에는 없지만 에러 방지용
    const loadDataBtn = document.getElementById('load-data-btn');
    const resultLogEl = document.getElementById('result-log');
    const testCardValueEl = document.querySelector('#kpi-test_data .value');
    
    // --- API & DATA HANDLING ---
    async function fetchEcosData(apiKey, codeInfo, startDate, endDate) {
        const params = new URLSearchParams({
            apikey: apiKey,
            statcode: codeInfo.statcode,
            cycle: codeInfo.cycle,
            start: startDate,
            end: endDate,
            itemcode: codeInfo.itemcode
        });
        const url = `/api/ecos?${params.toString()}`;
        
        console.log(`Requesting ECOS: ${url.replace(apiKey, 'REDACTED')}`);
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`[Front-end] Server responded with status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.error) {
            throw new Error(`[API Error] ${data.details || data.error}`);
        }

        if (data.StatisticSearch && data.StatisticSearch.row) {
            return data.StatisticSearch.row.map(item => ({ 
                date: item.TIME, 
                value: parseFloat(item.DATA_VALUE) 
            }));
        }
        return [];
    }
    
    // --- INITIALIZATION & EVENT LISTENERS ---
    function init() {
        if (!loadDataBtn) {
            console.error("CRITICAL: '데이터 불러오기' 버튼을 찾을 수 없습니다.");
            return;
        }
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
        if (resultLogEl) resultLogEl.textContent = 'ECOS API 호출을 시작합니다...';

        try {
            const today = new Date();
            const ecosMonthlyEndDate = today.toISOString().slice(0, 7).replace('-', '');
            today.setFullYear(today.getFullYear() - 5);
            const ecosMonthlyStartDate = today.toISOString().slice(0, 7).replace('-', '');
            
            // 오직 M2 데이터 하나만 요청
            const testData = await fetchEcosData(ecosKey, ECOS_CODES.m2_raw, ecosMonthlyStartDate, ecosMonthlyEndDate);

            if (testData.length > 0) {
                console.log('✅ ECOS (M2) 데이터 로딩 성공!', testData);
                if (resultLogEl) {
                    resultLogEl.textContent = '✅ ECOS API 호출 성공!\n\n';
                    resultLogEl.textContent += `가져온 데이터 개수: ${testData.length}\n`;
                    resultLogEl.textContent += `최신 데이터: ${testData[testData.length - 1].date} / ${testData[testData.length - 1].value.toLocaleString()}`;
                }
                if(testCardValueEl) testCardValueEl.textContent = testData[testData.length-1].value.toLocaleString();
            } else {
                // 이 경우는 "해당하는 데이터가 없습니다" 와 같은 응답
                throw new Error("API 호출은 성공했으나, ECOS 서버가 빈 데이터를 반환했습니다. (정보-200)");
            }
            
            apiKeySection.classList.add('hidden');
            dashboardContainer.classList.remove('hidden');

        } catch (error) {
            console.error('❌ ECOS 데이터 로딩 실패:', error);
            if (resultLogEl) {
                resultLogEl.textContent = `❌ ECOS API 호출 실패!\n\n에러 메시지: ${error.message}`;
            }
            if (testCardValueEl) {
                document.querySelector('#kpi-test_data .title').textContent = "호출 실패";
                testCardValueEl.textContent = "Error";
            }
            apiKeySection.classList.add('hidden');
            dashboardContainer.classList.remove('hidden');
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    }
    
    // --- Start the App ---
    init();
});