// Minimal Upstash Redis REST helper (works with Vercel Marketplace env names)
export function redisConfig() {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    return url && token ? { url, token } : null;
}

// Executes a batch of commands, e.g. [["INCR","key"],["EXPIRE","key",3600]]
export async function redisPipeline(commands) {
    const cfg = redisConfig();
    if (!cfg) return null;
    const r = await fetch(`${cfg.url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
    });
    if (!r.ok) throw new Error(`Redis ${r.status}`);
    return (await r.json()).map((x) => x.result);
}
