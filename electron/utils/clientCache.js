/**
 * clientCache
 *
 * Generic provider client cache for the main process.
 * Caches API clients (e.g., algoliasearch, Stripe) by provider hash.
 * Factories are registered per provider type; credentials are resolved
 * from the encrypted store — renderer never sends credential fields.
 */

const providerController = require("../controller/providerController");

const clients = new Map(); // hash → client
const factories = new Map(); // providerType → factoryFn(credentials)
const pendingClients = new Map(); // hash → Promise (dedup in-flight)
const providerLookup = new Map(); // "appId:providerName" → hash (reverse lookup)

const clientCache = {
    registerFactory(providerType, factoryFn) {
        factories.set(providerType, factoryFn);
    },

    async getClient(providerHash, appId, providerName) {
        // Cache hit
        if (clients.has(providerHash)) {
            return clients.get(providerHash);
        }

        // Dedup in-flight (same pattern as mcpController.pendingStarts)
        if (pendingClients.has(providerHash)) {
            return pendingClients.get(providerHash);
        }

        const promise = this._resolve(providerHash, appId, providerName);
        pendingClients.set(providerHash, promise);
        try {
            return await promise;
        } finally {
            pendingClients.delete(providerHash);
        }
    },

    async _resolve(providerHash, appId, providerName) {
        const result = providerController.getProvider(null, appId, providerName);
        if (result.error) throw new Error(result.message);

        const { provider } = result;
        const factory = factories.get(provider.type);
        if (!factory) {
            throw new Error(`No client factory for type: ${provider.type}`);
        }

        const client = factory(provider.credentials);
        clients.set(providerHash, client);
        providerLookup.set(`${appId}:${providerName}`, providerHash);
        console.log(
            `[clientCache] Created ${provider.type} client (hash: ${providerHash.slice(0, 8)}...)`
        );
        return client;
    },

    invalidate(appId, providerName) {
        const lookupKey = `${appId}:${providerName}`;
        const hash = providerLookup.get(lookupKey);
        if (hash) {
            clients.delete(hash);
            providerLookup.delete(lookupKey);
            console.log(
                `[clientCache] Invalidated ${providerName} (hash: ${hash.slice(0, 8)}...)`
            );
        }
    },

    invalidateAll() {
        const count = clients.size;
        clients.clear();
        providerLookup.clear();
        pendingClients.clear();
        console.log(
            `[clientCache] Invalidated all (${count} clients cleared)`
        );
    },

    clear() {
        clients.clear();
        providerLookup.clear();
        pendingClients.clear();
    },
};

module.exports = clientCache;
