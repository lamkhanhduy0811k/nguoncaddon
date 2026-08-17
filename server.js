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
    return `https://images.weserv.nl/?url=${encodeURIComponent(img)}&w=500&fit=cover`;
}

const manifest = {
    id: 'vn.ophim.phimapi.v43',
    version: '43.0.0',
    name: 'Ổ Phim x PhimAPI',
    description: 'Tích hợp song song OPhim và PhimAPI, hỗ trợ nguồn dự phòng thông minh',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['op_'],
    catalogs: [
        {
            type: 'series',
            id: 'phim_bo',
            name: 'Kho Phim - Phim Bộ',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'movie',
            id: 'phim_le',
            name: 'Kho Phim - Phim Lẻ',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'anime',
            name: 'Kho Phim - Anime',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'hoat_hinh_3d',
            name: 'Kho Phim - Hoạt Hình 3D',
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
            axios.get(`${OPHIM_API}/v1/api/danh-sach/${typePath}?page=${p}`, { timeout: 4000 })
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

async function resolveSlugAndMeta(type, rawId) {
    let cleanId = rawId.replace('.json', '');
    let slug = cleanId.startsWith('op_') ? cleanId.replace('op_', '').split(':')[0] : '';
    let movieName = '';

    if (!slug) {
        try {
            const cinemetaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${cleanId}.json`, { timeout: 3000 });
            const meta = cinemetaRes.data?.meta;
            if (meta) {
                movieName = meta.name || '';
                let keywords = [meta.name, meta.original_name].filter(Boolean);
                for (const kw of keywords) {
                    const [ophimSearch, phimapiSearch] = await Promise.allSettled([
                        axios.get(`${OPHIM_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(kw)}&limit=3`, { timeout: 3000 }),
                        axios.get(`${PHIMAPI_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(kw)}&limit=3`, { timeout: 3000 })
                    ]);

                    if (ophimSearch.status === 'fulfilled' && ophimSearch.value.data?.data?.items?.length > 0) {
                        return { slug: ophimSearch.value.data.data.items[0].slug, movieName };
                    }
                    if (phimapiSearch.status === 'fulfilled' && phimapiSearch.value.data?.data?.items?.length > 0) {
                        return { slug: phimapiSearch.value.data.data.items[0].slug, movieName };
                    }
                }
            }
        } catch (err) {}
        slug = cleanId.split(':')[0];
    }

    return { slug, movieName };
}

app.get('/catalog/:type/:id*', async (req, res) => {
    let rawId = req.params.id + (req.params[0] || '');
    rawId = rawId.replace('.json', '');

    if (rawId.includes('search=')) {
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
                axios.get(`${OPHIM_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&limit=100`, { timeout: 4000 }),
                axios.get(`${PHIMAPI_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&limit=100`, { timeout: 4000 })
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
        const { slug, movieName } = await resolveSlugAndMeta(req.params.type, rawId);

        let movie = null;
        let episodesList = [];
        let imagePrefix = 'https://img.ophim.live/uploads/movies/';

        try {
            let resO = await axios.get(`${OPHIM_API}/phim/${slug}`, { timeout: 3000 });
            if (resO.data?.movie) {
                movie = resO.data.movie;
                episodesList = resO.data.episodes || [];
            }
        } catch(e) {}

        if (!movie) {
            try {
                let resP = await axios.get(`${PHIMAPI_API}/phim/${slug}`, { timeout: 3000 });
                if (resP.data?.movie) {
                    movie = resP.data.movie;
                    episodesList = resP.data.episodes || [];
                    imagePrefix = 'https://phimimg.com/';
                }
            } catch(e) {}
        }

        // Nếu hoàn toàn không có trong kho, vẫn tạo meta giả lập từ Cinemeta để không bị lỗi trắng trang
        if (!movie) {
            try {
                const cinemetaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${req.params.type}/${rawId.replace('.json', '')}.json`, { timeout: 3000 });
                const meta = cinemetaRes.data?.meta;
                if (meta) {
                    return res.json({
                        meta: {
                            id: rawId.replace('.json', ''),
                            type: req.params.type,
                            name: meta.name,
                            poster: meta.poster,
                            background: meta.background,
                            description: meta.description || 'Không có mô tả.',
                            year: String(meta.year || '2026'),
                            releaseInfo: String(meta.year || '2026'),
                            videos: [{
                                id: `${rawId.replace('.json', '')}:1`,
                                title: 'Tập 1 (Tìm kiếm trực tuyến)',
                                thumbnail: meta.poster,
                                released: new Date().toISOString(),
                                season: 1,
                                episode: 1
                            }]
                        }
                    });
                }
            } catch(err) {}
            return res.json({ meta: null });
        }

        let rawEpisodes = [];
        for (const s of episodesList) {
            if (s.server_data && s.server_data.length > rawEpisodes.length) {
                rawEpisodes = s.server_data;
            }
        }

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

        const { slug, movieName } = await resolveSlugAndMeta(req.params.type, baseId);
        const streams = [];

        const fetchStreams = async (apiBase, sourceName) => {
            try {
                let apiRes = await axios.get(`${apiBase}/phim/${slug}`, { timeout: 3000 });
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

        // Nếu kho không có phim này, tự động cung cấp link dự phòng tìm kiếm web/Google để không bị lỗi "Không có nguồn phát"
        if (streams.length === 0) {
            let searchTitle = slug.replace(/-/g, ' ');
            streams.push({
                title: `Ổ Phim - 🔍 Không có sẵn nguồn (Bấm để tìm Google)`,
                url: `https://www.google.com/search?q=${encodeURIComponent(searchTitle + ' vietsub')}`
            });
        }

        return res.json({ streams });
    } catch (e) {
        return res.json({ streams: [] });
    }
});

app.listen(process.env.PORT || 3000);
module.exports = app;
            
