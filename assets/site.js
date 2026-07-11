// Mobile menu toggle
const menuBtn = document.querySelector('.menu-btn');
const navLinks = document.querySelector('.nav-links');
if (menuBtn && navLinks) {
    menuBtn.addEventListener('click', () => navLinks.classList.toggle('open'));
    navLinks.querySelectorAll('a').forEach((a) =>
        a.addEventListener('click', () => navLinks.classList.remove('open')));
}

// Site settings (settings.json): WhatsApp number + trackers
const prefix = document.querySelector('link[href*="assets/style.css"]')
    .getAttribute('href').startsWith('../') ? '../' : '';

fetch(prefix + 'settings.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
        if (!s) return;

        // WhatsApp links
        if (/^\d{8,15}$/.test(s.whatsapp || '')) {
            const text = encodeURIComponent("Hi! I'd like to book my car in.");
            document.querySelectorAll('.wa-link').forEach((a) => {
                a.href = `https://wa.me/${s.whatsapp}?text=${text}`;
            });
        }

        // Google Analytics 4
        if (/^G-[A-Z0-9]{4,14}$/.test(s.ga4Id || '')) {
            const gs = document.createElement('script');
            gs.async = true;
            gs.src = `https://www.googletagmanager.com/gtag/js?id=${s.ga4Id}`;
            document.head.appendChild(gs);
            window.dataLayer = window.dataLayer || [];
            function gtag() { window.dataLayer.push(arguments); }
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', s.ga4Id);
        }

        // Verification meta tags (best effort — DNS/GA methods are more reliable)
        const addMeta = (name, content) => {
            if (!content || document.querySelector(`meta[name="${name}"]`)) return;
            const m = document.createElement('meta');
            m.name = name;
            m.content = content;
            document.head.appendChild(m);
        };
        addMeta('google-site-verification', s.gscToken);
        addMeta('msvalidate.01', s.bingToken);
    })
    .catch(() => {});
