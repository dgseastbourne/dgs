// POST /api/vehicle-check — proxy for the DVLA Vehicle Enquiry Service (VES) API
// Free DVLA data only: tax/MOT status + basic vehicle details.
// This is NOT a full vehicle history check (no HPI/write-off/mileage/finance data).
import { redisConfig, redisPipeline } from './_redis.js';

const REG_RE = /^[A-Z0-9]{2,7}$/;
const CACHE_TTL = 60 * 60 * 6; // 6 hours — tax/MOT status doesn't change minute to minute
const RATE_LIMIT = 8;          // max lookups per IP per rolling minute
const RATE_WINDOW = 60;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.DVLA_VES_API_KEY;
    // Defaults to DVLA's UAT (test) environment so this works before a live key is issued.
    // Once Sergiu has a production key, set DVLA_VES_API_URL to the live endpoint in Vercel.
    const apiUrl = process.env.DVLA_VES_API_URL
        || 'https://uat.driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles';

    if (!apiKey) {
        return res.status(500).json({ error: 'Vehicle check is not configured yet — please try again later.' });
    }

    const reg = String(req.body?.reg || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!REG_RE.test(reg)) {
        return res.status(400).json({ error: 'Enter a valid UK registration number.' });
    }

    // Rate-limit per IP — DVLA only issues one API key per company, so we protect it from abuse.
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket?.remoteAddress || 'unknown';
    if (redisConfig()) {
        try {
            const [count] = await redisPipeline([
                ['INCR', `vc:rl:${ip}`], ['EXPIRE', `vc:rl:${ip}`, RATE_WINDOW],
            ]);
            if (count > RATE_LIMIT) {
                return res.status(429).json({ error: "You're checking too many plates too quickly — please wait a minute and try again." });
            }
        } catch { /* rate limiting is best-effort */ }
    }

    // Serve from cache if this plate was looked up recently
    if (redisConfig()) {
        try {
            const [cached] = await redisPipeline([['GET', `vc:${reg}`]]);
            if (cached) return res.status(200).json({ ok: true, cached: true, vehicle: JSON.parse(cached) });
        } catch { /* cache is best-effort */ }
    }

    try {
        const r = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ registrationNumber: reg }),
        });
        const data = await r.json().catch(() => ({}));

        if (r.status === 404) {
            return res.status(404).json({ error: 'No vehicle found for that registration number.' });
        }
        if (r.status === 400) {
            return res.status(400).json({ error: 'Enter a valid UK registration number.' });
        }
        if (r.status === 429) {
            return res.status(429).json({ error: 'The DVLA service is busy right now — please try again shortly.' });
        }
        if (!r.ok) {
            console.error('DVLA VES error:', r.status, data);
            return res.status(502).json({ error: 'The DVLA service is unavailable right now — please try again later.' });
        }

        if (redisConfig()) {
            redisPipeline([
                ['SET', `vc:${reg}`, JSON.stringify(data)], ['EXPIRE', `vc:${reg}`, CACHE_TTL],
            ]).catch(() => {});
        }

        return res.status(200).json({ ok: true, cached: false, vehicle: data });
    } catch (err) {
        console.error('DVLA VES request failed:', err);
        return res.status(502).json({ error: 'The DVLA service is unavailable right now — please try again later.' });
    }
}
