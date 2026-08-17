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

// Chuẩn hóa link poster qua Weserv Proxy (Tránh nhà mạng VN chặn & bypass chống lấy cắp ảnh)
function fixPoster(url) {
    if (!url) return 'https://i.imgur.com/Q2AU42q.png';
    let clean = url.trim();
    if (clean.startsWith('//')) clean = 'https:' + clean;
    if (clean.startsWith('http://')) clean = clean.replace('http://', 'https://');
    if (!clean.startsWith('http')) {
        clean = 'https://phim.nguonc.com' + (clean.startsWith('/') ? '' : '/') + clean;
    }
    return `https://images.weserv.nl/?url=${encodeURIComponent(clean)}&w=300&h=450&fit=cover&errorredirect=https://i.imgur.com/Q2AU42q.png`;
}

// Manifest v2.0.0 làm mới cache Nuvio
const manifest = {
    id: 'com.nguonc.phim.v20',
    version: '2.0.0',
    name: 'Siêu Tầm Phim (Nguồn C)',
    description: 'Xem phim Vietsub/Thuyết minh từ Nguồn C (Full Danh Sách)',
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

// Lấy dữ liệu 1 trang API kèm Header trình duyệt
async function fetchPage(type, page = 1) {
    const endpoint = type === 'series' 
        ? `/films/danh-sach/phim-bo?page=${page}` 
        : `/films/phim-moi-cap-nhat?page=${page}`;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    };

    try {
        const res = await axios.get(`${NGUONC_API}${endpoint}`, { headers, timeout: 3000 });
        if (res.data?.items?.length > 0) return res.data.items;
    } catch (e) {}

    try {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(NGUONC_API + endpoint)}`;
        const res = await axios.get(proxyUrl, { timeout: 3500 });
        if (res.data?.items?.length > 0) return res.data.items;
    } catch (e) {}

    return [];
}

// Tải song song 5 trang (~100 phim thật) cực nhanh
async function getCatalog(type) {
    const pages = [1, 2, 3, 4, 5];
    const results = await Promise.allSettled(pages.map(p => fetchPage(type, p)));
    
    let allItems = [];
    results.forEach(res => {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
            allItems = allItems.concat(res.value);
        }
    });

    if (allItems.length > 0) {
        return allItems.map(item => ({
            id: `nguonc_${item.slug}`,
            type: type === 'series' ? 'series' : 'movie',
            name: item.name || 'Phim Nguồn C',
            poster: fixPoster(item.thumb_url || item.poster_url),
            posterShape: 'poster',
            description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
        }));
    }

    return [
        {
            id: 'nguonc_demo',
            type: type,
            name: 'Nguồn C Đang Đang Cập Nhật',
            poster: 'https://i.imgur.com/Q2AU42q.png',
            posterShape: 'poster',
            description: 'Vui lòng làm mới lại trang'
        }
    ];
}

// Catalog Route
app.get('/catalog/:type/:id*', async (req, res) => {
    const metas = await getCatalog(req.params.type);
    res.json({ metas });
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('nguonc_', '');

        let movie = null;
        try {
            const res1 = await axios.get(`${NGUONC_API}/film/${rawId}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 3000
            });
            movie = res1.data?.movie;
        } catch(e) {}

        if (!movie) {
            try {
                const res2 = await axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(NGUONC_API + '/film/' + rawId)}`, { timeout: 3500 });
                movie = res2.data?.movie;
            } catch(e) {}
        }

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

        let movie = null;
        try {
            const res1 = await axios.get(`${NGUONC_API}/film/${slug}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 3000
            });
            movie = res1.data?.movie;
        } catch(e) {}

        if (!movie) {
            try {
                const res2 = await axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(NGUONC_API + '/film/' + slug)}`, { timeout: 3500 });
                movie = res2.data?.movie;
            } catch(e) {}
        }

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
        
