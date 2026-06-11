const axios = require('axios');
const { db } = require('./db');

// Evergreen products fallback pool
const EVERGREEN_PRODUCTS = [
    { product_id: 'evg-1', title: 'Evergreen Premium Hoodie', price: '$49.99', image_url: 'logo.svg', checkout_url: 'https://shop.tallboy.us/products/evergreen-hoodie' },
    { product_id: 'evg-2', title: 'Evergreen Ceramic Mug', price: '$14.99', image_url: 'logo.svg', checkout_url: 'https://shop.tallboy.us/products/evergreen-mug' },
    { product_id: 'evg-3', title: 'Evergreen Canvas Tote Bag', price: '$19.99', image_url: 'logo.svg', checkout_url: 'https://shop.tallboy.us/products/evergreen-tote' },
    { product_id: 'evg-4', title: 'Evergreen Structured Cap', price: '$22.99', image_url: 'logo.svg', checkout_url: 'https://shop.tallboy.us/products/evergreen-cap' },
    { product_id: 'evg-5', title: 'Evergreen Tech Decal Pack', price: '$9.99', image_url: 'logo.svg', checkout_url: 'https://shop.tallboy.us/products/evergreen-decals' }
];

// Mock products representing Fourthwall storefront response
const MOCK_FOURTHWALL_PRODUCTS = [
    { id: 'fw-prod-1', name: 'Tall Boy Limited Edition Hoodie', price: 59.99, image: 'logo.svg', url: 'https://shop.tallboy.us/products/tbe-ltd-hoodie' },
    { id: 'fw-prod-2', name: 'Lab Tech Glow Mousepad', price: 29.99, image: 'logo.svg', url: 'https://shop.tallboy.us/products/glow-mousepad' },
    { id: 'fw-prod-3', name: 'Studio Neon Desk Light', price: 39.99, image: 'logo.svg', url: 'https://shop.tallboy.us/products/neon-desk-light' },
    { id: 'fw-prod-4', name: 'Broadcast Tech Masterclass Tee', price: 24.99, image: 'logo.svg', url: 'https://shop.tallboy.us/products/masterclass-tee' },
    { id: 'fw-prod-5', name: 'Tall Boy Premium Shaker Cup', price: 18.99, image: 'logo.svg', url: 'https://shop.tallboy.us/products/shaker-cup' }
];

async function runStorefrontScrape(showId, username, password) {
    console.log(`SCRAPER: Starting scrape for show_id: ${showId}...`);
    let products = [];
    
    if (username && password) {
        // Base64 basic authentication header
        const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
        try {
            const response = await axios.get('https://shop.tallboy.us/api/v1/products', {
                headers: { 'Authorization': authHeader },
                timeout: 5000
            });
            
            // Map Fourthwall API format to our DB schema
            if (response.data && Array.isArray(response.data.products)) {
                products = response.data.products.map(p => ({
                    product_id: p.id || `fw-${Date.now()}-${Math.random()}`,
                    title: p.name || p.title || 'Fourthwall Item',
                    price: typeof p.price === 'number' ? `$${p.price.toFixed(2)}` : (p.price || '$0.00'),
                    image_url: p.image || p.image_url || 'logo.svg',
                    checkout_url: p.url || p.checkout_url || 'https://shop.tallboy.us'
                }));
            }
        } catch (err) {
            console.warn(`SCRAPER: External request to Fourthwall failed (${err.message}). Falling back to local catalog simulation.`);
            products = getMockProducts();
        }
    } else {
        console.log(`SCRAPER: No API credentials provided for shop.tallboy.us. Using local catalog simulation.`);
        products = getMockProducts();
    }

    // Process the 5+5 Selection Pool Roster
    // Scraped items populate slot indices 0 to 4.
    const scrapedPool = products.slice(0, 5);
    
    // Check if we got fewer than 5 active items, and backfill with evergreen items
    while (scrapedPool.length < 5) {
        const fallbackItem = EVERGREEN_PRODUCTS[scrapedPool.length];
        scrapedPool.push({
            product_id: `fallback-${fallbackItem.product_id}`,
            title: fallbackItem.title,
            price: fallbackItem.price,
            image_url: fallbackItem.image_url,
            checkout_url: fallbackItem.checkout_url
        });
    }

    // Save the scraped / backfilled items to database products table (slots 0-4)
    for (let i = 0; i < 5; i++) {
        const item = scrapedPool[i];
        await db.saveProduct({
            product_id: item.product_id,
            show_id: showId,
            title: item.title,
            price: item.price,
            image_url: item.image_url,
            checkout_url: item.checkout_url,
            is_evergreen: item.product_id.startsWith('fallback-') ? 1 : 0,
            slot_index: i
        });
    }

    console.log(`SCRAPER: Successfully loaded slot indexes 0-4 for show_id: ${showId}`);
    return scrapedPool;
}

function getMockProducts() {
    return MOCK_FOURTHWALL_PRODUCTS.map(p => ({
        product_id: p.id,
        title: p.name,
        price: `$${p.price.toFixed(2)}`,
        image_url: p.image,
        checkout_url: p.url
    }));
}

// Background scraper engine scheduled intervals (runs every 15 mins)
let scraperIntervals = {};

function startBackgroundScraper(showId, username, password) {
    // Clear existing if any
    if (scraperIntervals[showId]) {
        clearInterval(scraperIntervals[showId]);
    }

    // Run immediately on start
    runStorefrontScrape(showId, username, password)
        .catch(err => console.error("SCRAPER: Error running initial background scrape:", err));

    // Schedule every 15 minutes (15 * 60 * 1000 ms)
    scraperIntervals[showId] = setInterval(() => {
        runStorefrontScrape(showId, username, password)
            .catch(err => console.error("SCRAPER: Error running background scrape:", err));
    }, 15 * 60 * 1000);
}

function stopAllScrapers() {
    Object.keys(scraperIntervals).forEach(key => {
        clearInterval(scraperIntervals[key]);
    });
    scraperIntervals = {};
}

module.exports = {
    runStorefrontScrape,
    startBackgroundScraper,
    stopAllScrapers,
    EVERGREEN_PRODUCTS
};
