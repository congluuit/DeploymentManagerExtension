"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_PROVIDERS = void 0;
exports.getProvider = getProvider;
exports.getProviders = getProviders;
const coolifyProvider_1 = require("./coolifyProvider");
const netlifyProvider_1 = require("./netlifyProvider");
const vercelProvider_1 = require("./vercelProvider");
const providers = {
    Vercel: vercelProvider_1.vercelProvider,
    Coolify: coolifyProvider_1.coolifyProvider,
    Netlify: netlifyProvider_1.netlifyProvider,
};
function getProvider(name) {
    return providers[name];
}
function getProviders(names) {
    return names.map((name) => providers[name]);
}
exports.ALL_PROVIDERS = ['Vercel', 'Coolify', 'Netlify'];
//# sourceMappingURL=index.js.map