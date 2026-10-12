/** Shared JSON-RPC 2.0 invoke against the API's oRPC /rpc endpoint. */

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** The server's oRPC handler routes path-style URLs only: /rpc/threads/send. */
export function rpcUrl(baseUrl: string, method: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/${method.split(".").map(encodeURIComponent).join("/")}`;
}

export async function orpcInvoke(
  baseUrl: string,
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string>,
  fetchImpl: typeof globalThis.fetch,
): Promise<unknown> {
  // Wire format: path-style URL, input serialized under the "json" key.
  const res = await fetchImpl(rpcUrl(baseUrl, method), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ json: params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${baseUrl}`);
  const data = (await res.json()) as { json?: unknown; error?: { message: string } };
  if (data.error) throw new Error(`ORPCError: ${data.error.message}`);
  return data.json ?? data.result;
}
