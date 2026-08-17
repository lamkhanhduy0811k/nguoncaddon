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

// Route Proxy tải ảnh trực tiếp từ Vercel (Giải quyết 100% lỗi poster đen thui)
app.get('/poster', async (req, res) => {
    const imgUrl = req.query.url;
    if (!imgUrl) return res.redirect('https://image.tmdb.org/t/p/w500/7WsyChLLEz336bd3XD3Y938A9A2.jpg');

    try {
        const response = await axios.get(imgUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://phim.nguonc.com/'
            },
            timeout: 6000
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(Buffer.from(response.data));
    } catch (e) {
        res.redirect('https://image.tmdb.org/t/p/w500/7WsyChLLEz336bd3XD3Y938A9A2.jpg');
    }
});

function fixPoster(url, host) {
    if (!url) return 'https://image.tmdb.org/t/p/w500/7WsyChLLEz336bd3XD3Y938A9A2.jpg';
    let clean = url.trim();
    if (clean.startsWith('//')) clean = 'https:' + clean;
    if (clean.startsWith('http://')) clean = clean.replace('http://', 'https://');
    if (!clean.startsWith('http')) {
        clean = 'https://phim.nguonc.com' + (clean.startsWith('/') ? '' : '/') + clean;
    }
    return `https://${host}/poster?url=${encodeURIComponent(clean)}`;
}

// Manifest v1.7.0
const manifest = {
    id: 'com.nguonc.phim.v17',
    version: '1.7.0',
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

// Gọi API Nguồn C qua các Proxy dự phòng
async function fetchNguonCAPI(endpoint) {
    const targetUrl = `${NGUONC_API}${endpoint}`;

    try {
        const res = await axios.get(targetUrl, {
            timeout: 3500,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (res.data?.items || res.data?.movie) return res.data;
    } catch (e) {}

    try {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        const res = await axios.get(proxyUrl, { timeout: 4500 });
        if (res.data?.items || res.data?.movie) return res.data;
    } catch (e) {}

    try {
        const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
        const res = await axios.get(proxyUrl, { timeout: 4500 });
        if (res.data?.items || res.data?.movie) return res.data;
    } catch (e) {}

    return null;
}

// Catalog Route
app.get('/catalog/:type/:id*', async (req, res) => {
    const host = req.headers.host;
    const type = req.params.type;
    const endpoint = type === 'series' 
        ? '/films/danh-sach/phim-bo?page=1' 
        : '/films/phim-moi-cap-nhat?page=1';

    const data = await fetchNguonCAPI(endpoint);
    const items = data?.items || [];

    const metas = items.map(item => ({
        id: `nguonc_${item.slug}`,
        type: type === 'series' ? 'series' : 'movie',
        name: item.name || 'Phim Nguồn C',
        poster: fixPoster(item.thumb_url || item.poster_url, host),
        posterShape: 'poster',
        description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
    }));

    res.json({ metas });
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    const host = req.headers.host;
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('nguonc_', '');

        const data = await fetchNguonCAPI(`/film/${rawId}`);
        const movie = data?.movie;

        if (!movie) return res.json({ meta: null });

        res.json({
            meta: {
                id: `nguonc_${movie.slug}`,
                type: req.params.type,
                name: movie.name,
                poster: fixPoster(movie.thumb_url || movie.poster_url, host),
                background: fixPoster(movie.poster_url || movie.thumb_url, host),
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

        const data = await fetchNguonCAPI(`/film/${slug}`);
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
                
