import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { annotateInputPurpose, formMessagesFor, injectMirrorFormScript, mirrorFormScript } from "./form-script.ts";

const chromiumPath = await import("playwright").then((p) => p.chromium.executablePath()).catch(() => null);
const noBrowser = !chromiumPath || !existsSync(chromiumPath) ? "Playwright Chromium is not installed (npx playwright install chromium)" : false;

test("formMessagesFor resolves a region-tagged locale and falls back to English", () => {
  assert.equal(formMessagesFor("da-DK").success, formMessagesFor("da").success);
  assert.equal(formMessagesFor("xx").success, formMessagesFor("en").success);
});

test("mirrorFormScript posts to /api/contact, carries the locale's messages and the thank-you path", () => {
  const s = mirrorFormScript({ locale: "da", successPath: "/tak" });
  assert.match(s, /"endpoint":"\/api\/contact\.json"/);
  assert.match(s, /fetch\(cfg\.endpoint/);
  assert.match(s, /"successPath":"\/tak"/);
  assert.match(s, /Tak for din henvendelse/);
  assert.match(s, /name="website"/);
  assert.match(s, /form\[data-mirror-form\]/);
  assert.equal((s.match(/<\/script>/g) || []).length, 1);
});

test("injectMirrorFormScript only touches pages that carry a marked form, and inserts before </body>", () => {
  const script = "<script>x</script>";
  assert.equal(injectMirrorFormScript("<html><body><p>no form</p></body></html>", script), "<html><body><p>no form</p></body></html>");
  assert.equal(
    injectMirrorFormScript('<html><body><form data-mirror-form="1"></form></body></html>', script),
    '<html><body><form data-mirror-form="1"></form><script>x</script></body></html>',
  );
});

// The original's own submit handler is replaced, so anything the script does not
// carry over is lost: a mirrored form's service picker had no `name` (the app read
// it from state), and an extra named text field took the message slot ahead of
// the textarea, which was then dropped. The owner received neither.
test("in a browser: every field the visitor filled reaches the owner, named or not", { skip: noBrowser }, async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const form = `<form data-mirror-form="1">
<label for="navn">Navn</label><input id="navn" name="navn" type="text">
<label for="firma">Firma</label><input id="firma" name="firma">
<input type="email" name="email"><input type="tel" name="telefon">
<label for="k">Hvad skal der laves?</label><select id="k"><option value="">Vælg kategori…</option><option value="gulv">Gulve</option></select>
<label for="o">Omfang</label><input id="o" inputmode="numeric">
<label for="e">Mål/enhed</label><select id="e"><option value="m²">m²</option><option value="stk.">stk.</option></select>
<label for="tom">Tomt felt</label><input id="tom">
<label><input type="checkbox" name="ring"> Ring mig op</label><label><input type="checkbox" name="nyhed"> Nyhedsbrev</label>
<textarea name="besked"></textarea><button type="submit">Send</button></form>`;
    await page.setContent(`<!DOCTYPE html><html><body>${form}${mirrorFormScript({ locale: "da" })}</body></html>`);
    await page.evaluate(() => {
      const w = window as unknown as { fetch: unknown; __posted: unknown };
      w.fetch = (_url: string, opts: { body: string }) => {
        w.__posted = JSON.parse(opts.body);
        return Promise.resolve({ json: () => Promise.resolve({ status: "success" }) });
      };
    });
    await page.fill("#navn", "Ole Hansen");
    await page.fill("#firma", "Hansen ApS");
    await page.fill('input[type="email"]', "ole@example.dk");
    await page.fill('input[type="tel"]', "12345678");
    await page.selectOption("#k", "gulv");
    await page.fill("#o", "100");
    await page.check('input[name="ring"]');
    await page.fill("textarea", "Nyt gulv i stuen.");
    await page.click('button[type="submit"]');
    const posted = await (await page.waitForFunction(() => (window as unknown as { __posted?: unknown }).__posted)).jsonValue();
    assert.deepEqual(posted, {
      name: "Ole Hansen",
      email: "ole@example.dk",
      phone: "12345678",
      message: "Nyt gulv i stuen.\n\nFirma: Hansen ApS\nHvad skal der laves?: Gulve\nOmfang: 100\nMål/enhed: m²\nRing mig op: ✓",
      website: "",
    });
  } finally {
    await browser.close();
  }
});

// The submit button is disabled while the request runs, and a focused element that
// becomes disabled drops focus to <body>: a keyboard visitor heard the result and
// then had to start again from the top of the page.
test("in a browser: after a keyboard submit, focus is on the result message, not the page", { skip: noBrowser }, async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    for (const answer of [{ status: "error", code: "config_missing" }, { status: "error", code: "send_failed" }, { status: "success" }]) {
      const page = await browser.newPage();
      await page.setContent(`<!DOCTYPE html><html><body><form data-mirror-form="1"><input type="email" name="email" value="a@b.dk"><textarea name="besked">Hej</textarea><button type="submit">Send</button></form>${mirrorFormScript({ locale: "da" })}</body></html>`);
      await page.evaluate((res) => {
        (window as unknown as { fetch: unknown }).fetch = () => Promise.resolve({ json: () => Promise.resolve(res) });
      }, answer);
      await page.focus('button[type="submit"]');
      await page.keyboard.press("Enter");
      await page.waitForSelector("[data-mirror-note]");
      const focused = await page.evaluate(() => {
        const a = document.activeElement;
        return a ? `${a.tagName}${a.hasAttribute("data-mirror-note") ? "[data-mirror-note]" : ""}` : "none";
      });
      assert.equal(focused, "DIV[data-mirror-note]", `${JSON.stringify(answer)}: focus landed on ${focused}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("annotateInputPurpose names the purpose of a marked form's name, email and phone inputs, nothing else", () => {
  const html = '<input type="email" name="newsletter"><form id="f" data-mirror-form="1"><input id="navn" type="text" required="" name="navn"><input id="telefon" type="tel" name="telefon"><input id="email" type="email" name="email"><input type="text" name="firma"><input type="email" name="cc" autocomplete="off"></form>';
  const out = annotateInputPurpose(html);
  assert.ok(out.includes('<input id="navn" type="text" required="" name="navn" autocomplete="name">'), out);
  assert.ok(out.includes('<input id="telefon" type="tel" name="telefon" autocomplete="tel">'), out);
  assert.ok(out.includes('<input id="email" type="email" name="email" autocomplete="email">'), out);
  assert.ok(out.includes('<input type="text" name="firma">'), "a field of unknown purpose is left alone");
  assert.ok(out.includes('<input type="email" name="cc" autocomplete="off">'), "the original's own autocomplete stands");
  assert.ok(out.startsWith('<input type="email" name="newsletter">'), "an input outside a marked form is not the mirror's to change");
});
