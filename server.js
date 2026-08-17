const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const API_BASE = 'https://ophim1.com';

// Hàm Proxy ảnh mới: Dùng CDN quốc tế, nhanh và ổn định hơn hẳn Vercel Proxy
function formatPoster(url) {
    if (!url) return 'https://image.tmdb.org/t/p/w500/1E5ba88S318X4Pz2goR2vKCoBu.jpg';
    
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http')) {
        cleanUrl = cleanUrl.replace(/^\/+/, '');
        cleanUrl = `https://img.phimimg.com/uploads/movies/${cleanUrl}`;
    }
    
    // Sử dụng CDN images.weserv.nl để vượt chặn, n=-1 là để không lưu cache lỗi
    return `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}&n=-1`;
}

function getBestPoster(item) {
    return formatPoster(item.poster_url || item.thumb_url);
}

const manifest = {
    id: 'vn.nguonc.official.v37',
    version: '37.0.0',
    name: 'Nguồn C (Fix Ảnh)',
    description: 'Fix triệt để lỗi đen ảnh bằng CDN quốc tế',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['nc_'],
    catalogs: [
        { type: 'series', id: 'phim_bo', name: 'Nguồn C - Phim Bộ', extra: [{ name: 'search', isRequired: false }] },
        { type: 'movie', id: 'phim_le', name: 'Nguồn C - Phim Lẻ', extra: [{ name: 'search', isRequired: false }] },
        { type: 'series', id: 'anime', name: 'Nguồn C - Anime', extra: [{ name: 'search', isRequired: false }] }
    ]
};

app.get('/manifest.json', (req, res) => res.json(manifest));
app.get('/', (req, res) => res.json(manifest));

// Lấy danh sách
app.get('/catalog/:type/:id*', async (req, res) => {
    try {
        const type = req.params.id.includes('search=') ? 'tim-kiem' : (req.params.id.includes('phim_le') ? 'phim-le' : 'phim-bo');
        const url = req.params.id.includes('search=') 
            ? `${API_BASE}/v1/api/tim-kiem?keyword=${req.params.id.split('=')[1]}`
            : `${API_BASE}/v1/api/danh-sach/${type === 'phim-le' ? 'phim-le' : 'phim-bo'}`;
            
        const apiRes = await axios.get(url, { timeout: 5000 });
        const items = apiRes.data?.data?.items || [];
        res.json({ metas: items.map(i => ({
            id: `nc_${i.slug}`, type: req.params.type, name: i.name, poster: getBestPoster(i), releaseInfo: i.year
        }))});
    } catch { res.json({ metas: [] }); }
});

// Meta
app.get('/meta/:type/:id*', async (req, res) => {
    const slug = req.params.id.replace('.json', '').replace('nc_', '');
    try {
        const apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 5000 });
        const movie = apiRes.data.movie;
        res.json({ meta: {
            id: `nc_${slug}`, type: req.params.type, name: movie.name, 
            poster: getBestPoster(movie), background: getBestPoster(movie),
            videos: apiRes.data.episodes[0].server_data.map((ep, idx) => ({
                id: `nc_${slug}:${idx}`, title: ep.name, episode: idx + 1
            }))
        }});
    } catch { res.json({ meta: null }); }
});

// Stream
app.get('/stream/:type/:id*', async (req, res) => {
    const [slug, epIdx] = req.params.id.replace('.json', '').replace('nc_', '').split(':');
    try {
        const apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 5000 });
        res.json({ streams: [{ url: apiRes.data.episodes[0].server_data[epIdx].link_m3u8 }] });
    } catch { res.json({ streams: [] }); }
});

app.listen(process.env.PORT || 3000);
