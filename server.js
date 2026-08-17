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

const OPHIM_API = 'https://ophim1.com';
const PHIMAPI_API = 'https://phimapi.com';

function formatPoster(posterUrl, thumbUrl, prefix = 'https://img.ophim.live/uploads/movies/') {
    let img = posterUrl || thumbUrl || '';
    if (!img) return '';
    if (!img.startsWith('http')) {
        img = prefix + img;
    }
    return `https://images.weserv.nl/?url=${encodeURIComponent(img)}&w=800&fit=cover&q=85`;
}

const manifest = {
    id: 'vn.ophim.phimapi.v51',
    version: '51.0.0',
    name: 'Ổ Phim',
    description: 'Ổ Phim tối ưu tốc độ phản hồi siêu tốc',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['op_'],
    catalogs: [
        {
            type: 'series',
            id: 'phim_bo',
            name: 'Ổ Phim',
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
            name: 'Ổ Phim - Anime',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'hoat_hinh_3d',
            name: 'Ổ Phim - Hoạt Hình 3D',
            extra: [{ name: 'search', isRequired: false }]
        }
    ]
};

app.get('/', (req, res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

// Chỉ quét nhanh trang 1 và 2 để tốc độ load tức thì không bị nghẽn
async function fetchFastPages(typePath) {
    let allItems = [];
    try {
        const [res1, res2] = await Promise.allSettled([
            axios.get(`${OPHIM_API}/v1/api/danh-sach/${typePath}?page=1`, { timeout: 2000 }),
            axios.get(`${OPHIM_API}/v1/api/danh-sach/${typePath}?page=2`, { timeout: 2000 })
        ]);
        if (res1.status === 'fulfilled') allItems = allItems.concat(res1.value.data?.data?.items || []);
        if (res2.status === 'fulfilled') allItems = allItems.concat(res2.value.data?.data?.items || []);
    } catch(e) {}
    return allItems;
}

async function resolveSlug(rawId) {
    let cleanId = rawId.replace('.json', '');
    let slug = cleanId.startsWith('op_') ? cleanId.replace('op_', '').split(':')[0] : '';
    return slug;
}

app.get('/catalog/:type/:id*', async (req, res) => {
    let rawId = req.params.id + (req.params[0] || '');
    rawId = rawId.replace('.json', '');

    if (rawId.includes('search=')) {
        if (!rawId.startsWith('phim_bo')) {
            return res.json({ metas: [] });
        }

        const queryMatch = rawId.match(/search=([^&]+)/);
        const keyword = queryMatch ? decodeURIComponent(queryMatch[1]) : '';

        try {
            const results = [];
            const seenSlugs = new Set();

            const addItems = (items, prefix) => {
                (items || []).forEach(item => {
                    if (!seenSlugs.has(item.slug)) {
                        seenSlugs.add(item.slug);
                        results.push({
                            id: `op_${item.slug}`,
                            type: req.params.type,
                            name: item.name || item.title,
                            poster: formatPoster(item.poster_url, item.thumb_url, prefix),
                            posterShape: 'poster',
                            releaseInfo: `${item.year || '2026'} • ${item.episode_current || 'Full'}`,
                            description: item.origin_name ? `Tên gốc: ${item.origin_name}` : ''
                        });
                    }
                });
            };

            const [ophimRes, phimapiRes] = await Promise.allSettled([
                axios.get(`${OPHIM_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&limit=15`, { timeout: 2000 }),
                axios.get(`${PHIMAPI_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&limit=15`, { timeout: 2000 })
            ]);

            if (ophimRes.status === 'fulfilled') addItems(ophimRes.value.data?.data?.items, 'https://img.ophim.live/uploads/movies/');
            if (phimapiRes.status === 'fulfilled') addItems(phimapiRes.value.data?.data?.items, 'https://phimimg.com/');

            return res.json({ metas: results });
        } catch (e) {
            return res.json({ metas: [] });
        }
    }

    try {
        let items = [];
        if (rawId.startsWith('phim_le')) {
            items = await fetchFastPages('phim-le');
        } else if (rawId.startsWith('anime')) {
            const rawAnime = await fetchFastPages('hoat-hinh');
            items = rawAnime.filter(i => {
                const name = (i.name + ' ' + (i.origin_name || '')).toLowerCase();
                const countrySlug = i.country?.map(c => c.slug).join(' ') || '';
                return name.includes('nhật') || name.includes('japan') || countrySlug.includes('nhat-ban');
            });
            if (items.length < 5) items = rawAnime;
        } else if (rawId.startsWith('hoat_hinh_3d')) {
            const rawHH = await fetchFastPages('hoat-hinh');
            items = rawHH.filter(i => {
                const name = (i.name + ' ' + (i.origin_name || '')).toLowerCase();
                const countrySlug = i.country?.map(c => c.slug).join(' ') || '';
                return name.includes('trung quốc') || name.includes('china') || name.includes('3d') || countrySlug.includes('trung-quoc');
            });
            if (items.length < 5) items = rawHH;
        } else {
            items = await fetchFastPages('phim-bo');
        }

        const metas = items.map(item => ({
            id: `op_${item.slug}`,
            type: req.params.type,
            name: item.name || item.title,
            poster: formatPoster(item.poster_url, item.thumb_url, 'https://img.ophim.live/uploads/movies/'),
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
        const slug = await resolveSlug(rawId);

        if (!slug) return res.json({ meta: null });

        let movie = null;
        let episodesList = [];
        let imagePrefix = 'https://img.ophim.live/uploads/movies/';

        // Gọi đồng thời OPhim và PhimAPI để lấy dữ liệu nhanh nhất có thể
        const [resO, resP] = await Promise.allSettled([
            axios.get(`${OPHIM_API}/phim/${slug}`, { timeout: 2000 }),
            axios.get(`${PHIMAPI_API}/phim/${slug}`, { timeout: 2000 })
        ]);

        if (resO.status === 'fulfilled' && resO.value.data?.movie) {
            movie = resO.value.data.movie;
            episodesList = resO.value.data.episodes || [];
        } else if (resP.status === 'fulfilled' && resP.value.data?.movie) {
            movie = resP.value.data.movie;
            episodesList = resP.value.data.episodes || [];
            imagePrefix = 'https://phimimg.com/';
        }

        if (!movie) return res.json({ meta: null });

        let rawEpisodes = [];
        for (const s of episodesList) {
            if (s.server_data && s.server_data.length > rawEpisodes.length) {
                rawEpisodes = s.server_data;
            }
        }

        if (rawEpisodes.length === 0) return res.json({ meta: null });

        const moviePoster = formatPoster(movie.poster_url, movie.thumb_url, imagePrefix);
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

        const slug = await resolveSlug(baseId);
        const streams = [];

        const fetchStreams = async (apiBase, sourceName) => {
            try {
                let apiRes = await axios.get(`${apiBase}/phim/${slug}`, { timeout: 2000 });
                const episodesList = apiRes.data?.episodes || [];

                episodesList.forEach((server, sIdx) => {
                    const serverName = server.server_name || `Server ${sIdx + 1}`;
                    const serverData = server.server_data || [];
                    const targetEp = serverData[epIndex] || serverData[0];

                    if (targetEp) {
                        if (targetEp.link_m3u8) {
                            streams.push({
                                title: `Ổ Phim - ${sourceName} ${serverName} (M3U8)`,
                                url: targetEp.link_m3u8
                            });
                        }
                        if (targetEp.link_embed) {
                            streams.push({
                                title: `Ổ Phim - ${sourceName} ${serverName} (Embed)`,
                                url: targetEp.link_embed
                            });
                        }
                    }
                });
            } catch(e) {}
        };

        await Promise.all([
            fetchStreams(OPHIM_API, 'OPhim'),
            fetchStreams(PHIMAPI_API, 'PhimAPI')
        ]);

        return res.json({ streams });
    } catch (e) {
        return res.json({ streams: [] });
    }
});

app.listen(process.env.PORT || 3000);
module.exports = app;
                
