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

// Xử lý Poster qua wsrv.nl để Nuvio hiển thị 100% hình ảnh
function fixPoster(url) {
    if (!url) return 'https://images.weserv.nl/?url=https://via.placeholder.com/300x450';
    let clean = url.trim();
    if (clean.startsWith('//')) clean = 'https:' + clean;
    if (clean.startsWith('http://')) clean = clean.replace('http://', 'https://');
    if (!clean.startsWith('http')) {
        clean = 'https://phim.nguonc.com' + (clean.startsWith('/') ? '' : '/') + clean;
    }
    return `https://images.weserv.nl/?url=${encodeURIComponent(clean)}&w=300&h=450&fit=cover`;
}

// Đổi ID v15 để ép Nuvio xóa cache cũ
const manifest = {
    id: 'com.nguonc.phim.v15',
    version: '1.5.0',
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

app.get('/', (req, res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

// Tải 4 trang đầu (~80-100 phim) để đảm bảo Vercel phản hồi cực nhanh dưới 2s
async function fetchFilmsFast(type) {
    const endpointBase = type === 'series' 
        ? `${NGUONC_API}/films/danh-sach/phim-bo?page=` 
        : `${NGUONC_API}/films/phim-moi-cap-nhat?page=`;

    const pageNumbers = [1, 2, 3, 4];

    const fetchPage = async (page) => {
        try {
            const res = await axios.get(`${endpointBase}${page}`, {
                timeout: 3000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            return res.data?.items || [];
        } catch (e) {
            return [];
        }
    };

    try {
        const results = await Promise.all(pageNumbers.map(fetchPage));
        const allItems = results.flat();

        if (allItems.length > 0) {
            return allItems.map(item => ({
                id: `nguonc_${item.slug}`,
                type: type === 'series' ? 'series' : 'movie',
                name: item.name || 'Phim Nguồn C',
                poster: fixPoster(item.thumb_url || item.poster_url),
                posterShape: 'poster',
                description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
            }));
        }
    } catch (err) {}

    // Fallback khẩn cấp nếu API bị chậm, giữ cho Nuvio KHÔNG BỊ MẤT MỤC
    return [
        {
            id: 'nguonc_trong-khi',
            type: type,
            name: 'Trọng Khí (2026)',
            poster: fixPoster('https://phim.nguonc.com/uploads/movies/trong-khi-thumb.jpg'),
            posterShape: 'poster',
            description: 'Phim Nguồn C'
        },
        {
            id: 'nguonc_tan-thuoc',
            type: type,
            name: 'Tàn Thuốc (2026)',
            poster: fixPoster('https://phim.nguonc.com/uploads/movies/tan-thuoc-thumb.jpg'),
            posterShape: 'poster',
            description: 'Phim Nguồn C'
        }
    ];
}

// Catalog Route
app.get('/catalog/:type/:id*', async (req, res) => {
    const metas = await fetchFilmsFast(req.params.type);
    res.json({ metas });
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('nguonc_', '');

        const response = await axios.get(`${NGUONC_API}/film/${rawId}`, { timeout: 4000 });
        const movie = response.data?.movie;

        if (!movie) return res.json({ meta: null });

        res.json({
            meta: {
                id: `nguonc_${movie.slug}`,
                type: req.params.type,
                name: movie.name,
                poster: fixPoster(movie.thumb_url || movie.poster_url),
                background: fixPoster(movie.poster_url || movie.thumb_url),
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

        const response = await axios.get(`${NGUONC_API}/film/${slug}`, { timeout: 4000 });
        const movie = response.data?.movie;
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
        
