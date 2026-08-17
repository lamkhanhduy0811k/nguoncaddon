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
 * HÀM XỬ LÝ ẢNH CHUYÊN NGHIỆP
 * Sử dụng dịch vụ Proxy ảnh của images.weserv.nl để ép định dạng
 * giúp ứng dụng Nuvio không bị chặn và hiển thị ảnh mượt mà.
 */
function formatPoster(url) {
    if (!url || typeof url !== 'string' || url.trim() === '') {
        return 'https://image.tmdb.org/t/p/w500/1E5ba88S318X4Pz2goR2vKCoBu.jpg';
    }
    
    let cleanUrl = url.trim();
    
    // Chuẩn hóa đường dẫn
    cleanUrl = cleanUrl.replace(/^https?:\/\//i, '');
    cleanUrl = cleanUrl.replace(/^img\.ophim\.cc/, 'img.phimimg.com');
    cleanUrl = cleanUrl.replace(/^img\.ophim1\.com/, 'img.phimimg.com');
    
    // Nếu chưa có domain, gắn domain chuẩn
    if (!cleanUrl.includes('img.phimimg.com') && !cleanUrl.includes('image.tmdb.org')) {
        cleanUrl = cleanUrl.replace(/^\/+/, '');
        if (!cleanUrl.startsWith('uploads/')) {
            cleanUrl = `uploads/movies/${cleanUrl}`;
        }
        cleanUrl = `img.phimimg.com/${cleanUrl}`;
    }
    
    // Trả về URL đã qua proxy để vượt chặn
    return `https://images.weserv.nl/?url=https://${encodeURIComponent(cleanUrl)}&w=400&h=600&fit=cover&output=jpg&n=-1`;
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
    id: 'vn.nguonc.official.v40',
    version: '40.0.0',
    name: 'Nguồn C (Full Fix)',
    description: 'Kho phim độc quyền, xử lý ảnh triệt để',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['nc_'],
    catalogs: [
        { type: 'series', id: 'phim_bo', name: 'Nguồn C - Phim Bộ', extra: [{ name: 'search', isRequired: false }] },
        { type: 'movie', id: 'phim_le', name: 'Nguồn C - Phim Lẻ', extra: [{ name: 'search', isRequired: false }] },
        { type: 'series', id: 'anime', name: 'Nguồn C - Anime', extra: [{ name: 'search', isRequired: false }] },
        { type: 'series', id: 'hoat_hinh_3d', name: 'Nguồn C - Hoạt Hình 3D', extra: [{ name: 'search', isRequired: false }] }
    ]
};

app.get('/', (req, res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

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
    results.forEach(items => { allItems = allItems.concat(items); });
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
            res.json({ metas: items.map(item => ({ id: `nc_${item.slug}`, type: req.params.type, name: item.name, poster: getBestPoster(item), posterShape: 'poster', releaseInfo: item.year })) });
        } catch (e) { res.json({ metas: [] }); }
    } else {
        try {
            let items = [];
            if (rawId.startsWith('phim_le')) items = await fetchMultiplePages('phim-le', 20);
            else if (rawId.startsWith('anime')) items = await fetchMultiplePages('hoat-hinh', 20);
            else if (rawId.startsWith('hoat_hinh_3d')) items = await fetchMultiplePages('hoat-hinh', 20);
            else items = await fetchMultiplePages('phim-bo', 20);
            
            res.json({ metas: items.map(item => ({ id: `nc_${item.slug}`, type: req.params.type, name: item.name, poster: getBestPoster(item), posterShape: 'poster', releaseInfo: item.year })) });
        } catch (e) { res.json({ metas: [] }); }
    }
});

app.get('/meta/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        const slug = rawId.replace('.json', '').replace('nc_', '');
        const apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 5000 });
        const movie = apiRes.data?.movie;
        const rawEpisodes = apiRes.data?.episodes[0]?.server_data || [];
        
        res.json({ meta: { 
            id: `nc_${slug}`, type: req.params.type, name: movie.name, poster: getBestPoster(movie), background: getBestPoster(movie),
            videos: rawEpisodes.map((ep, idx) => ({ id: `nc_${slug}:${idx + 1}`, title: ep.name, episode: idx + 1 })) 
        }});
    } catch (e) { res.json({ meta: null }); }
});

app.get('/stream/:type/:id*', async (req, res) => {
    try {
        let rawId = req.params.id + (req.params[0] || '');
        const slug = rawId.replace('.json', '').replace('nc_', '').split(':')[0];
        const epIdx = parseInt(rawId.split(':')[1]) - 1 || 0;
        const apiRes = await axios.get(`${API_BASE}/phim/${slug}`, { timeout: 5000 });
        const targetEp = apiRes.data.episodes[0].server_data[epIdx];
        res.json({ streams: [{ url: targetEp.link_m3u8 }] });
    } catch (e) { res.json({ streams: [] }); }
});

app.listen(process.env.PORT || 3000);
module.exports = app;
        
