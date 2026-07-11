// Saved campaign links (for re-using links & QR codes later) — stored in Redis
// GET  /api/admin/links            — list saved links
// POST {action:'add', ...}         — save a link
// POST {action:'delete', id}       — remove a saved link
import { getSession } from '../_auth.js';
import { redisConfig, redisPipeline } from '../_redis.js';

export default async function handler(req, res) {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });
    if (!redisConfig()) return res.status(200).json({ configured: false, links: [] });

    try {
        if (req.method === 'GET') {
            const [flat] = await redisPipeline([['HGETALL', 'camp-links']]);
            const links = [];
            for (let i = 0; i < (flat || []).length; i += 2) {
                try { links.push({ id: flat[i], ...JSON.parse(flat[i + 1]) }); } catch {}
            }
            links.sort((a, b) => b.id.localeCompare(a.id));
            return res.status(200).json({ configured: true, links });
        }

        if (req.method === 'POST') {
            const { action } = req.body || {};

            if (action === 'add') {
                const { url, page, source, campaign } = req.body;
                if (!/^https:\/\/[^\s"<>']{4,300}$/.test(String(url || ''))) {
                    return res.status(400).json({ error: 'Invalid link.' });
                }
                const id = Date.now().toString();
                const entry = JSON.stringify({
                    url: String(url).slice(0, 300),
                    page: String(page || '').slice(0, 120),
                    source: String(source || '').slice(0, 40),
                    campaign: String(campaign || '').slice(0, 40),
                    created: new Date().toISOString().slice(0, 10),
                });
                await redisPipeline([['HSET', 'camp-links', id, entry]]);
                return res.status(200).json({ ok: true, id });
            }

            if (action === 'delete') {
                const id = String(req.body.id || '');
                if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid id.' });
                await redisPipeline([['HDEL', 'camp-links', id]]);
                return res.status(200).json({ ok: true });
            }

            return res.status(400).json({ error: 'Unknown action.' });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('links failed:', err);
        return res.status(502).json({ error: 'Could not access saved links.' });
    }
}
