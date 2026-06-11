// redis-client.js
// Redis overlay state cache with graceful in-memory fallback.
// If Redis is unavailable, all operations transparently use a local Map.

require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const USE_REDIS = !!process.env.REDIS_URL;

// ----------------------------------------------------------------
// IN-MEMORY FALLBACK CACHE
// ----------------------------------------------------------------
const memoryCache = new Map();

const inMemoryAdapter = {
    get: async (key) => memoryCache.get(key) || null,
    set: async (key, value, exMode, ttl) => {
        memoryCache.set(key, value);
        if (ttl) {
            setTimeout(() => memoryCache.delete(key), ttl * 1000);
        }
    },
    del: async (key) => memoryCache.delete(key),
    keys: async (pattern) => {
        const prefix = pattern.replace('*', '');
        return [...memoryCache.keys()].filter(k => k.startsWith(prefix));
    },
    flushall: async () => memoryCache.clear(),
    ping: async () => 'PONG'
};

// ----------------------------------------------------------------
// REDIS CONNECTION (if ioredis available)
// ----------------------------------------------------------------
let redisClient = inMemoryAdapter;
let isRedisConnected = false;
let redisAvailable = false;

async function initRedis() {
    if (!USE_REDIS) {
        console.log('REDIS: REDIS_URL not set — using in-memory cache fallback.');
        return;
    }

    try {
        const Redis = require('ioredis');
        const client = new Redis(REDIS_URL, {
            lazyConnect: true,
            connectTimeout: 3000,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false
        });

        await client.connect();
        await client.ping();

        redisClient = client;
        isRedisConnected = true;
        redisAvailable = true;

        client.on('error', (err) => {
            if (isRedisConnected) {
                console.warn('REDIS: Connection lost — falling back to in-memory cache.', err.message);
                isRedisConnected = false;
                redisClient = inMemoryAdapter;
            }
        });

        client.on('connect', () => {
            console.log('REDIS: Reconnected to Redis server.');
            redisClient = client;
            isRedisConnected = true;
        });

        console.log(`REDIS: Connected to ${REDIS_URL}`);
    } catch (err) {
        console.warn(`REDIS: Could not connect to ${REDIS_URL} — using in-memory cache fallback. (${err.message})`);
        redisClient = inMemoryAdapter;
        isRedisConnected = false;
    }
}

// ----------------------------------------------------------------
// HIGH-LEVEL CACHE HELPERS
// ----------------------------------------------------------------

/**
 * Get a cached value. Returns parsed JSON or null.
 */
async function cacheGet(key) {
    try {
        const raw = await redisClient.get(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * Set a cached value as JSON with optional TTL in seconds.
 */
async function cacheSet(key, value, ttlSeconds = 86400) {
    try {
        const serialized = JSON.stringify(value);
        await redisClient.set(key, serialized, 'EX', ttlSeconds);
    } catch (err) {
        console.warn(`REDIS: cacheSet failed for key [${key}]:`, err.message);
    }
}

/**
 * Delete a key.
 */
async function cacheDel(key) {
    try {
        await redisClient.del(key);
    } catch {}
}

/**
 * Get a value or compute and cache it if missing.
 */
async function getOrSet(key, ttlSeconds, fetchFn) {
    const cached = await cacheGet(key);
    if (cached !== null) return cached;

    const fresh = await fetchFn();
    await cacheSet(key, fresh, ttlSeconds);
    return fresh;
}

/**
 * Flush all cache keys matching a prefix pattern.
 */
async function flushPrefix(prefix) {
    try {
        const keys = await redisClient.keys(`${prefix}*`);
        for (const key of keys) {
            await redisClient.del(key);
        }
    } catch {}
}

/**
 * Get connection status for dashboard reporting.
 */
function getRedisStatus() {
    return {
        connected: isRedisConnected || !USE_REDIS,
        mode: isRedisConnected ? 'redis' : 'memory',
        url: USE_REDIS ? REDIS_URL : 'in-memory'
    };
}

module.exports = {
    initRedis,
    cacheGet,
    cacheSet,
    cacheDel,
    getOrSet,
    flushPrefix,
    getRedisStatus
};
