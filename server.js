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

const axiosClient = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://phim.nguonc.com/'
    }
});

function fixUrl(url) {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('http://')) return url.replace('http://', 'https://');
    if (!url.startsWith('http')) return 'https://phim.nguonc.com' + (url.startsWith('/') ? '' : '/') + url;
    return url;
}

// Đổi ID mới ép Nuvio xóa toàn bộ cache cũ
const manifest = {
    id: 'com.nguonc.v3',
    version: '1.0.6',
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

app.get('/manifest.json', (req, res) => res.json(manifest));

// Link kiểm tra trực tiếp kết nối Nguồn C
app.get('/test', async (req, res) => {
    try {
        const response = await axiosClient.get(`${NGUONC_API}/films/phim-moi-cap-nhat?page=1`);
        res.json({ status: 'OK', count: response.data?.items?.length || 0, sample: response.data?.items?.[0] });
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

async function getMetas(type, searchQuery) {
    let url = `${NGUONC_API}/films/phim-moi-cap-nhat?page=1`;
    if (searchQuery) {
        url = `${NGUONC_API}/films/search?keyword=${encodeURIComponent(searchQuery)}`;
    }

    const response = await axiosClient.get(url);
    const items = response.data?.items || [];

    return items.map(item => ({
        id: `nguonc_${item.slug}`,
        type: type === 'series' ? 'series' : 'movie',
        name: item.name || 'Phim',
        poster: fixUrl(item.thumb_url || item.poster_url),
        posterShape: 'poster',
        description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
    }));
}

// Route Catalog bắt mọi định dạng URL từ Nuvio
app.get('/catalog/:type/:id*', async (req, res) => {
    try {
        const type = req.params.type;
        let searchQuery = req.query.search || null;
        
        if (!searchQuery && req.params[0] && req.params[0].includes('search=')) {
            const match = req.params[0].match(/search=([^/&.]+)/);
            if (match) searchQuery = decodeURIComponent(match[1]);
        }

        const metas = await getMetas(type, searchQuery);
        res.json({ metas });
    } catch (e) {
        res.json({ metas: [] });
    }
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '');
        const slug = rawId.replace('nguonc_', '');

        const response = await axiosClient.get(`${NGUONC_API}/film/${slug}`);
        const movie = response.data?.movie;

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

// Stream Route
app.get('/stream/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '');
        const cleanId = rawId.replace('nguonc_', '');

        const parts = cleanId.split(':');
        const slug = parts[0];
        const epIndex = parts[1] ? parseInt(parts[1]) - 1 : 0;

        const response = await axiosClient.get(`${NGUONC_API}/film/${slug}`);
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
            
