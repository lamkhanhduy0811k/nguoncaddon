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

/**
 * Hàm chuẩn hóa và tối ưu hóa poster ảnh cực kỳ khắt khe
 * Giúp vượt qua hoàn toàn mọi lỗi chặn mạng tại Việt Nam và hiển thị trên Nuvio
 */
function formatPoster(url) {
    if (!url || typeof url !== 'string' || url.trim() === '') {
        return 'https://image.tmdb.org/t/p/w500/1E5ba88S318X4Pz2goR2vKCoBu.jpg';
    }
    
    let clean = url.trim();
    // Loại bỏ giao thức cũ để chuẩn hóa domain
    clean = clean.replace(/^https?:\/\//i, '');
    
    // Đưa tất cả các domain ảnh cũ về domain gốc ổn định nhất
    clean = clean.replace(/^img\.ophim\.cc/, 'img.phimimg.com')
                 .replace(/^img\.ophim1\.com/, 'img.phimimg.com')
                 .replace(/^ophim1\.com/, 'img.phimimg.com');
    
    // Nếu là đường dẫn tương đối, tự động gắn domain và thư mục lưu trữ chuẩn
    if (!clean.includes('img.phimimg.com') && !clean.includes('image.tmdb.org')) {
        clean = clean.replace(/^\/+/, '');
        if (!clean.startsWith('uploads/')) {
            clean = `uploads/movies/${clean}`;
        }
        clean = `img.phimimg.com/${clean}`;
    }
    
    // Sử dụng CDN Proxy quốc tế wsrv.nl với thông số ép kích thước poster chuẩn khung Stremio/Nuvio
    return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=400&h=600&fit=cover&output=jpg`;
}

function getBestPoster(item) {
    if (item.poster_url && item.poster_url.trim() !== '') {
        return formatPoster(item.poster_url);
    }
    if (item.thumb_url && item.thumb_url.trim() !== '') {
        return formatPoster(item.thumb_url);
    }
    return 'https://image.tmdb.org/t/p/w500/1E5ba88S318X4Pz2goR2vKCoBu.jpg';
}

const manifest = {
    id: 'vn.nguonc.official.v38',
    version: '38.0.0',
    name: 'Nguồn C (Professional)',
    description: 'Kho phim độc quyền đa dạng, fix triệt để lỗi ảnh bằng CDN Proxy',
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
        },
        {
            type: 'series',
            id: 'anime',
            name: 'Nguồn C - Hoạt Hình Nhật (Anime)',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'hoat_hinh_3d',
            name: 'Nguồn C - Hoạt Hình 3D Trung Quốc',
            extra: [{ name: 'search', isRequired: false }]
        }
    ]
};

app.get('/', (req, res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

// Hàm hỗ trợ tải song song nhiều trang để danh sách phim phong phú
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
            const items = apiRes.data?.data?.items || [];
            const metas = items.map(item => ({
                id: `nc_${item.slug}`,
                type: req.params.type,
                name: item.name || item.title,
                poster: getBestPoster(item),
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
            id: `nc_${item.slug}`,
            type: req.params.type,
            name: item.name || item.title,
            poster: getBestPoster(item),
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

        const moviePoster = getBestPoster(movie);
        const videos = rawEpisodes.map((ep, idx) => {
            let epNum = idx + 1;
            let epTitle = ep.name ? String(ep.name).trim() : `Tập ${epNum}`;
            if (!/^tập/i.test(epTitle)) {
                epTitle = `Tập ${epTitle}`;
            }
            return {
                id: `nc_${slug}:${idx + 1}`,
                title: epTitle,
                thumbnail: moviePoster,
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
        res.json({ streams: [] });
    }
});

app.listen(process.env.PORT || 3000);
module.exports = app;
        
