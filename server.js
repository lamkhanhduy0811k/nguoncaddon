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

// Xử lý Poster qua wsrv.nl chuẩn định dạng để Nuvio hiển thị 100% ảnh
function fixPoster(url) {
    if (!url) return 'https://wsrv.nl/?url=https://via.placeholder.com/300x450.png';
    let clean = url.trim();
    if (clean.startsWith('//')) clean = 'https:' + clean;
    if (clean.startsWith('http://')) clean = clean.replace('http://', 'https://');
    if (!clean.startsWith('http')) {
        clean = 'https://phim.nguonc.com' + (clean.startsWith('/') ? '' : '/') + clean;
    }
    return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=300&h=450&fit=cover`;
}

// Đổi ID v14 để Nuvio bắt buộc tải mới toàn bộ dữ liệu 500 phim
const manifest = {
    id: 'com.nguonc.phim.v14',
    version: '1.4.0',
    name: 'Siêu Tầm Phim (Nguồn C)',
    description: 'Xem phim Vietsub/Thuyết minh từ Nguồn C (500+ Phim)',
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

// Tải 25 trang cùng lúc (~500 phim)
async function fetch500Films(type) {
    const endpointBase = type === 'series' 
        ? `${NGUONC_API}/films/danh-sach/phim-bo?page=` 
        : `${NGUONC_API}/films/phim-moi-cap-nhat?page=`;

    const pageNumbers = Array.from({ length: 25 }, (_, i) => i + 1);

    const fetchPage = async (page) => {
        const targetUrl = `${endpointBase}${page}`;
        try {
            const res = await axios.get(targetUrl, {
                timeout: 4000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            return res.data?.items || [];
        } catch (e) {
            try {
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
                const res = await axios.get(proxyUrl, { timeout: 5000 });
                return res.data?.items || [];
            } catch (err) {
                return [];
            }
        }
    };

    const results = await Promise.all(pageNumbers.map(page => fetchPage(page)));
    const allItems = results.flat();

    const metas = allItems.map(item => ({
        id: `nguonc_${item.slug}`,
        type: type === 'series' ? 'series' : 'movie',
        name: item.name || 'Phim Nguồn C',
        poster: fixPoster(item.thumb_url || item.poster_url),
        posterShape: 'poster',
        description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
    }));

    return metas;
}

// Catalog Route
app.get('/catalog/:type/:id*', async (req, res) => {
    const metas = await fetch500Films(req.params.type);
    res.json({ metas });
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('nguonc_', '');

        let movie = null;
        try {
            const res1 = await axios.get(`${NGUONC_API}/film/${rawId}`, { timeout: 4000 });
            movie = res1.data?.movie;
        } catch(e) {}

        if (!movie) {
            try {
                const res2 = await axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(NGUONC_API + '/film/' + rawId)}`, { timeout: 5000 });
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
            const res1 = await axios.get(`${NGUONC_API}/film/${slug}`, { timeout: 4000 });
            movie = res1.data?.movie;
        } catch(e) {}

        if (!movie) {
            try {
                const res2 = await axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(NGUONC_API + '/film/' + slug)}`, { timeout: 5000 });
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
        
