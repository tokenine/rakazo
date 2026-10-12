/** Shared JSON-RPC 2.0 invoke against the API's oRPC /rpc endpoint. */

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function orpcInvoke(
  baseUrl: string,
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string>,
  fetchImpl: typeof globalThis.fetch,
): Promise<unknown> {
  const body = { jsonrpc: "2.0", id: Math.floor(Math.random() * 1_000_000), method, params };
  const res = await fetchImpl(baseUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${baseUrl}`);
  const data = (await res.json()) as JsonRpcResponse;
  if (data.error) throw new Error(`ORPCError: ${data.error.message}`);
  return data.result;
}
