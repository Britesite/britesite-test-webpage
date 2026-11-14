import { test } from "node:test";
import assert from "node:assert/strict";
import { processContactSubmission } from "./process-contact.ts";

const valid = { name: "Ana", email: "ana@example.com", message: "Hello there, five+ chars" };

test("honeypot filled → silent success, without reaching validation or the bot check", async () => {
  let botCalled = false;
  const r = await processContactSubmission({ ...valid, website: "spam" }, async () => {
    botCalled = true;
    return null;
  });
  assert.deepEqual(r, { status: "success" });
  assert.equal(botCalled, false);
});

test("schema failure → validation_failed with field errors, before the bot check", async () => {
  let botCalled = false;
  const r = await processContactSubmission({ name: "", email: "nope", message: "hi" }, async () => {
    botCalled = true;
    return null;
  });
  assert.equal(r.status, "error");
  assert.equal(r.status === "error" && r.code, "validation_failed");
  assert.ok(r.status === "error" && r.fieldErrors?.email);
  assert.equal(botCalled, false);
});

test("bot check verdict short-circuits the send", async () => {
  const r = await processContactSubmission(valid, async () => ({ status: "error", code: "bot_detected" }));
  assert.deepEqual(r, { status: "error", code: "bot_detected" });
});

test("missing env contract → config_missing, with or without a bot check", async () => {
  for (const k of ["CONTACT_SITE_NAME", "CONTACT_RECIPIENT_EMAIL", "CONTACT_FROM_EMAIL"]) delete process.env[k];
  assert.deepEqual(await processContactSubmission(valid), { status: "error", code: "config_missing" });
});

const CONTACT_ENV = {
  CONTACT_SITE_NAME: "Acme",
  CONTACT_RECIPIENT_EMAIL: "owner@example.com",
  CONTACT_FROM_EMAIL: "forms@example.com",
};

function withContactEnv(t: { after: (fn: () => void) => void }) {
  Object.assign(process.env, CONTACT_ENV);
  t.after(() => {
    for (const k of Object.keys(CONTACT_ENV)) delete process.env[k];
  });
}

const JOB_TYPES = ["roof-repair", "new-roof"];

test("a sent message records an enquiry with the page and the chosen job type, deferred", async (t) => {
  withContactEnv(t);
  const recorded: unknown[] = [];
  const deferred: Array<() => Promise<void>> = [];
  const r = await processContactSubmission({ ...valid, jobType: "roof-repair", phone: "+45 1234" }, undefined, {
    page: "/en/contact/",
    jobTypes: JOB_TYPES,
    send: async () => ({ ok: true }),
    record: async (enquiry) => {
      recorded.push(enquiry);
    },
    defer: (task) => {
      deferred.push(task);
    },
  });
  assert.deepEqual(r, { status: "success" });
  assert.equal(recorded.length, 0, "recording must not run inside the visitor's request");
  assert.equal(deferred.length, 1);
  await deferred[0]();
  assert.deepEqual(recorded, [{ page: "/en/contact/", jobType: "roof-repair" }]);
});

test("the free-text subject is never a job type: it can hold a name or a phone number", async (t) => {
  withContactEnv(t);
  const recorded: unknown[] = [];
  await processContactSubmission({ ...valid, subject: "Tilbud tag – Jens Hansen 22334455" }, undefined, {
    page: "/kontakt/",
    jobTypes: JOB_TYPES,
    send: async () => ({ ok: true }),
    record: async (enquiry) => {
      recorded.push(enquiry);
    },
    defer: (task) => void task(),
  });
  assert.deepEqual(recorded, [{ page: "/kontakt/" }]);
});

test("a job type outside the configured list, or with no list configured, is dropped", async (t) => {
  withContactEnv(t);
  const recorded: unknown[] = [];
  const sent: unknown[] = [];
  const ctx = {
    page: "/contact",
    send: async (args: unknown) => {
      sent.push(args);
      return { ok: true as const };
    },
    record: async (enquiry: unknown) => {
      recorded.push(enquiry);
    },
    defer: (task: () => Promise<void>) => void task(),
  };
  await processContactSubmission({ ...valid, jobType: "Jens Hansen 22334455" }, undefined, { ...ctx, jobTypes: JOB_TYPES });
  await processContactSubmission({ ...valid, jobType: "roof-repair" }, undefined, { ...ctx, jobTypes: [] });
  await processContactSubmission({ ...valid, jobType: ["roof-repair"] }, undefined, { ...ctx, jobTypes: JOB_TYPES });
  assert.deepEqual(recorded, [{ page: "/contact" }, { page: "/contact" }, { page: "/contact" }]);
  for (const args of sent) assert.equal((args as { jobType?: string }).jobType, undefined);
});

test("the chosen job type reaches the owner's email too", async (t) => {
  withContactEnv(t);
  let sentJobType: string | undefined;
  await processContactSubmission({ ...valid, jobType: "new-roof" }, undefined, {
    jobTypes: JOB_TYPES,
    send: async (args) => {
      sentJobType = args.jobType;
      return { ok: true };
    },
    record: async () => {},
    defer: () => {},
  });
  assert.equal(sentJobType, "new-roof");
});

test("no page → recorded as the root path, which the agent accepts", async (t) => {
  withContactEnv(t);
  const recorded: unknown[] = [];
  await processContactSubmission(valid, undefined, {
    send: async () => ({ ok: true }),
    record: async (enquiry) => {
      recorded.push(enquiry);
    },
    defer: (task) => void task(),
  });
  assert.deepEqual(recorded, [{ page: "/" }]);
});

test("a failed send, a bot verdict or the honeypot records nothing", async (t) => {
  withContactEnv(t);
  let recorded = 0;
  const ctx = {
    record: async () => {
      recorded++;
    },
    defer: (task: () => Promise<void>) => void task(),
  };
  const failed = await processContactSubmission(valid, undefined, { ...ctx, send: async () => ({ ok: false, error: "send_failed" }) });
  assert.deepEqual(failed, { status: "error", code: "send_failed" });
  await processContactSubmission(valid, async () => ({ status: "error", code: "bot_detected" }), { ...ctx, send: async () => ({ ok: true }) });
  await processContactSubmission({ ...valid, website: "spam" }, undefined, { ...ctx, send: async () => ({ ok: true }) });
  assert.equal(recorded, 0);
});

test("a recording that throws or a defer that throws never fails the visitor's submission", async (t) => {
  withContactEnv(t);
  const quiet = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = quiet;
  });
  const send = async () => ({ ok: true as const });
  const throwingRecord = await processContactSubmission(valid, undefined, {
    send,
    record: async () => {
      throw new Error("agent down");
    },
    defer: (task) => void task(),
  });
  assert.deepEqual(throwingRecord, { status: "success" });
  const throwingDefer = await processContactSubmission(valid, undefined, {
    send,
    record: async () => {},
    defer: () => {
      throw new Error("after() outside a request scope");
    },
  });
  assert.deepEqual(throwingDefer, { status: "success" });
});
