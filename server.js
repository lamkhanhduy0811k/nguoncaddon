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

// Bổ sung Full Header giả lập trình duyệt thật để vượt Cloudflare
const axiosClient = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://phim.nguonc.com/',
        'Origin': 'https://phim.nguonc.com'
    }
});

function fixUrl(url) {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('http://')) return url.replace('http://', 'https://');
    if (!url.startsWith('http')) return 'https://phim.nguonc.com' + (url.startsWith('/') ? '' : '/') + url;
    return url;
}

const manifest = {
    id: 'com.sieutamphim.nguonc',
    version: '1.0.5',
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

// Hàm xử lý lấy dữ liệu chung
async function fetchCatalog(type, searchQuery) {
    let url = `${NGUONC_API}/films/phim-moi-cap-nhat?page=1`;
    if (searchQuery) {
        url = `${NGUONC_API}/films/search?keyword=${encodeURIComponent(searchQuery)}`;
    }

    const response = await axiosClient.get(url);
    const items = response.data?.items || [];

    return items.map(item => ({
        id: `nguonc_${item.slug}`,
        type: type || 'movie',
        name: item.name || 'Phim',
        poster: fixUrl(item.thumb_url || item.poster_url),
        posterShape: 'poster',
        description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
    }));
}

// 1. Catalog chuẩn không Search
app.get('/catalog/:type/:id.json', async (req, res) => {
    try {
        const metas = await fetchCatalog(req.params.type, null);
        res.json({ metas });
    } catch (e) {
        res.json({ metas: [] });
    }
});

// 2. Catalog có Search hoặc Tham số phụ từ Nuvio
app.get('/catalog/:type/:id/:extra.json', async (req, res) => {
    try {
        let searchQuery = '';
        if (req.params.extra.includes('search=')) {
            const match = req.params.extra.match(/search=([^&]+)/);
            if (match) searchQuery = decodeURIComponent(match[1]);
        }
        const metas = await fetchCatalog(req.params.type, searchQuery);
        res.json({ metas });
    } catch (e) {
        res.json({ metas: [] });
    }
});

// 3. Chi tiết phim
app.get('/meta/:type/:id.json', async (req, res) => {
    try {
        const slug = req.params.id.replace('.json', '').replace('nguonc_', '');
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

// 4. Link xem phim
app.get('/stream/:type/:id.json', async (req, res) => {
    try {
        const cleanId = req.params.id.replace('.json', '').replace('nguonc_', '');
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
    
