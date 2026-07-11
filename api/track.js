// POST /api/track — anonymous page-view counter (no cookies, no IPs, no personal data)
import { redisConfig, redisPipeline } from './_redis.js';

const YEAR = 366 * 24 * 3600;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!redisConfig()) return res.status(200).json({ ok: false }); // storage not connected yet

    try {
        const { p, r } = req.body || {};
        const path = String(p || '/').slice(0, 120);
        if (!/^\/[a-zA-Z0-9\-_/.]*$/.test(path)) return res.status(200).json({ ok: false });
        if (path.startsWith('/admin')) return res.status(200).json({ ok: true }); // don't count admin

        let ref = '';
        try {
            const host = new URL(String(r)).hostname;
            const own = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').replace(/^www\./, '');
            if (host && !host.includes('dgs-lime') && host !== own) ref = host.slice(0, 80);
        } catch {}

        const day = new Date().toISOString().slice(0, 10);      // 2026-07-11
        const month = day.slice(0, 7);                           // 2026-07

        const cmds = [
            ['INCR', `v:${day}`], ['EXPIRE', `v:${day}`, YEAR],
            ['HINCRBY', `pm:${month}`, path, 1], ['EXPIRE', `pm:${month}`, YEAR],
        ];
        if (ref) cmds.push(['HINCRBY', `rm:${month}`, ref, 1], ['EXPIRE', `rm:${month}`, YEAR]);
        await redisPipeline(cmds);
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('track failed:', err);
        return res.status(200).json({ ok: false });
    }
}
