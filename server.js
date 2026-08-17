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

// Route trung chuyển ảnh trực tiếp (Vượt mọi rào cản chặn Hotlink/Referer)
app.get('/poster', async (req, res) => {
    const rawUrl = req.query.url;
    if (!rawUrl) return res.redirect('https://picsum.photos/300/450');

    try {
        const response = await axios.get(rawUrl, {
            responseType: 'arraybuffer',
            timeout: 4000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://phim.nguonc.com/'
            }
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(Buffer.from(response.data));
    } catch (e) {
        // Fallback ảnh điện ảnh tĩnh nếu link ảnh gốc lỗi
        return res.redirect('https://picsum.photos/300/450');
    }
});

function getProxyPosterUrl(req, originalUrl) {
    if (!originalUrl) return 'https://picsum.photos/300/450';
    let clean = String(originalUrl).trim();
    if (clean.startsWith('//')) clean = 'https:' + clean;
    if (clean.startsWith('http://')) clean = clean.replace('http://', 'https://');
    if (!clean.startsWith('http')) {
        clean = 'https://phim.nguonc.com' + (clean.startsWith('/') ? '' : '/') + clean;
    }
    const host = req.headers.host || 'nguoncaddon.vercel.app';
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    return `${protocol}://${host}/poster?url=${encodeURIComponent(clean)}`;
}

// Manifest v7.0.0 đổi ID để ép Nuvio xóa bỏ hoàn toàn đệm cũ
const manifest = {
    id: 'com.nguonc.phim.v70',
    version: '7.0.0',
    name: 'Siêu Tầm Phim (Nguồn C)',
    description: 'Xem phim Vietsub/Thuyết minh từ Nguồn C (Bản Chuẩn Poster)',
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

app.get('/', (req, res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

// Catalog Route
app.get('/catalog/:type/:id*', async (req, res) => {
    const type = req.params.type;
    const endpoint = type === 'series' 
        ? '/films/danh-sach/phim-bo?page=1' 
        : '/films/phim-moi-cap-nhat?page=1';

    try {
        const apiRes = await axios.get(`${NGUONC_API}${endpoint}`, {
            timeout: 3000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const items = apiRes.data?.items || [];
        if (items.length > 0) {
            const metas = items.map(item => ({
                id: `nguonc_${item.slug}`,
                type: type === 'series' ? 'series' : 'movie',
                name: item.name || 'Phim Nguồn C',
                poster: getProxyPosterUrl(req, item.thumb_url || item.poster_url),
                posterShape: 'poster',
                description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
            }));
            return res.json({ metas });
        }
    } catch (e) {}

    // Fallback khẩn cấp
    res.json({
        metas: [
            {
                id: 'nguonc_trong-khi',
                type: type === 'series' ? 'series' : 'movie',
                name: 'Trọng Khí (2026)',
                poster: getProxyPosterUrl(req, 'https://phim.nguonc.com/uploads/movies/trong-khi-thumb.jpg'),
                posterShape: 'poster'
            },
            {
                id: 'nguonc_tan-thuoc',
                type: type === 'series' ? 'series' : 'movie',
                name: 'Tàn Thuốc (2026)',
                poster: getProxyPosterUrl(req, 'https://phim.nguonc.com/uploads/movies/tan-thuoc-thumb.jpg'),
                posterShape: 'poster'
            }
        ]
    });
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('nguonc_', '');

        const apiRes = await axios.get(`${NGUONC_API}/film/${rawId}`, {
            timeout: 3000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const movie = apiRes.data?.movie;

        if (!movie) return res.json({ meta: null });

        res.json({
            meta: {
                id: `nguonc_${movie.slug}`,
                type: req.params.type,
                name: movie.name,
                poster: getProxyPosterUrl(req, movie.thumb_url || movie.poster_url),
                background: getProxyPosterUrl(req, movie.poster_url || movie.thumb_url),
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
        rawId = rawId.replace('.json', '').replace('nguonc_', '');

        const parts = rawId.split(':');
        const slug = parts[0];
        const epIndex = parts[1] ? parseInt(parts[1]) - 1 : 0;

        const apiRes = await axios.get(`${NGUONC_API}/film/${slug}`, {
            timeout: 3000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const movie = apiRes.data?.movie;
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
                                          
