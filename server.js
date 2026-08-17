const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Bật CORS toàn diện cho Nuvio và Web Player
app.use(cors());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    next();
});

const NGUONC_API = 'https://phim.nguonc.com/api';

// Chuẩn hóa link ảnh sang HTTPS để Nuvio không bị chặn
function fixUrl(url) {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('http://')) return url.replace('http://', 'https://');
    if (!url.startsWith('http')) return 'https://phim.nguonc.com' + (url.startsWith('/') ? '' : '/') + url;
    return url;
}

const manifest = {
    id: 'com.sieutamphim.nguonc',
    version: '1.0.3',
    name: 'Siêu Tầm Phim (Nguồn C)',
    description: 'Xem phim Vietsub/Thuyết minh từ Nguồn C trên Nuvio / Stremio',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['nguonc_'],
    catalogs: [
        {
            type: 'movie',
            id: 'nguonc_movie_catalog',
            name: 'Nguồn C - Phim Mới',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'nguonc_series_catalog',
            name: 'Nguồn C - Phim Bộ',
            extra: [{ name: 'search', isRequired: false }]
        }
    ]
};

app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

// 1. Xử lý Catalog (Bắt mọi đường dẫn mở rộng từ Nuvio)
app.get('/catalog/:type/:id*', async (req, res) => {
    const { type } = req.params;
    const fullPath = req.params[0] || '';

    let searchQuery = '';
    if (fullPath.includes('search=')) {
        const match = fullPath.match(/search=([^/&.]+)/);
        if (match) searchQuery = decodeURIComponent(match[1]);
    }

    try {
        let url = `${NGUONC_API}/films/phim-moi-cap-nhat?page=1`;
        if (searchQuery) {
            url = `${NGUONC_API}/films/search?keyword=${encodeURIComponent(searchQuery)}`;
        }

        const response = await axios.get(url, { timeout: 8000 });
        const items = response.data.items || [];

        const metas = items.map(item => ({
            id: `nguonc_${item.slug}`,
            type: type === 'series' ? 'series' : 'movie',
            name: item.name,
            poster: fixUrl(item.thumb_url || item.poster_url),
            posterShape: 'poster',
            description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
        }));

        res.json({ metas });
    } catch (e) {
        res.json({ metas: [] });
    }
});

// 2. Xử lý Meta (Chi tiết phim)
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '');
        const slug = rawId.replace('nguonc_', '');

        const response = await axios.get(`${NGUONC_API}/film/${slug}`, { timeout: 8000 });
        const movie = response.data.movie;

        if (!movie) return res.json({ meta: null });

        res.json({
            meta: {
                id: `nguonc_${movie.slug}`,
                type: req.params.type,
                name: movie.name,
                poster: fixUrl(movie.thumb_url || movie.poster_url),
                background: fixUrl(movie.poster_url || movie.thumb_url),
                description: movie.description ? movie.description.replace(/<[^>]*>?/gm, '') : '',
                year: movie.year ? String(movie.year) : ''
            }
        });
    } catch (e) {
        res.json({ meta: null });
    }
});

// 3. Xử lý Stream (Link xem phim)
app.get('/stream/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '');
        const cleanId = rawId.replace('nguonc_', '');

        const parts = cleanId.split(':');
        const slug = parts[0];
        const epIndex = parts[1] ? parseInt(parts[1]) - 1 : 0;

        const response = await axios.get(`${NGUONC_API}/film/${slug}`, { timeout: 8000 });
        const movie = response.data.movie;
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
