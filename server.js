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

function formatPoster(url) {
    if (!url) return 'https://image.tmdb.org/t/p/w500/1E5ba88S318X4Pz2goR2vKCoBu.jpg';
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    return `${CDN_IMAGE}/${url.replace(/^\//, '')}`;
}

// Manifest v18.0.0 - Tối ưu tiêu đề tập phim trên TV
const manifest = {
    id: 'vn.nguonc.movies.v18',
    version: '18.0.0',
    name: 'Nguồn C',
    description: 'Kho phim Bộ, Phim Lẻ, Hoạt Hình Vietsub chất lượng cao',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['phim_'],
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
        },
        {
            type: 'series',
            id: 'hoat_hinh',
            name: 'Nguồn C - Hoạt Hình',
            extra: [{ name: 'search', isRequired: false }]
        }
    ]
};

app.get('/', (req, res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

// Catalog Route
app.get('/catalog/:type/:id*', async (req, res) => {
    let rawId = req.params.id + (req.params[0] || '');
    rawId = rawId.replace('.json', '');

    if (rawId.includes('search=')) {
        const queryMatch = rawId.match(/search=([^&]+)/);
        const keyword = queryMatch ? decodeURIComponent(queryMatch[1]) : '';

        if (req.params.id !== 'phim_bo') {
            return res.json({ metas: [] });
        }

        try {
            const apiRes = await axios.get(`${API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&limit=60`, { timeout: 4000 });
            const items = apiRes.data?.data?.items || [];

            const metas = items.map(item => ({
                id: `phim_${item.slug}`,
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
    } else if (rawId.startsWith('hoat_hinh')) {
        typePath = 'hoat-hinh';
    }

    try {
        const pages = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        const requests = pages.map(p => axios.get(`${API_BASE}/v1/api/danh-sach/${typePath}?page=${p}`, { timeout: 4000 }).catch(() => null));
        const responses = await Promise.all(requests);

        let allItems = [];
        responses.forEach(r => {
            if (r?.data?.data?.items) {
                allItems = allItems.concat(r.data.data.items);
            }
        });

        const metas = allItems.map(item => ({
            id: `phim_${item.slug}`,
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

// Meta Route - Giữ tên tập gốc từ nguồn (VD: "Tập 01", "Full"...) để không bị lặp chữ
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        const slug = rawId.replace('.json', '').replace('phim_', '');

        const apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 4000 });
        const movie = apiRes.data?.movie;
        const rawEpisodes = apiRes.data?.episodes?.[0]?.server_data || [];

        if (!movie) return res.json({ meta: null });

        const movieThumb = formatPoster(movie.thumb_url || movie.poster_url);

        const videos = rawEpisodes.map((ep, idx) => {
            let epNum = idx + 1;
            let epTitle = ep.name ? ep.name.trim() : `Tập ${epNum}`;
            
            // Nếu tên tập chưa có chữ Tập thì thêm vào cho chuẩn, nếu có rồi thì giữ nguyên
            if (!/^tập/i.test(epTitle)) {
                epTitle = `Tập ${epTitle}`;
            }

            return {
                id: `phim_${movie.slug}:${idx + 1}`,
                title: epTitle,
                thumbnail: movieThumb,
                released: new Date().toISOString(),
                season: 1,
                episode: epNum
            };
        });

        return res.json({
            meta: {
                id: `phim_${movie.slug}`,
                type: req.params.type,
                name: movie.name,
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

// Stream Route
app.get('/stream/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('phim_', '');

        const parts = rawId.split(':');
        const slug = parts[0];
        const epIndex = parts[1] ? parseInt(parts[1]) - 1 : 0;

        const apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 4000 });
        const episodes = apiRes.data?.episodes?.[0]?.server_data || [];

        const targetEp = episodes[epIndex] || episodes[0];

        if (!targetEp || !targetEp.link_m3u8) {
            return res.json({ streams: [] });
        }

        return res.json({
            streams: [
                {
                    title: `Nguồn C - ${targetEp.name || 'Full'}`,
                    url: targetEp.link_m3u8
                }
            ]
        });
    } catch (e) {
        res.json({ streams: [] });
    }
});

module.exports = app;
            
