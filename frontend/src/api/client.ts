import { DEFAULT_TIMEOUT_MS } from '@/lib/constants'

/**
 * Every failure the UI can see, in one shape. A network drop becomes
 * `status: 0` rather than a raw `TypeError`, so callers never have to
 * distinguish "fetch threw" from "server said no".
 */
export class ApiError extends Error {
  readonly status: number
  readonly detail: string
  readonly url: string

  constructor(status: number, detail: string, url: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.url = url
  }

  /** IB gateway is down. Cached endpoints still work; live ones do not. */
  get isIbDown() {
    return this.status === 503
  }
  get isTimeout() {
    return this.status === 504
  }
  /** Invalid state transition, e.g. pausing a finished job. */
  get isConflict() {
    return this.status === 409
  }
  get isValidation() {
    return this.status === 422
  }
  get isNotFound() {
    return this.status === 404
  }
  get isOffline() {
    return this.status === 0
  }
}

interface PydanticError {
  loc?: (string | number)[]
  msg?: string
}

/**
 * FastAPI's `detail` is a string for our own HTTPExceptions but a
 * `[{loc, msg, type}]` array for pydantic 422s. Both reach the user.
 */
function extractDetail(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback
  const detail = (body as { detail?: unknown }).detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const parts = (detail as PydanticError[])
      .map((entry) => {
        // loc[0] is always "body"; the field name is what the user needs.
        const field = entry.loc?.slice(1).join('.')
        return field ? `${field}: ${entry.msg ?? ''}` : (entry.msg ?? '')
      })
      .filter(Boolean)
    if (parts.length) return parts.join('; ')
  }
  return fallback
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...init } = options

  // Compose the caller's abort signal with our timeout so either can cancel.
  const timeout = AbortSignal.timeout(timeoutMs)
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout

  const requestInit: RequestInit = { ...init, signal: composed }
  if (init.body !== undefined) {
    requestInit.headers = { 'Content-Type': 'application/json', ...init.headers }
  }

  let response: Response
  try {
    response = await fetch(path, requestInit)
  } catch (error) {
    // A caller-initiated abort must propagate so TanStack Query can ignore it,
    // rather than being reported to the user as a failure.
    if (signal?.aborted) throw error
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError(0, `Request timed out after ${timeoutMs / 1000}s`, path)
    }
    throw new ApiError(0, 'Backend unreachable', path)
  }

  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // Non-JSON error body (proxy HTML, empty). The status is the message.
    }
    throw new ApiError(
      response.status,
      extractDetail(body, `${response.status} ${response.statusText}`),
      path,
    )
  }

  // 204 from DELETE /api/schedules/{id} — response.json() would throw.
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T
  }
  return (await response.json()) as T
}

export function apiPost<T>(path: string, body?: unknown, options: ApiFetchOptions = {}) {
  return apiFetch<T>(path, {
    ...options,
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

export function apiPut<T>(path: string, body: unknown, options: ApiFetchOptions = {}) {
  return apiFetch<T>(path, { ...options, method: 'PUT', body: JSON.stringify(body) })
}

export function apiDelete<T>(path: string, options: ApiFetchOptions = {}) {
  return apiFetch<T>(path, { ...options, method: 'DELETE' })
}

/** Build a query string, dropping undefined/null so they never reach the server. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}
