import { test } from "node:test";
import assert from "node:assert/strict";
import { recordEnquiry, pagePathFrom } from "./record-enquiry.ts";

const ENV = { BRITESITE_AGENT_ORIGIN: "https://agent.example.invalid/", BRITESITE_ENQUIRY_TOKEN: "tok-123" };

type Call = { url: string; init: RequestInit };
function fakeFetch(respond: (call: Call) => Promise<Response> | Response = () => new Response(null, { status: 202 })) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fn, calls };
}

test("posts page and jobType to the agent's enquiries endpoint with the bearer token", async () => {
  const f = fakeFetch();
  await recordEnquiry({ page: "/en/contact/", jobType: "Roof repair" }, { env: ENV, fetch: f.fn });
  assert.equal(f.calls.length, 1);
  const [{ url, init }] = f.calls;
  assert.equal(url, "https://agent.example.invalid/api/enquiries");
  assert.equal(init.method, "POST");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("authorization"), "Bearer tok-123");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(init.body)), { page: "/en/contact/", jobType: "Roof repair" });
});

test("sends only page and jobType — nothing that identifies the visitor", async () => {
  const f = fakeFetch();
  // A caller passing the whole submission must not leak it.
  const everything = {
    page: "/contact",
    jobType: "Quote",
    name: "Ana",
    email: "ana@example.com",
    phone: "+45 1234",
    message: "secret",
    ip: "1.2.3.4",
    userAgent: "UA",
  } as unknown as Parameters<typeof recordEnquiry>[0];
  await recordEnquiry(everything, { env: ENV, fetch: f.fn });
  assert.deepEqual(Object.keys(JSON.parse(String(f.calls[0].init.body))).sort(), ["jobType", "page"]);
});

test("omits jobType when the form has none, or it is blank", async () => {
  const f = fakeFetch();
  await recordEnquiry({ page: "/contact" }, { env: ENV, fetch: f.fn });
  await recordEnquiry({ page: "/contact", jobType: "   " }, { env: ENV, fetch: f.fn });
  for (const c of f.calls) assert.deepEqual(JSON.parse(String(c.init.body)), { page: "/contact" });
});

test("caps page at 200 and jobType at 80 characters", async () => {
  const f = fakeFetch();
  await recordEnquiry({ page: "/" + "p".repeat(300), jobType: "j".repeat(120) }, { env: ENV, fetch: f.fn });
  const body = JSON.parse(String(f.calls[0].init.body));
  assert.equal(body.page.length, 200);
  assert.equal(body.jobType.length, 80);
});

test("a page that is not a path is sent as the root path", async () => {
  const f = fakeFetch();
  await recordEnquiry({ page: "" }, { env: ENV, fetch: f.fn });
  await recordEnquiry({ page: "unknown" }, { env: ENV, fetch: f.fn });
  for (const c of f.calls) assert.equal(JSON.parse(String(c.init.body)).page, "/");
});

test("skips entirely when either env var is unset", async () => {
  for (const env of [
    {},
    { BRITESITE_AGENT_ORIGIN: ENV.BRITESITE_AGENT_ORIGIN },
    { BRITESITE_ENQUIRY_TOKEN: ENV.BRITESITE_ENQUIRY_TOKEN },
    { BRITESITE_AGENT_ORIGIN: "", BRITESITE_ENQUIRY_TOKEN: "" },
  ]) {
    const f = fakeFetch();
    await recordEnquiry({ page: "/contact" }, { env, fetch: f.fn });
    assert.equal(f.calls.length, 0, `fetched with ${JSON.stringify(Object.keys(env))}`);
  }
});

test("never throws: a network error or a non-202 answer is swallowed", async () => {
  const quiet = { env: ENV, log: () => {} };
  await recordEnquiry({ page: "/c" }, { ...quiet, fetch: fakeFetch(() => Promise.reject(new Error("down"))).fn });
  await recordEnquiry({ page: "/c" }, { ...quiet, fetch: fakeFetch(() => new Response("no", { status: 500 })).fn });
  await recordEnquiry({ page: "/c" }, { ...quiet, fetch: (() => { throw new Error("sync"); }) as unknown as typeof fetch });
});

test("gives up after the timeout instead of waiting on a hung agent", async () => {
  let aborted = false;
  const hung = fakeFetch(
    ({ init }) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      }),
  );
  const started = Date.now();
  await recordEnquiry({ page: "/c" }, { env: ENV, fetch: hung.fn, timeoutMs: 50, log: () => {} });
  assert.ok(aborted, "the request should be aborted");
  assert.ok(Date.now() - started < 1000);
});

test("pagePathFrom keeps only the path of the referring page", () => {
  assert.equal(pagePathFrom("https://acme.example/en/contact/?email=ana%40example.com#form"), "/en/contact/");
  assert.equal(pagePathFrom(null), undefined);
  assert.equal(pagePathFrom(""), undefined);
  assert.equal(pagePathFrom("not a url"), undefined);
});
