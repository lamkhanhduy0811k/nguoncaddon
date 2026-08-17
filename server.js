const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const NGUONC_API = 'https://phim.nguonc.com/api';

// 1. Khai báo Manifest cho Stremio
const manifest = {
    id: 'com.sieutamphim.nguonc',
    version: '1.0.0',
    name: 'Siêu Tầm Phim (Nguồn C)',
    description: 'Xem phim Vietsub/Thuyết minh từ Nguồn C trên Stremio',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    catalogs: [
        {
            type: 'movie',
            id: 'nguonc_catalog',
            name: 'Nguồn C - Phim Mới',
            extra: [{ name: 'search', isRequired: false }]
        }
    ]
};

app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

// 2. Lấy danh sách phim & Tìm kiếm
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
        let url = `${NGUONC_API}/films/phim-moi-cap-nhat?page=1`;
        if (req.params.extra) {
            const searchMatch = req.params.extra.match(/search=([^&]+)/);
            if (searchMatch) {
                url = `${NGUONC_API}/films/search?keyword=${encodeURIComponent(searchMatch[1])}`;
            }
        }

        const response = await axios.get(url);
        const items = response.data.items || [];

        const metas = items.map(item => ({
            id: `nguonc_${item.slug}`,
            type: item.type === 'single' ? 'movie' : 'series',
            name: item.name,
            poster: item.thumb_url || item.poster_url,
            description: `Tên gốc: ${item.original_name || ''} (${item.year || ''})`
        }));

        res.json({ metas });
    } catch (e) {
        res.json({ metas: [] });
    }
});

// 3. Lấy thông tin chi tiết phim
app.get('/meta/:type/:id.json', async (req, res) => {
    try {
        const slug = req.params.id.replace('nguonc_', '');
        const response = await axios.get(`${NGUONC_API}/film/${slug}`);
        const movie = response.data.movie;

        res.json({
            meta: {
                id: req.params.id,
                type: movie.type === 'single' ? 'movie' : 'series',
                name: movie.name,
                poster: movie.thumb_url || movie.poster_url,
                background: movie.poster_url || movie.thumb_url,
                description: movie.description ? movie.description.replace(/<[^>]*>?/gm, '') : '',
                year: movie.year
            }
        });
    } catch (e) {
        res.json({ meta: null });
    }
});

// 4. Bóc tách link Stream (m3u8) để phát video
app.get('/stream/:type/:id.json', async (req, res) => {
    try {
        const parts = req.params.id.replace('nguonc_', '').split(':');
        const slug = parts[0];
        const epIndex = parts[1] ? parseInt(parts[1]) - 1 : 0;

        const response = await axios.get(`${NGUONC_API}/film/${slug}`);
        const episodes = response.data.movie?.episodes?.[0]?.items || [];
        const ep = episodes[epIndex] || episodes[0];

        if (!ep) return res.json({ streams: [] });

        const streams = [];
        if (ep.m3u8) {
            streams.push({
                title: `Nguồn C - ${ep.name || 'Full'} (m3u8)`,
                url: ep.m3u8
            });
        }
        if (ep.embed) {
            streams.push({
                title: `Nguồn C - ${ep.name || 'Full'} (Embed)`,
                url: ep.embed
            });
        }

        res.json({ streams });
    } catch (e) {
        res.json({ streams: [] });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
