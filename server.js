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
const IMAGE_BASE = 'https://img.ophim.live/uploads/movies/';

function formatPoster(posterUrl, thumbUrl) {
    let img = posterUrl || thumbUrl || '';
    if (!img) return '';
    if (!img.startsWith('http')) {
        img = IMAGE_BASE + img;
    }
    return `https://images.weserv.nl/?url=${encodeURIComponent(img)}&w=500&fit=cover`;
}

const manifest = {
    id: 'vn.ophim.official.v37',
    version: '37.0.0',
    name: 'OPhim (Smart Search Fallback)',
    description: 'Kho phim OPhim tích hợp cơ chế tự động tìm kiếm thông minh chống mất nguồn',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['op_'],
    catalogs: [
        {
            type: 'series',
            id: 'phim_bo',
            name: 'OPhim - Phim Bộ',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'movie',
            id: 'phim_le',
            name: 'OPhim - Phim Lẻ',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'anime',
            name: 'OPhim - Hoạt Hình Nhật (Anime)',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'hoat_hinh_3d',
            name: 'OPhim - Hoạt Hình 3D Trung Quốc',
            extra: [{ name: 'search', isRequired: false }]
        }
    ]
};

app.get('/', (req, res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

async function fetchMultiplePages(typePath, maxPages = 15) {
    let allItems = [];
    let promises = [];
    for (let p = 1; p <= maxPages; p++) {
        promises.push(
            axios.get(`${API_BASE}/v1/api/danh-sach/${typePath}?page=${p}`, { timeout: 4000 })
                .then(res => res.data?.data?.items || [])
                .catch(() => [])
        );
    }
    const results = await Promise.all(promises);
    results.forEach(items => {
        allItems = allItems.concat(items);
    });
    return allItems;
}

app.get('/catalog/:type/:id*', async (req, res) => {
    let rawId = req.params.id + (req.params[0] || '');
    rawId = rawId.replace('.json', '');

    if (rawId.includes('search=')) {
        const queryMatch = rawId.match(/search=([^&]+)/);
        const keyword = queryMatch ? decodeURIComponent(queryMatch[1]) : '';

        try {
            const apiRes = await axios.get(`${API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&limit=100`, { timeout: 5000 });
            let items = apiRes.data?.data?.items || [];

            const metas = items.map(item => ({
                id: `op_${item.slug}`,
                type: req.params.type,
                name: item.name || item.title,
                poster: formatPoster(item.poster_url, item.thumb_url),
                posterShape: 'poster',
                releaseInfo: `${item.year || '2026'} • ${item.episode_current || 'Full'}`,
                description: item.origin_name ? `Tên gốc: ${item.origin_name}` : ''
            }));
            return res.json({ metas });
        } catch (e) {
            return res.json({ metas: [] });
        }
    }

    try {
        let items = [];
        if (rawId.startsWith('phim_le')) {
            items = await fetchMultiplePages('phim-le', 20);
        } else if (rawId.startsWith('anime')) {
            const rawAnime = await fetchMultiplePages('hoat-hinh', 30);
            items = rawAnime.filter(i => {
                const name = (i.name + ' ' + (i.origin_name || '')).toLowerCase();
                const countrySlug = i.country?.map(c => c.slug).join(' ') || '';
                return name.includes('nhật') || name.includes('japan') || countrySlug.includes('nhat-ban');
            });
            if (items.length < 30) items = rawAnime;
        } else if (rawId.startsWith('hoat_hinh_3d')) {
            const rawHH = await fetchMultiplePages('hoat-hinh', 30);
            items = rawHH.filter(i => {
                const name = (i.name + ' ' + (i.origin_name || '')).toLowerCase();
                const countrySlug = i.country?.map(c => c.slug).join(' ') || '';
                return name.includes('trung quốc') || name.includes('china') || name.includes('3d') || countrySlug.includes('trung-quoc');
            });
            if (items.length < 30) items = rawHH;
        } else {
            items = await fetchMultiplePages('phim-bo', 20);
        }

        const metas = items.map(item => ({
            id: `op_${item.slug}`,
            type: req.params.type,
            name: item.name || item.title,
            poster: formatPoster(item.poster_url, item.thumb_url),
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
        let slug = rawId.replace('.json', '').replace('op_', '');

        let apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 4000 }).catch(() => null);
        
        // Nếu slug không tồn tại trên hệ thống OPhim, tự động kích hoạt tìm kiếm theo tên slug để gỡ lỗi
        if (!apiRes || !apiRes.data?.movie) {
            const searchKeyword = slug.replace(/-/g, ' ');
            const searchRes = await axios.get(`${API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(searchKeyword)}&limit=1`, { timeout: 4000 }).catch(() => null);
            const foundItems = searchRes?.data?.data?.items || [];
            if (foundItems.length > 0) {
                slug = foundItems[0].slug;
                apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 4000 }).catch(() => null);
            }
        }

        const movie = apiRes?.data?.movie;
        const episodesList = apiRes?.data?.episodes || [];

        if (!movie) return res.json({ meta: null });

        let rawEpisodes = [];
        for (const s of episodesList) {
            if (s.server_data && s.server_data.length > rawEpisodes.length) {
                rawEpisodes = s.server_data;
            }
        }

        const moviePoster = formatPoster(movie.poster_url, movie.thumb_url);
        const videos = rawEpisodes.map((ep, idx) => {
            let epNum = idx + 1;
            let epTitle = ep.name ? String(ep.name).trim() : `Tập ${epNum}`;
            if (!/^tập/i.test(epTitle)) {
                epTitle = `Tập ${epTitle}`;
            }
            return {
                id: `op_${slug}:${idx + 1}`,
                title: epTitle,
                thumbnail: moviePoster,
                released: new Date().toISOString(),
                season: 1,
                episode: epNum
            };
        });

        return res.json({
            meta: {
                id: `op_${slug}`,
                type: req.params.type,
                name: movie.name || movie.title,
                poster: moviePoster,
                background: moviePoster,
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
        rawId = rawId.replace('.json', '').replace('op_', '');

        const parts = rawId.split(':');
        let slug = parts[0];
        const epIndex = parts[1] ? parseInt(parts[1]) - 1 : 0;

        let apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 4000 }).catch(() => null);
        if (!apiRes || !apiRes.data?.episodes) {
            const searchKeyword = slug.replace(/-/g, ' ');
            const searchRes = await axios.get(`${API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(searchKeyword)}&limit=1`, { timeout: 4000 }).catch(() => null);
            const foundItems = searchRes?.data?.data?.items || [];
            if (foundItems.length > 0) {
                slug = foundItems[0].slug;
                apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 4000 }).catch(() => null);
            }
        }

        const episodesList = apiRes?.data?.episodes || [];

        let targetEp = null;
        for (const s of episodesList) {
            const serverData = s.server_data || [];
            if (serverData[epIndex] && serverData[epIndex].link_m3u8) {
                targetEp = serverData[epIndex];
                break;
            }
        }

        if (!targetEp) {
            for (const s of episodesList) {
                const serverData = s.server_data || [];
                if (serverData.length > 0 && serverData[0].link_m3u8) {
                    targetEp = serverData[0];
                    break;
                }
            }
        }

        if (!targetEp || !targetEp.link_m3u8) return res.json({ streams: [] });

        return res.json({
            streams: [
                {
                    title: `OPhim - ${targetEp.name || 'Full'}`,
                    url: targetEp.link_m3u8
                }
            ]
        });
    } catch (e) {
        res.json({ streams: [] });
    }
});

app.listen(process.env.PORT || 3000);
module.exports = app;
        
