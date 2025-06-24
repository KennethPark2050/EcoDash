// api/alpha.js
export default async function handler(request, response) {
    // Vercel 환경에서는 request.query로 파라미터를 받습니다.
    const { func, symbol, apikey } = request.query;

    if (!func || !symbol || !apikey) {
        return response.status(400).json({ error: 'Missing required query parameters' });
    }

    const symbolQuery = func === 'FX_DAILY' ? `from_symbol=${symbol.split('/')[0]}&to_symbol=${symbol.split('/')[1]}` : `symbol=${symbol}`;
    const url = `https://www.alphavantage.co/query?function=${func}&${symbolQuery}&outputsize=full&apikey=${apikey}`;

    try {
        const apiResponse = await fetch(url);
        const data = await apiResponse.json();

        if (data["Error Message"] || data["Information"]) {
            return response.status(500).json({ error: 'Alpha Vantage API error', details: data });
        }
        
        // 캐시 설정으로 API 호출 줄이기 (1시간 캐시)
        response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
        return response.status(200).json(data);
    } catch (error) {
        return response.status(500).json({ error: 'Failed to fetch from API', details: error.message });
    }
}