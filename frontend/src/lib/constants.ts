/** Server-side limits the UI must not lie about, and fixed render sizes. */

/**
 * `JobCreateRequest` accepts `workers` up to 16, but `config.max_workers` is 8
 * and the engine silently clamps anything higher. A stepper that goes past 8
 * would misreport what was actually submitted.
 */
export const MAX_WORKERS = 8
export const MAX_RETRIES = 10
export const MAX_DEPTH_LEVELS = 10
export const MAX_SNAPSHOT_INTERVAL_MS = 60_000

/** `config.max_depth_subscriptions` — counts *currently active* recorders too. */
export const MAX_DEPTH_SUBSCRIPTIONS = 3
export const MAX_CHUNKS_PER_JOB = 50_000
export const MAX_CON_IDS = 200

/** Fixed render sizes from the mockup. */
export const TP_BARS = 36
export const CHUNK_CELLS = 96

/** `GET /api/jobs` caps at 500; we fetch unfiltered and partition client-side. */
export const JOBS_PAGE_LIMIT = 200

/**
 * IB paces `reqMatchingSymbols` at ~1/s. The server's limiter is a lock+sleep,
 * so exceeding it does not error — it silently queues and every keystroke
 * resolves late. Throttling is a latency concern, not an error-avoidance one.
 */
export const SEARCH_MIN_INTERVAL_MS = 1100
export const SEARCH_DEBOUNCE_MS = 450

/** Job planning does a paced IB round-trip per instrument before responding. */
export const CREATE_JOB_TIMEOUT_MS = 120_000
export const DEFAULT_TIMEOUT_MS = 15_000

/** Fixed by CatalogWriter; there is no per-job override. */
export const CATALOG_FILE_PATTERN = 'data/{type}/{instrument_id}/{start}_{end}.parquet'

export const THROUGHPUT_WINDOW_S = 600
