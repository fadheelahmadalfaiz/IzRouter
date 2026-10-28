// A relay in front of a provider can answer with an HTML error page
// (Cloudflare 1020/1101, nginx 502, ...). That must be treated as a transport
// failure: a clean message, a pool-scoped marker so chatCore rotates the pool,
// and never the raw page dumped into the client error.
import { describe, it, expect } from "vitest";
import { parseUpstreamError } from "../../open-sse/utils/error.js";

function htmlResponse(status) {
  const body =
    '<!doctype html><html class="no-js ie6 oldie" lang="en-US"><head><title>Error</title></head><body>error</body></html>';
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

describe("parseUpstreamError relay HTML pages", () => {
  it("does not dump the HTML page into the error message", async () => {
    const parsed = await parseUpstreamError(htmlResponse(403));
    expect(parsed.message).not.toContain("<html");
    expect(parsed.message).toMatch(/HTML error page/i);
  });

  it("marks it pool-scoped so the pool is rotated out", async () => {
    const parsed = await parseUpstreamError(htmlResponse(403));
    expect(parsed.poolScoped).toEqual({ reason: "relay_html_error" });
  });

  it("maps a 4xx relay page to 502 (transport failure, not provider rejection)", async () => {
    const parsed = await parseUpstreamError(htmlResponse(403));
    expect(parsed.statusCode).toBe(502);
  });

  it("keeps a 5xx relay page status", async () => {
    const parsed = await parseUpstreamError(htmlResponse(503));
    expect(parsed.statusCode).toBe(503);
  });

  it("still parses JSON errors normally", async () => {
    const parsed = await parseUpstreamError(
      new Response(JSON.stringify({ error: { message: "boom" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(parsed.statusCode).toBe(400);
    expect(parsed.message).toBe("boom");
    expect(parsed.poolScoped).toBeUndefined();
  });
});
