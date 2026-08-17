const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const API_BASE = 'https://ophim1.com';

// Cổng Proxy Ảnh: Tải ảnh qua server, đính kèm headers để vượt chặn
app.get('/image-proxy', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send();
    try {
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 5000,
            headers: {
                'Referer': 'https://ophim1.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });
        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(Buffer.from(response.data, 'binary'));
    } catch {
        res.redirect('https://image.tmdb.org/t/p/w500/1E5ba88S318X4Pz2goR2vKCoBu.jpg');
    }
});

function formatPoster(url, host) {
    if (!url) return 'https://image.tmdb.org/t/p/w500/1E5ba88S318X4Pz2goR2vKCoBu.jpg';
    let clean = url.trim().replace(/^https?:\/\//i, '');
    clean = clean.replace(/^(img\.)?(ophim|phimimg)\.(cc|com)/, 'img.phimimg.com');
    if (!clean.includes('img.phimimg.com')) clean = `img.phimimg.com/uploads/movies/${clean.replace(/^\/+/, '')}`;
    
    // Trỏ về route proxy của chính server này
    return `https://${host}/image-proxy?url=https://${encodeURIComponent(clean)}`;
}

const manifest = {
    id: 'vn.nguonc.official.v39',
    version: '39.0.0',
    name: 'Nguồn C (Proxy Force)',
    description: 'Fix ảnh bằng Proxy Server-Side',
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

app.get('/catalog/:type/:id*', async (req, res) => {
    const host = req.get('host');
    const slug = req.params.id.split('=')[1] || (req.params.id.includes('phim_le') ? 'phim-le' : 'phim-bo');
    const url = req.params.id.includes('search=') ? `${API_BASE}/v1/api/tim-kiem?keyword=${slug}` : `${API_BASE}/v1/api/danh-sach/${slug}`;
    try {
        const d = (await axios.get(url, { timeout: 5000 })).data.data.items;
        res.json({ metas: d.map(i => ({ id: `nc_${i.slug}`, type: req.params.type, name: i.name, poster: formatPoster(i.poster_url || i.thumb_url, host) })) });
    } catch { res.json({ metas: [] }); }
});

app.get('/meta/:type/:id*', async (req, res) => {
    const host = req.get('host');
    const slug = req.params.id.replace('.json', '').replace('nc_', '');
    try {
        const d = (await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 5000 })).data;
        res.json({ meta: { id: `nc_${slug}`, type: req.params.type, name: d.movie.name, poster: formatPoster(d.movie.poster_url, host), videos: d.episodes[0].server_data.map((ep, i) => ({ id: `nc_${slug}:${i}`, title: ep.name, episode: i + 1 })) } });
    } catch { res.json({ meta: null }); }
});

app.get('/stream/:type/:id*', async (req, res) => {
    const [slug, idx] = req.params.id.replace('.json', '').replace('nc_', '').split(':');
    try {
        const d = (await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 5000 })).data;
        res.json({ streams: [{ url: d.episodes[0].server_data[idx].link_m3u8 }] });
    } catch { res.json({ streams: [] }); }
});

app.listen(process.env.PORT || 3000);
