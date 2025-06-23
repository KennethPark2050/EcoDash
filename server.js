// server.js (최종 안정화 버전 - 코드 순서 보장)
const express = require('express');
const app = express();
const port = 3000;

// --- 1. API 라우트 먼저 정의 ---

// Alpha Vantage API 프록시
app.get('/api/alpha', async (req, res) => {
    // ... (이전 답변의 코드와 동일, 변경 없음)
    const { func, symbol, apikey } = req.query;
    if (!func || !symbol || !apikey) return res.status(400).json({ error: 'Missing required query parameters' });
    const symbolQuery = func === 'FX_DAILY' ? `from_symbol=${symbol.split('/')[0]}&to_symbol=${symbol.split('/')[1]}` : `symbol=${symbol}`;
    const url = `https://www.alphavantage.co/query?function=${func}&${symbolQuery}&outputsize=full&apikey=${apikey}`;
    try {
        const apiResponse = await fetch(url);
        if (!apiResponse.ok) throw new Error(`API server status: ${apiResponse.status}`);
        const data = await apiResponse.json();
        if (data["Error Message"] || data["Information"]) return res.status(500).json({ error: 'API limit or invalid request', details: data });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch from API', details: error.message });
    }
});

// ECOS API 프록시
app.get('/api/ecos', async (req, res) => {
    // ... (이전 답변의 코드와 동일, 변경 없음)
    const { apikey, statcode, cycle, start, end, itemcode } = req.query;
    if (!apikey || !statcode || !cycle || !start || !end || !itemcode) return res.status(400).json({ error: 'Missing required query parameters' });
    const url = `https://ecos.bok.or.kr/api/StatisticSearch/${apikey}/json/kr/1/10000/${statcode}/${cycle}/${start}/${end}/${itemcode}`;
    try {
        const apiResponse = await fetch(url);
        if (!apiResponse.ok) throw new Error(`API server status: ${apiResponse.status}`);
        const data = await apiResponse.json();
        if (data.RESULT && data.RESULT.CODE !== 'INFO-000') return res.status(500).json({ error: 'ECOS API returned an error', details: data.RESULT.MESSAGE });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch from API', details: error.message });
    }
});

// --- 2. 정적 파일 서비스 미들웨어는 API 라우트 뒤에 위치 ---
// 현재 폴더(.)에 있는 index.html, style.css, script.js 등을 제공
app.use(express.static('.'));


// --- 3. 서버 리스닝은 맨 마지막에 ---
// 모든 네트워크 인터페이스(0.0.0.0)에서 오는 요청을 받도록 설정
app.listen(port, '0.0.0.0', () => { 
    console.log(`✅ Server is running and listening on port ${port} for all interfaces.`);
});
