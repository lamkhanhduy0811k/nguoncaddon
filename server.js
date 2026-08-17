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

// Bắt buộc qua wsrv.nl để bypass chống lấy cắp ảnh (mới hiện được Poster)
function fixPoster(url) {
    if (!url) return 'https://via.placeholder.com/300x450?text=No+Image';
    let fullUrl = url;
    if (fullUrl.startsWith('//')) fullUrl = 'https:' + fullUrl;
    if (fullUrl.startsWith('http://')) fullUrl = fullUrl.replace('http://', 'https://');
    if (!fullUrl.startsWith('http')) fullUrl = 'https://phim.nguonc.com' + (fullUrl.startsWith('/') ? '' : '/') + fullUrl;
    
    return `https://wsrv.nl/?url=${encodeURIComponent(fullUrl)}&w=300&h=450&fit=cover`;
}

const manifest = {
    id: 'com.nguonc.phim.v12',
    version: '1.2.0',
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

// Gọi API tự động qua Proxy để vượt Cloudflare
async function fetchNguonC(endpoint) {
    const targetUrl = `${NGUONC_API}${endpoint}`;
    
    // Thử gọi trực tiếp
    try {
        const res = await axios.get(targetUrl, {
            timeout: 4000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (res.data?.items || res.data?.movie) return res.data;
    } catch (e) {
        console.log('Chuyển sang Proxy...');
    }

    // Nếu bị Cloudflare chặn -> Đi qua CorsProxy
    try {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
        const res = await axios.get(proxyUrl, { timeout: 6000 });
        return res.data;
    } catch (e) {
        return null;
    }
}

// Catalog Route
app.get('/catalog/:type/:id*', async (req, res) => {
    const type = req.params.type;
    const endpoint = type === 'series' ? '/films/danh-sach/phim-bo?page=1' : '/films/phim-moi-cap-nhat?page=1';
    
    const data = await fetchNguonC(endpoint);
    const items = data?.items || [];

    const metas = items.map(item => ({
        id: `nguonc_${item.slug}`,
        type: type === 'series' ? 'series' : 'movie',
        name: item.name || 'Phim Mới',
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

        const data = await fetchNguonC(`/film/${rawId}`);
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

        const data = await fetchNguonC(`/film/${slug}`);
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
