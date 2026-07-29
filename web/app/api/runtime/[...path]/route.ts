const localRuntimeUrl =
  process.env.ADVISOR_ATLAS_RUNTIME_URL || "http://127.0.0.1:4318";

async function proxyToRuntime(request: Request) {
  const incomingUrl = new URL(request.url);
  const runtimePath = incomingUrl.pathname.replace(/^\/api\/runtime/, "") || "/";
  const upstreamUrl = `${localRuntimeUrl}${runtimePath}${incomingUrl.search}`;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const response = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    cache: "no-store",
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-length");
  responseHeaders.set("cache-control", "no-store");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxyToRuntime;
export const POST = proxyToRuntime;
export const PATCH = proxyToRuntime;
export const DELETE = proxyToRuntime;
export const OPTIONS = proxyToRuntime;
