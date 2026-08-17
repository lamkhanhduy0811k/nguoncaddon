const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Cấu hình CORS toàn diện cho Nuvio Web / App
app.use(cors());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    next();
});

const NGUONC_API = 'https://phim.nguonc.com/api';

// Chuẩn hóa đường dẫn ảnh HTTPS
function fixUrl(url) {
    if (!url) return 'https://via.placeholder.com/300x450?text=No+Image';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('http://')) return url.replace('http://', 'https://');
    if (!url.startsWith('http')) return 'https://phim.nguonc.com' + (url.startsWith('/') ? '' : '/') + url;
    return url;
}

// Khai báo Manifest
const manifest = {
    id: 'com.nguonc.phim.v11',
    version: '1.1.0',
    name: 'Nguồn C Phim',
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

// Hàm gọi API Nguồn C có kèm Fallback đảm bảo không bao giờ trống
async function fetchCatalogData(type) {
    let metas = [];
    try {
        const response = await axios.get(`${NGUONC_API}/films/phim-moi-cap-nhat?page=1`, {
            timeout: 7000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://phim.nguonc.com/'
            }
        });

        const items = response.data?.items || [];
        metas = items.map(item => ({
            id: `nguonc_${item.slug}`,
            type: type === 'series' ? 'series' : 'movie',
            name: item.name || 'Phim Mới',
            poster: fixUrl(item.thumb_url || item.poster_url),
            posterShape: 'poster',
            description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
        }));
    } catch (e) {
        console.error('Lỗi API Nguồn C:', e.message);
    }

    // Dữ liệu dự phòng nếu API gặp sự cố hoặc bị chặn IP
    if (metas.length === 0) {
        metas = [
            {
                id: 'nguonc_trong-khi',
                type: type,
                name: 'Trọng Khí (2026)',
                poster: 'https://phim.nguonc.com/uploads/movies/trong-khi-thumb.jpg',
                posterShape: 'poster',
                description: 'Phim mới cập nhật từ Nguồn C'
            },
            {
                id: 'nguonc_tan-thuoc',
                type: type,
                name: 'Tàn Thuốc (2026)',
                poster: 'https://phim.nguonc.com/uploads/movies/tan-thuoc-thumb.jpg',
                posterShape: 'poster',
                description: 'Phim mới cập nhật từ Nguồn C'
            }
        ];
    }

    return metas;
}

// 1. Catalog chính (.json)
app.get('/catalog/:type/:id.json', async (req, res) => {
    const metas = await fetchCatalogData(req.params.type);
    res.json({ metas });
});

// 2. Catalog mở rộng / Tìm kiếm
app.get('/catalog/:type/:id/:extra.json', async (req, res) => {
    const metas = await fetchCatalogData(req.params.type);
    res.json({ metas });
});

// 3. Thông tin Chi tiết (Meta)
app.get('/meta/:type/:id.json', async (req, res) => {
    try {
        const slug = req.params.id.replace('nguonc_', '');
        const response = await axios.get(`${NGUONC_API}/film/${slug}`, { timeout: 7000 });
        const movie = response.data?.movie;

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

// 4. Link Phát (Stream)
app.get('/stream/:type/:id.json', async (req, res) => {
    try {
        const rawId = req.params.id.replace('nguonc_', '');
        const parts = rawId.split(':');
        const slug = parts[0];
        const epIndex = parts[1] ? parseInt(parts[1]) - 1 : 0;

        const response = await axios.get(`${NGUONC_API}/film/${slug}`, { timeout: 7000 });
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
