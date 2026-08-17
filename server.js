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

// Bắt buộc nạp poster qua weserv.nl để xử lý ảnh chống lấy cắp
function fixPoster(url) {
    if (!url) return 'https://images.weserv.nl/?url=https://via.placeholder.com/300x450';
    let clean = url;
    if (clean.startsWith('//')) clean = 'https:' + clean;
    if (clean.startsWith('http://')) clean = clean.replace('http://', 'https://');
    if (!clean.startsWith('http')) clean = 'https://phim.nguonc.com' + (clean.startsWith('/') ? '' : '/') + clean;
    return `https://images.weserv.nl/?url=${encodeURIComponent(clean)}&w=300&h=450&fit=cover`;
}

// Đổi ID v13 để ép Nuvio xóa sạch cache cũ
const manifest = {
    id: 'com.nguonc.phim.v13',
    version: '1.3.0',
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

async function getFilms(type) {
    const endpoint = type === 'series' ? '/films/danh-sach/phim-bo?page=1' : '/films/phim-moi-cap-nhat?page=1';
    let items = [];

    // Cách 1: Thử gọi trực tiếp Nguồn C
    try {
        const res1 = await axios.get(`${NGUONC_API}${endpoint}`, {
            timeout: 4000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });
        if (res1.data?.items?.length > 0) {
            items = res1.data.items;
        }
    } catch (e) {}

    // Cách 2: Gọi qua AllOrigins Proxy nếu bị chặn IP
    if (items.length === 0) {
        try {
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(NGUONC_API + endpoint)}`;
            const res2 = await axios.get(proxyUrl, { timeout: 5000 });
            if (res2.data?.items?.length > 0) {
                items = res2.data.items;
            }
        } catch (e) {}
    }

    let metas = items.map(item => ({
        id: `nguonc_${item.slug}`,
        type: type === 'series' ? 'series' : 'movie',
        name: item.name || 'Phim Nguồn C',
        poster: fixPoster(item.thumb_url || item.poster_url),
        posterShape: 'poster',
        description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
    }));

    // ĐẢM BẢO KHÔNG BAO GIỜ TRẢ VỀ RỖNG (TRÁNH BỊ NUVIO ẨN MỤC)
    if (metas.length === 0) {
        metas = [
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

    return metas;
}

// Catalog Routes
app.get('/catalog/:type/:id*', async (req, res) => {
    const metas = await getFilms(req.params.type);
    res.json({ metas });
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('nguonc_', '');

        let movie = null;
        try {
            const res1 = await axios.get(`${NGUONC_API}/film/${rawId}`, { timeout: 4000 });
            movie = res1.data?.movie;
        } catch(e) {}

        if (!movie) {
            try {
                const res2 = await axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(NGUONC_API + '/film/' + rawId)}`, { timeout: 5000 });
                movie = res2.data?.movie;
            } catch(e) {}
        }

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

        let movie = null;
        try {
            const res1 = await axios.get(`${NGUONC_API}/film/${slug}`, { timeout: 4000 });
            movie = res1.data?.movie;
        } catch(e) {}

        if (!movie) {
            try {
                const res2 = await axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(NGUONC_API + '/film/' + slug)}`, { timeout: 5000 });
                movie = res2.data?.movie;
            } catch(e) {}
        }

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
                    
