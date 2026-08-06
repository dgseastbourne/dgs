// POST /api/mot-history — proxy for the DVSA MOT History API
// Free DVSA data only: full MOT test-by-test history, mileage readings, advisories/failures.
import { redisConfig, redisPipeline } from './_redis.js';

const REG_RE = /^[A-Z0-9]{2,7}$/;
const CACHE_TTL = 60 * 60 * 6; // 6 hours
const RATE_LIMIT = 8;          // max lookups per IP per rolling minute
const RATE_WINDOW = 60;
const TOKEN_TTL_MARGIN = 60;   // refresh the access token 60s before it actually expires

// Access tokens are issued by Microsoft Entra ID and last ~60 minutes — cache in Redis
// so we're not re-authenticating on every single lookup.
async function getAccessToken() {
    const tokenUrl = process.env.MOT_HISTORY_TOKEN_URL; // full URL incl. tenant ID, sent by DVSA
    const clientId = process.env.MOT_HISTORY_CLIENT_ID;
    const clientSecret = process.env.MOT_HISTORY_CLIENT_SECRET;
    const scope = process.env.MOT_HISTORY_SCOPE || 'https://tapi.dvsa.gov.uk/.default';
    if (!tokenUrl || !clientId || !clientSecret) return null;

    if (redisConfig()) {
        try {
            const [cached] = await redisPipeline([['GET', 'mh:token']]);
            if (cached) return cached;
        } catch { /* best-effort */ }
    }

    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope,
    });
    const r = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    if (!r.ok) throw new Error(`Token request failed: ${r.status}`);
    const data = await r.json();
    const token = data.access_token;
    const ttl = Math.max((data.expires_in || 1199) - TOKEN_TTL_MARGIN, 60);

    if (redisConfig() && token) {
        redisPipeline([['SET', 'mh:token', token], ['EXPIRE', 'mh:token', ttl]]).catch(() => {});
    }
    return token;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.MOT_HISTORY_API_KEY;
    const baseUrl = process.env.MOT_HISTORY_API_URL || 'https://history.mot.api.gov.uk';
    if (!apiKey || !process.env.MOT_HISTORY_CLIENT_ID) {
        return res.status(500).json({ error: 'MOT history is not configured yet.' });
    }

    const reg = String(req.body?.reg || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!REG_RE.test(reg)) {
        return res.status(400).json({ error: 'Enter a valid UK registration number.' });
    }

    // Rate-limit per IP — protects the daily quota (shared across the whole API key)
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket?.remoteAddress || 'unknown';
    if (redisConfig()) {
        try {
            const [count] = await redisPipeline([
                ['INCR', `mh:rl:${ip}`], ['EXPIRE', `mh:rl:${ip}`, RATE_WINDOW],
            ]);
            if (count > RATE_LIMIT) {
                return res.status(429).json({ error: "You're checking too many plates too quickly — please wait a minute and try again." });
            }
        } catch { /* best-effort */ }
    }

    // Serve from cache if this plate's MOT history was looked up recently
    if (redisConfig()) {
        try {
            const [cached] = await redisPipeline([['GET', `mh:${reg}`]]);
            if (cached) return res.status(200).json({ ok: true, cached: true, vehicle: JSON.parse(cached) });
        } catch { /* best-effort */ }
    }

    let token;
    try {
        token = await getAccessToken();
    } catch (err) {
        console.error('MOT history token error:', err);
        return res.status(502).json({ error: 'The MOT history service is unavailable right now — please try again later.' });
    }
    if (!token) {
        return res.status(500).json({ error: 'MOT history is not configured yet.' });
    }

    try {
        const r = await fetch(`${baseUrl}/v1/trade/vehicles/registration/${reg}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, 'X-API-Key': apiKey },
        });
        const data = await r.json().catch(() => ({}));

        if (r.status === 404) {
            return res.status(404).json({ error: 'No MOT history found for that registration number.' });
        }
        if (r.status === 400) {
            return res.status(400).json({ error: 'Enter a valid UK registration number.' });
        }
        if (r.status === 429) {
            return res.status(429).json({ error: 'The MOT history service is busy right now — please try again shortly.' });
        }
        if (!r.ok) {
            console.error('MOT history error:', r.status, data);
            return res.status(502).json({ error: 'The MOT history service is unavailable right now — please try again later.' });
        }

        const vehicle = Array.isArray(data) ? data[0] : data;
        if (!vehicle) {
            return res.status(404).json({ error: 'No MOT history found for that registration number.' });
        }

        if (redisConfig()) {
            redisPipeline([
                ['SET', `mh:${reg}`, JSON.stringify(vehicle)], ['EXPIRE', `mh:${reg}`, CACHE_TTL],
            ]).catch(() => {});
        }

        return res.status(200).json({ ok: true, cached: false, vehicle });
    } catch (err) {
        console.error('MOT history request failed:', err);
        return res.status(502).json({ error: 'The MOT history service is unavailable right now — please try again later.' });
    }
}
