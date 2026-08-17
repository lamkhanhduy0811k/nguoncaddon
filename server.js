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

// Poster dự phòng vĩnh viễn không bị xóa
const FALLBACK_POSTER = 'https://placehold.co/300x450/111827/ffffff.png?text=Phim+Nguon+C';

function fixPoster(url) {
    if (!url) return FALLBACK_POSTER;
    let clean = url.trim();
    if (clean.startsWith('//')) clean = 'https:' + clean;
    if (clean.startsWith('http://')) clean = clean.replace('http://', 'https://');
    if (!clean.startsWith('http')) {
        clean = 'https://phim.nguonc.com' + (clean.startsWith('/') ? '' : '/') + clean;
    }
    return `https://images.weserv.nl/?url=${encodeURIComponent(clean)}&w=300&h=450&fit=cover&errorredirect=${encodeURIComponent(FALLBACK_POSTER)}`;
}

// Manifest v2.1.0 ép Nuvio reset toàn bộ cache
const manifest = {
    id: 'com.nguonc.phim.v21',
    version: '2.1.0',
    name: 'Siêu Tầm Phim (Nguồn C)',
    description: 'Xem phim Vietsub/Thuyết minh từ Nguồn C',
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

// Bộ xoay vòng 4 Proxy liên tục nếu bị chặn
async function fetchWithRetry(url) {
    const proxies = [
        (u) => u,
        (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
        (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
    ];

    for (const getProxyUrl of proxies) {
        try {
            const target = getProxyUrl(url);
            const res = await axios.get(target, {
                timeout: 3000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                }
            });
            const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
            if (data?.items?.length > 0 || data?.movie) {
                return data;
            }
        } catch (e) {}
    }
    return null;
}

// Lấy Catalog Phim
app.get('/catalog/:type/:id*', async (req, res) => {
    const type = req.params.type;
    const endpoint = type === 'series' 
        ? '/films/danh-sach/phim-bo?page=1' 
        : '/films/phim-moi-cap-nhat?page=1';

    const data = await fetchWithRetry(`${NGUONC_API}${endpoint}`);
    const items = data?.items || [];

    if (items.length > 0) {
        const metas = items.map(item => ({
            id: `nguonc_${item.slug}`,
            type: type === 'series' ? 'series' : 'movie',
            name: item.name || 'Phim Nguồn C',
            poster: fixPoster(item.thumb_url || item.poster_url),
            posterShape: 'poster',
            description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
        }));
        return res.json({ metas });
    }

    // Fallback khẩn cấp nếu tất cả Proxy bị nghẽn cùng lúc
    res.json({
        metas: [
            {
                id: 'nguonc_trong-khi',
                type: type,
                name: 'Trọng Khí (2026)',
                poster: fixPoster('https://phim.nguonc.com/uploads/movies/trong-khi-thumb.jpg'),
                posterShape: 'poster',
                description: 'Phim Nguồn C'
            },
            {
                id: 'nguonc_tan-thuoc',
                type: type,
                name: 'Tàn Thuốc (2026)',
                poster: fixPoster('https://phim.nguonc.com/uploads/movies/tan-thuoc-thumb.jpg'),
                posterShape: 'poster',
                description: 'Phim Nguồn C'
            }
        ]
    });
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('nguonc_', '');

        const data = await fetchWithRetry(`${NGUONC_API}/film/${rawId}`);
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

        const data = await fetchWithRetry(`${NGUONC_API}/film/${slug}`);
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
