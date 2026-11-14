// public/embed-facade.js against a minimal stand-in for the DOM: setAttribute
// throws on a name the DOM would reject, as the browser's does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "public", "embed-facade.js"), "utf8");

function element() {
  const attrs = new Map();
  return {
    attrs,
    setAttribute(name, value) {
      if (!/^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(name)) throw new Error(`InvalidCharacterError: ${name}`);
      attrs.set(name.toLowerCase(), String(value));
    },
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
    focus() {},
  };
}

function clickFacade(embedAttrs) {
  let onClick;
  let replacedWith = null;
  const button = { textContent: "Play video", closest: (sel) => (sel === "[data-embed-load]" ? button : sel === "[data-embed-facade]" ? wrap : null) };
  const wrap = element();
  wrap.setAttribute("data-embed-attrs", JSON.stringify(embedAttrs));
  wrap.setAttribute("data-embed-src", "https://player.vimeo.com/video/7?dnt=1");
  wrap.setAttribute("data-embed-provider", "vimeo");
  wrap.querySelector = () => button;
  wrap.replaceWith = (el) => { replacedWith = el; };
  const document = { addEventListener: (type, fn) => { if (type === "click") onClick = fn; }, createElement: () => element() };
  runInNewContext(SCRIPT, { document });
  onClick({ target: button, preventDefault() {} });
  return replacedWith;
}

test("a malformed attribute name never stops the frame from loading", () => {
  const frame = clickFacade({ class: "video", 'b"': "", title: "Intro" });
  assert.ok(frame, "the facade was replaced by the frame");
  assert.equal(frame.getAttribute("src"), "https://player.vimeo.com/video/7?dnt=1");
  assert.equal(frame.getAttribute("class"), "video");
  assert.equal(frame.getAttribute("title"), "Intro");
});

test("event-handler attributes are not copied onto the rebuilt frame", () => {
  const frame = clickFacade({ onload: "track()", ONERROR: "x()", title: "Intro" });
  assert.equal(frame.hasAttribute("onload"), false);
  assert.equal(frame.hasAttribute("onerror"), false);
});
