// GET /api/admin/stats — page-view statistics for the dashboard (session required)
// Also doubles as GET /api/admin/stats?deps=1 — runtime/dependency version check for the
// Dependencies tab. Folded in here (rather than its own file) to stay under Vercel Hobby's
// 12-serverless-function-per-deployment limit — see dependenciesReport() below.
import { getSession } from '../_auth.js';
import { redisConfig, redisPipeline } from '../_redis.js';

const NPM_DEPENDENCIES = {}; // mirrors package.json — intentionally empty by design

const PINNED_LIBRARIES = [
    {
        name: 'qrcode-generator',
        version: '1.4.4',
        usedIn: 'Admin dashboard — QR code generator (loaded from cdnjs)',
        cdnjsSlug: 'qrcode-generator',
    },
];

async function fetchJson(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const r = await fetch(url, { signal: controller.signal });
        if (!r.ok) return null;
        return await r.json();
    } catch {
        return null;
    } finally {
        clearTimeout(t);
    }
}

// Naive semver-ish compare — true if b is newer than a
function isNewer(a, b) {
    if (!a || !b) return null;
    const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (y > x) return true;
        if (y < x) return false;
    }
    return false;
}

async function dependenciesReport(res) {
    const nodeCurrent = process.version;
    let nodeLatestLts = null;
    const nodeIndex = await fetchJson('https://nodejs.org/dist/index.json');
    if (Array.isArray(nodeIndex)) {
        const ltsEntry = nodeIndex.find((v) => v.lts);
        if (ltsEntry) nodeLatestLts = ltsEntry.version;
    }

    const libraries = await Promise.all(PINNED_LIBRARIES.map(async (lib) => {
        const data = await fetchJson(`https://api.cdnjs.com/libraries/${lib.cdnjsSlug}?fields=version,homepage`);
        const latest = data?.version || null;
        return {
            name: lib.name,
            usedIn: lib.usedIn,
            current: lib.version,
            latest,
            updateAvailable: isNewer(lib.version, latest),
            homepage: data?.homepage || null,
        };
    }));

    return res.status(200).json({
        checkedAt: new Date().toISOString(),
        node: {
            current: nodeCurrent,
            latestLts: nodeLatestLts,
            updateAvailable: isNewer(nodeCurrent, nodeLatestLts),
        },
        npmDependencyCount: Object.keys(NPM_DEPENDENCIES).length,
        libraries,
    });
}

export default async function handler(req, res) {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });

    // Parse the query string ourselves (WHATWG URL API) instead of the
    // framework's req.query, which relies on the deprecated url.parse().
    const query = new URL(req.url, 'http://x').searchParams;

    // Runtime/dependency version check — doesn't need Redis at all
    if (String(query.get('deps') || '') === '1') {
        return dependenciesReport(res);
    }

    if (!redisConfig()) {
        return res.status(200).json({ configured: false });
    }

    try {
        // Per-campaign stats: ?campaign=<label> -> daily (30d) / monthly (12m) / yearly
        const campaign = String(query.get('campaign') || '');
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

        // Call & WhatsApp button clicks: ?clicks=1 -> daily (30d) / monthly (12m) / yearly, per type
        if (String(query.get('clicks') || '') === '1') {
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

            const keysFor = (type) => [
                ...days.map((d) => `clk:${type}:d:${d}`),
                ...months.map((m) => `clk:${type}:m:${m}`),
                ...years.map((y) => `clk:${type}:y:${y}`),
            ];
            const [callVals, waVals] = await redisPipeline([
                ['MGET', ...keysFor('call')],
                ['MGET', ...keysFor('whatsapp')],
            ]);
            const num = (v) => parseInt(v, 10) || 0;
            const shape = (vals) => ({
                daily: days.map((d, i) => ({ date: d, clicks: num(vals[i]) })),
                monthly: months.map((m, i) => ({ month: m, clicks: num(vals[days.length + i]) })),
                yearly: years.map((y, i) => ({ year: y, clicks: num(vals[days.length + months.length + i]) })),
            });
            return res.status(200).json({
                configured: true,
                call: shape(callVals),
                whatsapp: shape(waVals),
            });
        }

        // Yearly "sub-page": ?year=2026 -> monthly totals for that year only
        const year = String(query.get('year') || '');
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
            ['MGET', `clk:call:m:${month}`, `clk:whatsapp:m:${month}`, `clk:call:m:${prevMonth}`, `clk:whatsapp:m:${prevMonth}`],
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
            callClicksMonth: parseInt(results[6][0], 10) || 0,
            waClicksMonth: parseInt(results[6][1], 10) || 0,
            callClicksPrevMonth: parseInt(results[6][2], 10) || 0,
            waClicksPrevMonth: parseInt(results[6][3], 10) || 0,
        });
    } catch (err) {
        console.error('stats failed:', err);
        return res.status(502).json({ error: 'Could not load statistics.' });
    }
}
