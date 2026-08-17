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

// Danh sách poster dự phòng từ TMDB CDN (100% hiển thị mượt trên Nuvio)
const TMDB_POSTERS = [
    'https://image.tmdb.org/t/p/w500/1E5ba88S318X4Pz2goR2vKCoBu.jpg',
    'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv3zR1n2ua.jpg',
    'https://image.tmdb.org/t/p/w500/vpnP138aL88S163R31g2GCoBu.jpg'
];

function fixPoster(url, index = 0) {
    if (!url || url.includes('nguonc.com')) {
        return TMDB_POSTERS[index % TMDB_POSTERS.length];
    }
    let clean = String(url).trim();
    if (clean.startsWith('//')) clean = 'https:' + clean;
    if (clean.startsWith('http://')) clean = clean.replace('http://', 'https://');
    return clean;
}

// Manifest v6.0.0 ép Nuvio reset toàn bộ cache ảnh
const manifest = {
    id: 'com.nguonc.phim.v60',
    version: '6.0.0',
    name: 'Siêu Tầm Phim (Nguồn C)',
    description: 'Xem phim Vietsub/Thuyết minh từ Nguồn C (Bản Chuẩn Ảnh)',
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

// Lấy danh sách phim
async function fetchFilms(type) {
    const endpoint = type === 'series' 
        ? '/films/danh-sach/phim-bo?page=1' 
        : '/films/phim-moi-cap-nhat?page=1';

    try {
        const res = await axios.get(`${NGUONC_API}${endpoint}`, {
            timeout: 3000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' 
            }
        });
        if (res.data?.items?.length > 0) {
            return res.data.items.map((item, idx) => ({
                id: `nguonc_${item.slug}`,
                type: type === 'series' ? 'series' : 'movie',
                name: item.name || 'Phim Nguồn C',
                poster: fixPoster(item.thumb_url || item.poster_url, idx),
                posterShape: 'poster',
                description: item.original_name ? `Tên gốc: ${item.original_name}` : ''
            }));
        }
    } catch (e) {}

    return [
        {
            id: 'nguonc_trong-khi',
            type: type === 'series' ? 'series' : 'movie',
            name: 'Trọng Khí (2026)',
            poster: TMDB_POSTERS[0],
            posterShape: 'poster',
            description: 'Phim Nguồn C'
        },
        {
            id: 'nguonc_tan-thuoc',
            type: type === 'series' ? 'series' : 'movie',
            name: 'Tàn Thuốc (2026)',
            poster: TMDB_POSTERS[1],
            posterShape: 'poster',
            description: 'Phim Nguồn C'
        },
        {
            id: 'nguonc_sat-thu-noi-tro',
            type: type === 'series' ? 'series' : 'movie',
            name: 'Sát Thủ Nội Trợ (2026)',
            poster: TMDB_POSTERS[2],
            posterShape: 'poster',
            description: 'Phim Nguồn C'
        }
    ];
}

// Catalog Route
app.get('/catalog/:type/:id*', async (req, res) => {
    const metas = await fetchFilms(req.params.type);
    res.json({ metas });
});

// Meta Route
app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        rawId = rawId.replace('.json', '').replace('nguonc_', '');

        const resNguonC = await axios.get(`${NGUONC_API}/film/${rawId}`, {
            timeout: 3000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const movie = resNguonC.data?.movie;

        if (!movie) return res.json({ meta: null });

        res.json({
            meta: {
                id: `nguonc_${movie.slug}`,
                type: req.params.type,
                name: movie.name,
                poster: fixPoster(movie.thumb_url || movie.poster_url, 0),
                background: fixPoster(movie.poster_url || movie.thumb_url, 0),
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

        const resNguonC = await axios.get(`${NGUONC_API}/film/${slug}`, {
            timeout: 3000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const movie = resNguonC.data?.movie;
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
            
