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
    id: 'vn.ophim.official.v41',
    version: '41.0.0',
    name: 'Ổ Phim',
    description: 'Kho phim Ổ Phim tối ưu đa server và xử lý chống mất nguồn phát',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['op_'],
    catalogs: [
        {
            type: 'series',
            id: 'phim_bo',
            name: 'Ổ Phim - Phim Bộ',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'movie',
            id: 'phim_le',
            name: 'Ổ Phim - Phim Lẻ',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'anime',
            name: 'Ổ Phim - Hoạt Hình Nhật (Anime)',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'hoat_hinh_3d',
            name: 'Ổ Phim - Hoạt Hình 3D Trung Quốc',
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

async function getOPhimSlugAndData(type, rawId) {
    let cleanId = rawId.replace('.json', '');
    let slug = '';

    if (cleanId.startsWith('op_')) {
        slug = cleanId.replace('op_', '').split(':')[0];
    } else {
        try {
            const cinemetaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${cleanId}.json`, { timeout: 3000 });
            const meta = cinemetaRes.data?.meta;
            if (meta) {
                let keywords = [meta.name, meta.original_name].filter(Boolean);
                for (const kw of keywords) {
                    const searchRes = await axios.get(`${API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(kw)}&limit=3`, { timeout: 3000 });
                    const items = searchRes.data?.data?.items || [];
                    if (items.length > 0) {
                        slug = items[0].slug;
                        break;
                    }
                }
            }
        } catch (err) {}
    }

    if (!slug) {
        slug = cleanId.replace('op_', '').split(':')[0];
    }

    try {
        let apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 4000 });
        if (!apiRes.data?.movie) {
            const searchKeyword = slug.replace(/-/g, ' ');
            const searchRes = await axios.get(`${API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(searchKeyword)}&limit=3`, { timeout: 4000 });
            const items = searchRes.data?.data?.items || [];
            if (items.length > 0) {
                slug = items[0].slug;
                apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 4000 });
            }
        }
        return { slug, data: apiRes.data };
    } catch (e) {
        return { slug, data: null };
    }
}

app.get('/catalog/:type/:id*', async (req, res) => {
    let rawId = req.params.id + (req.params[0] || '');
    rawId = rawId.replace('.json', '');

    if (rawId.includes('search=')) {
        const queryMatch = rawId.match(/search=([^&]+)/);
        const keyword = queryMatch ? decodeURIComponent(queryMatch[1]) : '';

        try {
            const apiRes = await axios.get(`${API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&limit=150`, { timeout: 5000 });
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
        const { slug, data } = await getOPhimSlugAndData(req.params.type, rawId);

        if (!data || !data.movie) return res.json({ meta: null });

        const movie = data.movie;
        const episodesList = data.episodes || [];

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
        const parts = rawId.replace('.json', '').split(':');
        const baseId = parts[0];
        const epIndex = parts[1] ? parseInt(parts[1]) - 1 : 0;

        const { slug, data } = await getOPhimSlugAndData(req.params.type, baseId);
        if (!data || !data.episodes) return res.json({ streams: [] });

        const episodesList = data.episodes || [];
        const streams = [];

        episodesList.forEach((server, sIdx) => {
            const serverName = server.server_name || `Server ${sIdx + 1}`;
            const serverData = server.server_data || [];
            const targetEp = serverData[epIndex] || serverData[0];

            if (targetEp) {
                if (targetEp.link_m3u8) {
                    streams.push({
                        title: `Ổ Phim - ${serverName} (M3U8)`,
                        url: targetEp.link_m3u8
                    });
                }
                if (targetEp.link_embed) {
                    streams.push({
                        title: `Ổ Phim - ${serverName} (Embed)`,
                        url: targetEp.link_embed
                    });
                }
            }
        });

        return res.json({ streams });
    } catch (e) {
        return res.json({ streams: [] });
    }
});

app.listen(process.env.PORT || 3000);
module.exports = app;
                    
