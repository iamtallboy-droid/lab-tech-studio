// rss.js — Live RSS ticker feed fetcher
// Pulls headline titles from public tech news RSS feeds for the dashboard's
// "Live RSS Feeds" ticker source. No API keys required — these are public
// RSS 2.0 endpoints; we just fetch + extract <item><title> text.

const axios = require('axios');

const UA = 'Mozilla/5.0 (compatible; LabTechStudioHub/2.0; +https://shop.tallboy.us)';

const FEED_URLS = {
    engadget: 'https://www.engadget.com/rss.xml',
    '9to5google': 'https://9to5google.com/feed/',
    techradar: 'https://www.techradar.com/feeds.xml'
};

const ENTITY_MAP = {
    amp: '&', lt: '<', gt: '>', quot: '"', '#039': "'", apos: "'",
    nbsp: ' ', mdash: '—', ndash: '–',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…'
};

function decodeEntities(str) {
    return str
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&(amp|lt|gt|quot|#039|apos|nbsp|mdash|ndash|lsquo|rsquo|ldquo|rdquo|hellip);/gi,
            (_, name) => ENTITY_MAP[name.toLowerCase()] ?? name);
}

function parseRssTitles(xml, limit) {
    const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    const titles = [];
    for (const item of items) {
        const m = item.match(/<title>([\s\S]*?)<\/title>/i);
        if (!m) continue;
        let title = m[1].trim();
        const cdata = title.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
        if (cdata) title = cdata[1].trim();
        title = decodeEntities(title).replace(/\s+/g, ' ').trim();
        if (title) titles.push(title);
        if (titles.length >= limit) break;
    }
    return titles;
}

async function fetchRssHeadlines(feedKey, limit = 10) {
    const url = FEED_URLS[feedKey];
    if (!url) throw new Error(`Unknown RSS feed: ${feedKey}`);
    const { data: xml } = await axios.get(url, {
        headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' },
        timeout: 8000
    });
    return parseRssTitles(xml, limit);
}

module.exports = { fetchRssHeadlines, FEED_URLS };
