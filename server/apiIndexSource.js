// Source for the TMF API catalog used to populate the exposed/dependent-API
// and event pickers (/api/apis in index.js). Fetches the public
// tmforum-open-api-table S3 index and reshapes it into the flat
// { "TMFnnn_vX.Y.Z": { name, swagger } } map the pickers and
// matchCatalogEntry() expect - this replaced an earlier repo-local
// apiIndex.json file, which is no longer read.
const S3_INDEX_URL = 'https://tmf-open-api-table-documents.s3.eu-west-1.amazonaws.com/Indexes/index.json';

// "Historic" holds superseded releases and is deliberately excluded - the
// pickers should only ever offer a spec someone should actually build
// against. Beta is listed before OpenApiTable so that when the same
// doc+version appears in both (an API that graduated out of Beta), the
// OpenApiTable entry - built from the same options[] shape, just the
// production release - overwrites it as the more authoritative swagger.
const INCLUDED_SECTIONS = ['Beta', 'OpenApiTable'];

// The index is ~650KB; caching avoids re-pulling it from S3 on every picker
// render. TTL, not "forever", so a newly published API/version shows up
// within this session without a server restart.
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = { data: null, fetchedAt: 0 };

// Each release's options[] is a flat bag of asset types (postman, ri,
// conformance, user_guides, ctk, swagger, ...) - pull out just the swagger
// one, since that's the only asset the pickers know how to parse.
function transformS3Index(indexJson) {
  const raw = {};
  for (const section of INCLUDED_SECTIONS) {
    const docs = indexJson[section] || {};
    for (const [docNumber, releases] of Object.entries(docs)) {
      for (const release of releases) {
        const swaggerOption = (release.options || []).find((o) => o.type === 'swagger');
        if (!swaggerOption) continue;
        // version_info is "v4.0.0"; matchCatalogEntry (apiCatalogUtils.js)
        // matches against the bare "4.0.0".
        const version = (release.version_info || '').replace(/^v/i, '').trim();
        if (!version) continue;
        raw[`${docNumber}_v${version}`] = {
          name: release.api_description?.api_name || docNumber,
          swagger: swaggerOption.download,
        };
      }
    }
  }
  return raw;
}

// Fetches + transforms the S3 index, serving the cached copy within
// CACHE_TTL_MS. A fetch failure falls back to a stale cache if one exists
// rather than blanking out every picker over a transient network blip; with
// no cache yet, the error propagates so the caller can surface it.
export async function fetchS3ApiIndex() {
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) return cache.data;
  try {
    const response = await fetch(S3_INDEX_URL, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const indexJson = await response.json();
    cache = { data: transformS3Index(indexJson), fetchedAt: now };
    return cache.data;
  } catch (err) {
    if (cache.data) return cache.data;
    throw err;
  }
}
