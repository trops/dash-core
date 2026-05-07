/**
 * Jest mock for `tailwindcss/colors` — the package isn't installed in
 * dash-core's own node_modules (it's a peer dep). Only `ColorModel`
 * imports it; tests that load ColorModel don't actually need the real
 * palette, so an empty default export is enough to satisfy the import.
 */
module.exports = {};
module.exports.default = {};
