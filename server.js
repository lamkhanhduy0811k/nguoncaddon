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

const API_BASE = 'https://ophim1.com';

function formatPoster(url) {
    if (!url) return 'https://image.tmdb.org/t/p/w500/1E5ba88S318X4Pz2goR2vKCoBu.jpg';
    if (url.startsWith('http')) return url;
    return `https://img.ophim.cc/uploads/movies/${url}`;
}

const manifest = {
    id: 'vn.nguonc.official.v21',
    version: '21.0.0',
    name: 'Nguồn C',
    description: 'Kho phim độc quyền chất lượng cao',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['nc_'],
    catalogs: [
        {
            type: 'series',
            id: 'phim_bo',
            name: 'Nguồn C - Phim Bộ',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'movie',
            id: 'phim_le',
            name: 'Nguồn C - Phim Lẻ',
            extra: [{ name: 'search', isRequired: false }]
        }
    ]
};

app.get('/', (req, res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

app.get('/catalog/:type/:id*', async (req, res) => {
    let rawId = req.params.id + (req.params[0] || '');
    rawId = rawId.replace('.json', '');

    if (rawId.includes('search=')) {
        const queryMatch = rawId.match(/search=([^&]+)/);
        const keyword = queryMatch ? decodeURIComponent(queryMatch[1]) : '';

        try {
            const apiRes = await axios.get(`${API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&limit=50`, { timeout: 5000 });
            const items = apiRes.data?.data?.items || [];
            const metas = items.map(item => ({
                id: `nc_${item.slug}`,
                type: req.params.type,
                name: item.name || item.title,
                poster: formatPoster(item.poster_url || item.thumb_url),
                posterShape: 'poster',
                releaseInfo: `${item.year || '2026'} • ${item.episode_current || 'Full'}`,
                description: item.origin_name ? `Tên gốc: ${item.origin_name}` : ''
            }));
            return res.json({ metas });
        } catch (e) {
            return res.json({ metas: [] });
        }
    }

    let typePath = 'phim-bo';
    if (rawId.startsWith('phim_le')) {
        typePath = 'phim-le';
    }

    try {
        const apiRes = await axios.get(`${API_BASE}/v1/api/danh-sach/${typePath}?limit=50`, { timeout: 5000 });
        const items = apiRes.data?.data?.items || [];
        const metas = items.map(item => ({
            id: `nc_${item.slug}`,
            type: req.params.type,
            name: item.name || item.title,
            poster: formatPoster(item.poster_url || item.thumb_url),
            posterShape: 'poster',
            releaseInfo: `${item.year || '2026'} • ${item.episode_current || 'Full'}`,
            description: item.origin_name ? `Tên gốc: ${item.origin_name}` : ''
        }));
        return res.json({ metas });
    } catch (e) {
        return res.json({ metas: [] });
    }
});

app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        const slug = rawId.replace('.json', '').replace('nc_', '');

        const apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 5000 });
        const movie = apiRes.data?.movie;
        const episodesList = apiRes.data?.episodes || [];
        const rawEpisodes = episodesList[0]?.server_data || [];

        if (!movie) return res.json({ meta: null });

        const movieThumb = formatPoster(movie.thumb_url || movie.poster_url);
        const videos = rawEpisodes.map((ep, idx) => {
            let epNum = idx + 1;
            let epTitle = ep.name ? String(ep.name).trim() : `Tập ${epNum}`;
            if (!/^tập/i.test(epTitle)) {
                epTitle = `Tập ${epTitle}`;
            }
            return {
                id: `nc_${slug}:${idx + 1}`,
                title: epTitle,
                thumbnail: movieThumb,
                released: new Date().toISOString(),
                season: 1,
                episode: epNum
            };
        });

        return res.json({
            meta: {
                id: `nc_${slug}`,
                type: req.params.type,
                name: movie.name || movie.title,
                poster: formatPoster(movie.poster_url || movie.thumb_url),
                background: movieThumb,
                description: movie.content ? movie.content.replace(/<[^>]*>?/gm, '') : '',
                year: String(movie.year || '2026'),
                releaseInfo: `${movie.year || '2026'} • ${movie.episode_current || 'Full'}`,
                videos: videos.length > 0 ? videos : undefined
            }
        });
    } catch (e) {
        return res.json({ meta: null });
    }
});

app.get('/stream/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('nc_', '');

        const parts = rawId.split(':');
        const slug = parts[0];
        const epIndex = parts[1] ? parseInt(parts[1]) - 1 : 0;

        const apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 5000 });
        const episodesList = apiRes.data?.episodes || [];
        const rawEpisodes = episodesList[0]?.server_data || [];

        const targetEp = rawEpisodes[epIndex] || rawEpisodes[0];
        if (!targetEp || !targetEp.link_m3u8) return res.json({ streams: [] });

        return res.json({
            streams: [
                {
                    title: `Nguồn C - ${targetEp.name || 'Full'}`,
                    url: targetEp.link_m3u8
                }
            ]
        });
    } catch (e) {
        return res.json({ streams: [] });
    }
});

module.exports = app;
            
