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

const API_BASE = 'https://phimapi.com';
const CDN_IMAGE = 'https://phimimg.com';

// Hàm chuẩn hóa ảnh poster - Bao mượt 100% không bị xám
function formatPoster(url) {
    if (!url) return 'https://image.tmdb.org/t/p/w500/1E5ba88S318X4Pz2goR2vKCoBu.jpg';
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    return `${CDN_IMAGE}/${url.replace(/^\//, '')}`;
}

// Manifest v8.0.0 chuẩn giao diện Nuvio
const manifest = {
    id: 'com.suutamphim.nuvio.v8',
    version: '8.0.0',
    name: 'Sưu Tầm Phim',
    description: 'Xem phim Vietsub/Thuyết minh chất lượng cao',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['phim_'],
    catalogs: [
        {
            type: 'movie',
            id: 'phim_moi',
            name: 'Sưu Tầm Phim - Phim Mới Cập Nhật'
        },
        {
            type: 'series',
            id: 'phim_han_quoc',
            name: 'Sưu Tầm Phim - Phim Hàn Quốc'
        },
        {
            type: 'series',
            id: 'phim_hong_kong',
            name: 'Sưu Tầm Phim - Phim Hồng Kông'
        }
    ]
};

app.get('/', (req, res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

// Catalog Route
app.get('/catalog/:type/:id*', async (req, res) => {
    const id = req.params.id;
    let url = `${API_BASE}/danh-sach/phim-moi-cap-nhat?page=1`;

    if (id === 'phim_han_quoc') {
        url = `${API_BASE}/v1/api/quoc-gia/han-quoc?page=1`;
    } else if (id === 'phim_hong_kong') {
        url = `${API_BASE}/v1/api/quoc-gia/hong-kong?page=1`;
    }

    try {
        const apiRes = await axios.get(url, { timeout: 4000 });
        const data = apiRes.data;
        const items = data?.items || data?.data?.items || [];

        const metas = items.map(item => {
            const year = item.year || '2026';
            const ep = item.episode_current || item.episode || 'Full';

            return {
                id: `phim_${item.slug}`,
                type: req.params.type,
                name: item.name || item.title,
                poster: formatPoster(item.poster_url || item.thumb_url),
                posterShape: 'poster',
                releaseInfo: `${year} • ${ep}`,
                description: item.origin_name ? `Tên gốc: ${item.origin_name}` : ''
            };
        });

        return res.json({ metas });
    } catch (e) {
        return res.json({ metas: [] });
    }
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        const slug = rawId.replace('.json', '').replace('phim_', '');

        const apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 4000 });
        const movie = apiRes.data?.movie;

        if (!movie) return res.json({ meta: null });

        return res.json({
            meta: {
                id: `phim_${movie.slug}`,
                type: req.params.type,
                name: movie.name,
                poster: formatPoster(movie.poster_url || movie.thumb_url),
                background: formatPoster(movie.thumb_url || movie.poster_url),
                description: movie.content ? movie.content.replace(/<[^>]*>?/gm, '') : '',
                year: String(movie.year || '2026'),
                releaseInfo: `${movie.year || '2026'} • ${movie.episode_current || 'Full'}`
            }
        });
    } catch (e) {
        return res.json({ meta: null });
    }
});

// Stream Route
app.get('/stream/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        const slug = rawId.replace('.json', '').replace('phim_', '');

        const apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 4000 });
        const episodes = apiRes.data?.episodes?.[0]?.server_data || [];

        const streams = episodes.map(ep => ({
            title: `Sưu Tầm Phim - ${ep.name || 'Full'}`,
            url: ep.link_m3u8
        })).filter(s => s.url);

        return res.json({ streams });
    } catch (e) {
        res.json({ streams: [] });
    }
});

module.exports = app;
        
