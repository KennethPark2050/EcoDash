// api/ecos.js
export default async function handler(request, response) {
    const { apikey, statcode, cycle, start, end, itemcode } = request.query;

    if (!apikey || !statcode || !cycle || !start || !end || !itemcode) {
        return response.status(400).json({ error: 'Missing required query parameters' });
    }

    const url = `https://ecos.bok.or.kr/api/StatisticSearch/${apikey}/json/kr/1/10000/${statcode}/${cycle}/${start}/${end}/${itemcode}`;

    try {
        const apiResponse = await fetch(url);
        const data = await apiResponse.json();

        if (data.RESULT && data.RESULT.CODE !== 'INFO-000') {
            return response.status(500).json({ error: 'ECOS API returned an error', details: data.RESULT.MESSAGE });
        }
        
        // 캐시 설정 (하루 캐시)
        response.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
        return response.status(200).json(data);
    } catch (error) {
        return response.status(500).json({ error: 'Failed to fetch from API', details: error.message });
    }
}