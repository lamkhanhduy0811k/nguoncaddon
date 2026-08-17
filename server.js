const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    next();
});

const NGUONC_API = 'https://phim.nguonc.com/api';

function fixUrl(url) {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('http://')) return url.replace('http://', 'https://');
    if (!url.startsWith('http')) return 'https://phim.nguonc.com' + (url.startsWith('/') ? '' : '/') + url;
    return url;
}

const manifest = {
    id: 'com.nguonc.v5',
    version: '1.0.8',
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

app.get('/', (req, res) => res.json({ status: 'Online', manifest: '/manifest.json' }));
app.get('/manifest.json', (req, res) => res.json(manifest));

// Catalog Route
app.get('/catalog/:type/:id*', async (req, res) => {
    try {
        const type = req.params.type;
        const resApi = await fetch(`${NGUONC_API}/films/phim-moi-cap-nhat?page=1`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });
        
        const data = await resApi.json();
        const items = data?.items || [];

        const metas = items.map(item => ({
            id: `nguonc_${item.slug}`,
            type: type === 'series' ? 'series' : 'movie',
            name: item.name || 'Phim',
            poster: fixUrl(item.thumb_url || item.poster_url),
            posterShape: 'poster',
            description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
        }));

        res.json({ metas });
    } catch (e) {
        res.json({ metas: [], debug_error: e.message });
    }
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '');
        const slug = rawId.replace('nguonc_', '');

        const resApi = await fetch(`${NGUONC_API}/film/${slug}`);
        const data = await resApi.json();
        const movie = data?.movie;

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

        const resApi = await fetch(`${NGUONC_API}/film/${slug}`);
        const data = await resApi.json();
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
