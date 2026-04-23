/** Minimal fetch mock: enqueue responses, assert calls. Shared across tests. */
export type MockFetchCall = { url: string; init?: RequestInit };

export interface MockFetchHandle {
  fetchImpl: typeof fetch;
  calls: MockFetchCall[];
  /** Stack a sequence of responses; each fetch pops the next in order. */
  enqueue(factory: () => Response): void;
}

export function createMockFetch(): MockFetchHandle {
  const calls: MockFetchCall[] = [];
  const queue: Array<() => Response> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    calls.push({ url, init: init as RequestInit | undefined });
    const next = queue.shift();
    if (!next) throw new Error(`mockFetch: no response queued for ${url}`);
    return next();
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    enqueue(factory) {
      queue.push(factory);
    },
  };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status: 200,
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {},
): () => Response {
  return () =>
    new Response(JSON.stringify({ error: { code, message } }), {
      status,
      headers: { "content-type": "application/json", ...extraHeaders },
    });
}
