const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(cors());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    next();
});

const NGUONC_API = 'https://phim.nguonc.com/api';

// Chuẩn hóa link ảnh trực tiếp từ máy chủ Nguồn C
function fixPoster(url) {
    if (!url) return '';
    let clean = String(url).trim();
    if (clean.startsWith('//')) clean = 'https:' + clean;
    if (clean.startsWith('http://')) clean = clean.replace('http://', 'https://');
    if (!clean.startsWith('http')) {
        clean = 'https://phim.nguonc.com' + (clean.startsWith('/') ? '' : '/') + clean;
    }
    return clean;
}

// Manifest v2.2.0 ép Nuvio làm mới bộ nhớ đệm
const manifest = {
    id: 'com.nguonc.phim.v22',
    version: '2.2.0',
    name: 'Siêu Tầm Phim (Nguồn C)',
    description: 'Xem phim Vietsub/Thuyết minh từ Nguồn C (Bản Chuẩn)',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['nguonc_'],
    catalogs: [
        {
            type: 'movie',
            id: 'nguonc_movie',
            name: 'Nguồn C - Phim Mới'
        },
        {
            type: 'series',
            id: 'nguonc_series',
            name: 'Nguồn C - Phim Bộ'
        }
    ]
};

app.get('/', (req, res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

// Gọi API song song (Cổng nào phản hồi nhanh nhất dưới 2 giây sẽ lấy ngay)
async function fetchFastAPI(endpoint) {
    const targetUrl = `${NGUONC_API}${endpoint}`;
    
    const fetchers = [
        axios.get(targetUrl, {
            timeout: 2200,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        }),
        axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, { timeout: 2500 }),
        axios.get(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`, { timeout: 2500 })
    ];

    try {
        const response = await Promise.any(fetchers);
        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        if (data?.items || data?.movie) return data;
    } catch (e) {}

    return null;
}

// Catalog Route
app.get('/catalog/:type/:id*', async (req, res) => {
    const type = req.params.type;
    const endpoint = type === 'series' 
        ? '/films/danh-sach/phim-bo?page=1' 
        : '/films/phim-moi-cap-nhat?page=1';

    const data = await fetchFastAPI(endpoint);
    const items = data?.items || [];

    const metas = items.map(item => ({
        id: `nguonc_${item.slug}`,
        type: type === 'series' ? 'series' : 'movie',
        name: item.name || 'Phim Nguồn C',
        poster: fixPoster(item.thumb_url || item.poster_url),
        posterShape: 'poster',
        description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
    }));

    res.json({ metas });
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('nguonc_', '');

        const data = await fetchFastAPI(`/film/${rawId}`);
        const movie = data?.movie;

        if (!movie) return res.json({ meta: null });

        res.json({
            meta: {
                id: `nguonc_${movie.slug}`,
                type: req.params.type,
                name: movie.name,
                poster: fixPoster(movie.thumb_url || movie.poster_url),
                background: fixPoster(movie.poster_url || movie.thumb_url),
                description: movie.description ? movie.description.replace(/<[^>]*>?/gm, '') : '',
                year: movie.year ? String(movie.year) : ''
            }
        });
    } catch (e) {
        res.json({ meta: null });
    }
});

// Stream Route
app.get('/stream/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('nguonc_', '');

        const parts = rawId.split(':');
        const slug = parts[0];
        const epIndex = parts[1] ? parseInt(parts[1]) - 1 : 0;

        const data = await fetchFastAPI(`/film/${slug}`);
        const movie = data?.movie;
        const episodes = movie?.episodes?.[0]?.items || [];
        const ep = episodes[epIndex] || episodes[0];

        if (!ep) return res.json({ streams: [] });

        const streams = [];
        if (ep.m3u8) {
            streams.push({
                title: `Nguồn C - ${ep.name || 'Full'} (m3u8)`,
                url: ep.m3u8
            });
        }

        res.json({ streams });
    } catch (e) {
        res.json({ streams: [] });
    }
});

module.exports = app;
