// GET /api/admin/stats — page-view statistics for the dashboard (session required)
import { getSession } from '../_auth.js';
import { redisConfig, redisPipeline } from '../_redis.js';

export default async function handler(req, res) {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });
    if (!redisConfig()) {
        return res.status(200).json({ configured: false });
    }

    try {
        // Per-campaign stats: ?campaign=<label> -> daily (30d) / monthly (12m) / yearly
        const campaign = String(req.query.campaign || '');
        if (campaign) {
            if (!/^[a-z0-9][a-z0-9 _.\-/]{0,89}$/.test(campaign)) {
                return res.status(400).json({ error: 'Invalid campaign label.' });
            }
            const days = [];
            for (let i = 29; i >= 0; i--) {
                days.push(new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10));
            }
            const now = new Date();
            const months = [];
            for (let i = 11; i >= 0; i--) {
                months.push(new Date(now.getFullYear(), now.getMonth() - i, 15).toISOString().slice(0, 7));
            }
            const [yearsList] = await redisPipeline([['SMEMBERS', 'stat-years']]);
            const years = (yearsList || []).sort();

            const values = await redisPipeline([
                ...days.map((d) => ['HGET', `cd:${d}`, campaign]),
                ...months.map((m) => ['HGET', `cm:${m}`, campaign]),
                ...years.map((y) => ['HGET', `cy:${y}`, campaign]),
            ]);
            const num = (v) => parseInt(v, 10) || 0;
            return res.status(200).json({
                campaign,
                daily: days.map((d, i) => ({ date: d, views: num(values[i]) })),
                monthly: months.map((m, i) => ({ month: m, views: num(values[days.length + i]) })),
                yearly: years.map((y, i) => ({ year: y, views: num(values[days.length + months.length + i]) })),
            });
        }

        // Yearly "sub-page": ?year=2026 -> monthly totals for that year only
        const year = String(req.query.year || '');
        if (/^\d{4}$/.test(year)) {
            const keys = Array.from({ length: 12 }, (_, i) =>
                `m:${year}-${String(i + 1).padStart(2, '0')}`);
            const [values] = await redisPipeline([['MGET', ...keys]]);
            const months = values.map((v, i) => ({
                month: i + 1,
                views: parseInt(v, 10) || 0,
            }));
            return res.status(200).json({
                configured: true,
                year,
                months,
                total: months.reduce((s, m) => s + m.views, 0),
            });
        }

        const days = [];
        for (let i = 29; i >= 0; i--) {
            days.push(new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10));
        }
        const month = days[days.length - 1].slice(0, 7);
        const prevMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)
            .toISOString().slice(0, 7);

        const results = await redisPipeline([
            ['MGET', ...days.map((d) => `v:${d}`)],
            ['HGETALL', `pm:${month}`],
            ['HGETALL', `rm:${month}`],
            ['HGETALL', `pm:${prevMonth}`],
            ['HGETALL', `cm:${month}`],
            ['SMEMBERS', 'stat-years'],
        ]);

        const daily = days.map((d, i) => ({ date: d, views: parseInt(results[0][i], 10) || 0 }));

        const toPairs = (flat) => {
            const out = [];
            for (let i = 0; i < (flat || []).length; i += 2) {
                out.push({ key: flat[i], count: parseInt(flat[i + 1], 10) || 0 });
            }
            return out.sort((a, b) => b.count - a.count).slice(0, 10);
        };

        const prevTotal = toPairs(results[3]).reduce((s, x) => s + x.count, 0);

        return res.status(200).json({
            configured: true,
            daily,
            total30: daily.reduce((s, d) => s + d.views, 0),
            topPages: toPairs(results[1]),
            topReferrers: toPairs(results[2]),
            prevMonthTotal: prevTotal,
            topCampaigns: toPairs(results[4]),
            years: (results[5] || []).sort().reverse(),
        });
    } catch (err) {
        console.error('stats failed:', err);
        return res.status(502).json({ error: 'Could not load statistics.' });
    }
}
