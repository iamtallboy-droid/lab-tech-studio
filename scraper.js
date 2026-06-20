// scraper.js — Fourthwall storefront scraper
// Pulls real products (title, price, CDN image, checkout URL) from the public
// Tall Boy storefront (shop.tallboy.us) by parsing each product page's
// Product JSON-LD. No API credentials required — the public storefront is
// the source of truth. Falls back to the bundled authoritative catalog if the
// network is unavailable so the dashboard/overlay always have real images.

const axios = require('axios');
const { db } = require('./db');
const { TALL_BOY_PRODUCTS, TALL_BOY_SLUGS, STORE_BASE } = require('./fourthwall-catalog');

const UA = 'Mozilla/5.0 (compatible; LabTechStudioHub/2.0; +https://shop.tallboy.us)';

// ----------------------------------------------------------------------------
// Live scrape helpers
// ----------------------------------------------------------------------------

// Discover product slugs from the /collections/all page so newly added store
// items are picked up automatically. Falls back to the known catalog slugs.
async function discoverSlugs() {
    try {
        const { data: html } = await axios.get(`${STORE_BASE}/collections/all`, {
            headers: { 'User-Agent': UA }, timeout: 8000
        });
        const found = new Set();
        const re = /\/products\/([a-z0-9][a-z0-9-]*)/gi;
        let m;
        while ((m = re.exec(html)) !== null) found.add(m[1]);
        const slugs = [...found];
        return slugs.length ? slugs : TALL_BOY_SLUGS.slice();
    } catch {
        return TALL_BOY_SLUGS.slice();
    }
}

function parseProductLd(html) {
    const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const block of blocks) {
        const json = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
        try {
            const data = JSON.parse(json);
            const node = Array.isArray(data) ? data.find(d => d['@type'] === 'Product') : data;
            if (node && node['@type'] === 'Product') return node;
        } catch { /* ignore malformed block */ }
    }
    return null;
}

function formatPrice(raw) {
    const n = parseFloat(raw);
    if (Number.isFinite(n)) return `$${n.toFixed(2)}`;
    return typeof raw === 'string' && raw.startsWith('$') ? raw : '$0.00';
}

async function scrapeProductPage(slug) {
    const { data: html } = await axios.get(`${STORE_BASE}/products/${slug}`, {
        headers: { 'User-Agent': UA }, timeout: 8000
    });
    const node = parseProductLd(html);
    if (!node) return null;
    const image = Array.isArray(node.image) ? node.image[0] : node.image;
    const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
    return {
        slug,
        product_id: `fw-${slug}`,
        title: node.name || slug,
        price: formatPrice(offer && offer.price),
        image_url: image || null,
        checkout_url: `${STORE_BASE}/products/${slug}`
    };
}

// Attempt a full live scrape of the storefront. Returns an array of products
// (or null on total failure).
async function liveScrape() {
    const slugs = await discoverSlugs();
    const results = await Promise.allSettled(slugs.map(scrapeProductPage));
    const products = results
        .filter(r => r.status === 'fulfilled' && r.value && r.value.image_url)
        .map(r => r.value);
    return products.length ? products : null;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

function catalogAsProducts() {
    return TALL_BOY_PRODUCTS.map(p => ({
        product_id: `fw-${p.slug}`,
        title: p.title,
        price: p.price,
        image_url: p.image_url,
        checkout_url: p.checkout_url
    }));
}

// runStorefrontScrape(showId) — refresh the product catalog for a show.
// username/password are accepted for backward compatibility but unused: the
// public storefront does not require auth.
async function runStorefrontScrape(showId, _username, _password) {
    console.log(`SCRAPER: Refreshing storefront catalog for show_id: ${showId}...`);

    let products = null;
    try {
        products = await liveScrape();
        if (products) {
            console.log(`SCRAPER: Live scrape OK — ${products.length} products from ${STORE_BASE}`);
        }
    } catch (err) {
        console.warn(`SCRAPER: Live scrape failed (${err.message}). Using bundled catalog.`);
    }

    if (!products) {
        products = catalogAsProducts();
        console.log(`SCRAPER: Using bundled authoritative catalog — ${products.length} products.`);
    }

    // Replace the show's full product set so stale items / slot collisions
    // from earlier seeds do not linger.
    try { await db.clearProducts(showId); } catch (e) { console.warn('SCRAPER: clearProducts skipped:', e.message); }

    // Persist every product into its own slot (0..N-1) for this show.
    for (let i = 0; i < products.length; i++) {
        const item = products[i];
        await db.saveProduct({
            product_id: `${showId}-${item.product_id}`,
            show_id: showId,
            title: item.title,
            price: item.price,
            image_url: item.image_url,
            checkout_url: item.checkout_url,
            is_evergreen: 0,
            slot_index: i
        });
    }

    console.log(`SCRAPER: Saved ${products.length} products for show_id: ${showId}`);
    return products;
}

// ----------------------------------------------------------------------------
// Background scheduler (refresh every 15 minutes)
// ----------------------------------------------------------------------------
let scraperIntervals = {};

function startBackgroundScraper(showId, username, password, runNow = true) {
    if (scraperIntervals[showId]) clearInterval(scraperIntervals[showId]);

    if (runNow) {
        runStorefrontScrape(showId, username, password)
            .catch(err => console.error('SCRAPER: initial scrape error:', err));
    }

    scraperIntervals[showId] = setInterval(() => {
        runStorefrontScrape(showId, username, password)
            .catch(err => console.error('SCRAPER: background scrape error:', err));
    }, 15 * 60 * 1000);
}

function stopAllScrapers() {
    Object.keys(scraperIntervals).forEach(key => clearInterval(scraperIntervals[key]));
    scraperIntervals = {};
}

module.exports = {
    runStorefrontScrape,
    startBackgroundScraper,
    stopAllScrapers,
    TALL_BOY_PRODUCTS
};
