// GET /api/admin/dependencies — reports runtime + pinned library versions and checks for updates
// (session required). The public site and admin dashboard intentionally ship with zero npm
// packages — this endpoint reports that fact plus the one pinned CDN library and the Node
// runtime version, so update this list if that ever changes.
import { getSession } from '../_auth.js';

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

export default async function handler(req, res) {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });

    // Node.js runtime (the actual version this function is executing under, right now)
    const nodeCurrent = process.version;
    let nodeLatestLts = null;
    const nodeIndex = await fetchJson('https://nodejs.org/dist/index.json');
    if (Array.isArray(nodeIndex)) {
        const ltsEntry = nodeIndex.find((v) => v.lts);
        if (ltsEntry) nodeLatestLts = ltsEntry.version;
    }

    // Pinned CDN libraries — checked live against cdnjs
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
