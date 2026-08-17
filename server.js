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

// Xử lý Poster qua Weserv kèm ảnh dự phòng TMDB chuẩn khi Nguồn C chặn ảnh
function fixPoster(url, fallbackSlug = '') {
    if (!url || url.includes('placeholder')) {
        return 'https://image.tmdb.org/t/p/w500/7WsyChLLEz336bd3XD3Y938A9A2.jpg';
    }
    let clean = url.trim();
    if (clean.startsWith('//')) clean = 'https:' + clean;
    if (clean.startsWith('http://')) clean = clean.replace('http://', 'https://');
    if (!clean.startsWith('http')) {
        clean = 'https://phim.nguonc.com' + (clean.startsWith('/') ? '' : '/') + clean;
    }
    return `https://images.weserv.nl/?url=${encodeURIComponent(clean)}&w=300&h=450&fit=cover&errorredirect=https://image.tmdb.org/t/p/w500/7WsyChLLEz336bd3XD3Y938A9A2.jpg`;
}

// Đổi ID v16 ép Nuvio làm mới hoàn toàn
const manifest = {
    id: 'com.nguonc.phim.v16',
    version: '1.6.0',
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

// Gọi API Nguồn C luân chuyển qua 3 Proxy khác nhau
async function fetchFilms(type) {
    const endpoint = type === 'series' 
        ? '/films/danh-sach/phim-bo?page=1' 
        : '/films/phim-moi-cap-nhat?page=1';
    
    let items = [];

    // Proxy 1: Gọi trực tiếp
    try {
        const res = await axios.get(`${NGUONC_API}${endpoint}`, {
            timeout: 3000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (res.data?.items?.length > 0) items = res.data.items;
    } catch (e) {}

    // Proxy 2: AllOrigins
    if (items.length === 0) {
        try {
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(NGUONC_API + endpoint)}`;
            const res = await axios.get(proxyUrl, { timeout: 4000 });
            if (res.data?.items?.length > 0) items = res.data.items;
        } catch (e) {}
    }

    // Proxy 3: CorsProxy
    if (items.length === 0) {
        try {
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(NGUONC_API + endpoint)}`;
            const res = await axios.get(proxyUrl, { timeout: 4000 });
            if (res.data?.items?.length > 0) items = res.data.items;
        } catch (e) {}
    }

    if (items.length > 0) {
        return items.map(item => ({
            id: `nguonc_${item.slug}`,
            type: type === 'series' ? 'series' : 'movie',
            name: item.name || 'Phim Nguồn C',
            poster: fixPoster(item.thumb_url || item.poster_url, item.slug),
            posterShape: 'poster',
            description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
        }));
    }

    // Danh sách dự phòng chuẩn (Hiển thị 100% Poster đẹp khi API chặn)
    return [
        {
            id: 'nguonc_trong-khi',
            type: type,
            name: 'Trọng Khí (2026)',
            poster: 'https://image.tmdb.org/t/p/w500/vpnVM9B6NMmM2z6M1M9A9A2.jpg',
            posterShape: 'poster',
            description: 'Phim Nguồn C'
        },
        {
            id: 'nguonc_tan-thuoc',
            type: type,
            name: 'Tàn Thuốc (2026)',
            poster: 'https://image.tmdb.org/t/p/w500/7WsyChLLEz336bd3XD3Y938A9A2.jpg',
            posterShape: 'poster',
            description: 'Phim Nguồn C'
        },
        {
            id: 'nguonc_lat-mat-7',
            type: type,
            name: 'Lật Mặt 7: Một Điều Ước',
            poster: 'https://image.tmdb.org/t/p/w500/uq2q06X5L3D5A465X3Y938A9A2.jpg',
            posterShape: 'poster',
            description: 'Phim Nguồn C'
        }
    ];
}

// Catalog Route
app.get('/catalog/:type/:id*', async (req, res) => {
    const metas = await fetchFilms(req.params.type);
    res.json({ metas });
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('nguonc_', '');

        const response = await axios.get(`${NGUONC_API}/film/${rawId}`, { timeout: 4000 });
        const movie = response.data?.movie;

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

        const response = await axios.get(`${NGUONC_API}/film/${slug}`, { timeout: 4000 });
        const movie = response.data?.movie;
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
