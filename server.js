// server.js (Node.js v18+ 최종 버전 - node-fetch 불필요)
const express = require('express');
// const fetch = require('node-fetch'); // Node.js v18 이상에서는 이 줄이 필요 없습니다!

const app = express();
const port = 3000;

// Alpha Vantage API 프록시
app.get('/api/alpha', async (req, res) => {
    const { func, symbol, apikey } = req.query;
    if (!func || !symbol || !apikey) {
        return res.status(400).json({ error: 'Missing required query parameters for Alpha Vantage' });
    }
    
    // Alpha Vantage의 환율 티커는 '/'를 포함하므로 직접 사용합니다.
    const symbolQuery = func === 'FX_DAILY' ? `from_symbol=${symbol.split('/')[0]}&to_symbol=${symbol.split('/')[1]}` : `symbol=${symbol}`;
    const url = `https://www.alphavantage.co/query?function=${func}&${symbolQuery}&outputsize=full&apikey=${apikey}`;
    
    console.log(`[Proxy] Requesting Alpha Vantage: ${url.replace(apikey, 'REDACTED')}`);

    try {
        // Node.js에 내장된 fetch를 직접 사용합니다.
        const apiResponse = await fetch(url); 
        if (!apiResponse.ok) { // HTTP 상태 코드가 200-299가 아닌 경우
            throw new Error(`API server responded with status: ${apiResponse.status}`);
        }
        const data = await apiResponse.json();
        if (data["Error Message"] || data["Information"]) {
            console.error('[Proxy Error] Alpha Vantage API Error:', data);
            return res.status(500).json({ error: 'Alpha Vantage API limit reached or invalid request', details: data });
        }
        res.json(data);
    } catch (error) {
        console.error('[Proxy Error] Alpha Vantage Proxy Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch from Alpha Vantage API', details: error.message });
    }
});

// ECOS API 프록시
app.get('/api/ecos', async (req, res) => {
    const { apikey, statcode, cycle, start, end, itemcode } = req.query;
    if (!apikey || !statcode || !cycle || !start || !end || !itemcode) {
         return res.status(400).json({ error: 'Missing required query parameters for ECOS' });
    }
    const url = `https://ecos.bok.or.kr/api/StatisticSearch/${apikey}/json/kr/1/10000/${statcode}/${cycle}/${start}/${end}/${itemcode}`;
    
    console.log(`[Proxy] Requesting ECOS: ${url.replace(apikey, 'REDACTED')}`);

    try {
        // Node.js에 내장된 fetch를 직접 사용합니다.
        const apiResponse = await fetch(url);
        if (!apiResponse.ok) {
            throw new Error(`API server responded with status: ${apiResponse.status}`);
        }
        const data = await apiResponse.json();
        if (data.RESULT && data.RESULT.CODE !== 'INFO-000') {
             console.error('[Proxy Error] ECOS API Error:', data.RESULT.MESSAGE);
             return res.status(500).json({ error: 'ECOS API returned an error', details: data.RESULT.MESSAGE });
        }
        res.json(data);
    } catch (error) {
        console.error('[Proxy Error] ECOS Proxy Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch from ECOS API', details: error.message });
    }
});

// 프론트엔드 정적 파일 서비스
app.use(express.static('.'));

app.listen(port, () => {
    console.log(`✅ Proxy server listening at http://localhost:${port}`);
    console.log('이제 브라우저에서 http://localhost:3000 으로 접속하세요.');
});