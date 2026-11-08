/**
 * (De)serialization of plugin options for `react-memory-leak-detector/next`.
 *
 * Turbopack only accepts JSON-serializable loader options, but several options
 * are RegExps (`include`, `exclude`, `excludeNames`, `excludeUnmountTracking`).
 * `serializeOptions` encodes every RegExp as `{ __heapRegExp: [source, flags] }`
 * and the loader rebuilds it with `reviveOptions`. Used for webpack too, so
 * both bundlers take the same path.
 */
const REGEXP_TAG = "__heapRegExp";

function serializeOptions(value) {
  if (value instanceof RegExp) return { [REGEXP_TAG]: [value.source, value.flags] };
  if (Array.isArray(value)) return value.map(serializeOptions);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = serializeOptions(v);
    }
    return out;
  }
  return value;
}

function reviveOptions(value) {
  if (Array.isArray(value)) return value.map(reviveOptions);
  if (value && typeof value === "object") {
    const tagged = value[REGEXP_TAG];
    if (Array.isArray(tagged) && Object.keys(value).length === 1) {
      return new RegExp(tagged[0], tagged[1]);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = reviveOptions(v);
    return out;
  }
  return value;
}

module.exports = { serializeOptions, reviveOptions };
