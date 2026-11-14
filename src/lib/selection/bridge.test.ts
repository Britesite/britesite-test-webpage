import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { selectionBridgeScript } from "./bridge.ts";

const origin = "https://editor.example.test";
const binding = {type: "website-selection:init", version: 1, id: `sel_${"a".repeat(32)}`, nonce: "n".repeat(43)};

function harness(topLevel = false, commit: string | null = "b".repeat(40)) {
  const listeners = new Map<string, (event: any) => void>();
  const messages: any[] = [];
  const body = element("body");
  const document: Record<string, any> = {createElement: (tag: string) => element(tag), documentElement: element("html"),
    querySelectorAll: (selector: string) => all(body).filter(node => selector.split(",").includes(node.tagName.toLowerCase())), body, addEventListener() {}};
  const parent = {postMessage: (data: unknown, destination: string) => messages.push({data, destination})};
  let now = 1_000_000;
  const window: any = {parent, addEventListener: (type: string, callback: (event: any) => void) => listeners.set(type, callback),
    innerWidth: 1000, innerHeight: 800, scrollX: 0, scrollY: 0, location: {pathname: "/services"}};
  if (topLevel) window.parent = window;
  const observers: any[] = [];
  const timers: Array<() => void> = [];
  class MutationObserver {
    callback: (records: any[]) => void;
    constructor(callback: (records: any[]) => void) { this.callback = callback; }
    observe() { observers.push(this); }
    disconnect() { const index = observers.indexOf(this); if (index >= 0) observers.splice(index, 1); }
  }
  runInNewContext(selectionBridgeScript(origin, commit), {window, document, Date: {now: () => now}, URL, setTimeout: (callback: () => void) => timers.push(callback), clearTimeout: (id: number) => { if (id > 0) timers[id - 1] = () => {}; }, MutationObserver,
    getComputedStyle: (node: any) => ({display: node.hidden ? "none" : "block", visibility: "visible", opacity: node.style.opacity ?? "1"})});
  return {window, parent, messages, listeners, body, document, advance: (ms: number) => { now += ms; },
    flush: () => { for (let i = 0; i < timers.length; i++) { const run = timers[i]; timers[i] = () => {}; run(); } },
    mutate: (records: any[] = [{addedNodes: [], removedNodes: []}]) => observers.slice().forEach(observer => observer.callback(records)),
    send: (data: unknown, source: unknown = parent, from = origin) => listeners.get("message")?.({data, source, origin: from})};
}

function element(tag: string, text = "", attrs: Record<string, string> = {}) {
  const node: any = {tagName: tag.toUpperCase(), nodeType: 1, parentElement: null, childNodes: [], children: [], hidden: false, style: {},
    getAttribute: (name: string) => attrs[name] ?? null,
    hasAttribute: (name: string) => name in attrs,
    setAttribute: (name: string, value: string) => { attrs[name] = value; },
    removeAttribute: (name: string) => { delete attrs[name]; },
    getBoundingClientRect: () => ({x: 10, y: 20, width: 100, height: 30, top: 20, left: 10}),
    append(child: any) { this.childNodes.push(child); if (child.nodeType === 1) this.children.push(child); child.parentElement = this; },
    appendChild(child: any) { this.append(child); },
    remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter((child: any) => child !== this); } },
  };
  if (text) node.append({nodeType: 3, textContent: text});
  return node;
}
function all(node: any): any[] { return [node, ...node.children.flatMap(all)]; }
const eventFor = (target: any, extra = {}) => ({target, preventDefault() {}, stopImmediatePropagation() {}, ...extra});

test("bridge accepts only an exact parent window/origin and bounded versioned binding", () => {
  const h = harness();
  h.send(binding, {}, origin);
  h.send(binding, h.parent, "https://editor.example.test.evil.test");
  h.send({...binding, nonce: "short"});
  h.send({...binding, extra: "untrusted"});
  assert.equal(h.messages.filter(message => message.data.type === "website-selection:ready").length, 0);
  h.send(binding);
  const ready = h.messages.find(message => message.data.type === "website-selection:ready");
  assert.ok(ready);
  assert.equal(ready.destination, origin);
  assert.equal(ready.data.id, binding.id);
  assert.equal(ready.data.nonce, binding.nonce);
});

test("embedded frames get a click blocker that reports unsupported content and is removed on exit", () => {
  const h = harness(); h.body.append(element("iframe"));
  h.send(binding);
  const blocker = h.document.documentElement.children.find((node: any) => node.getAttribute("data-selection-blocked") === "embedded");
  assert.ok(blocker);
  assert.equal(blocker.style.left, "10px");
  h.listeners.get("pointerup")?.(eventFor(blocker));
  assert.ok(h.messages.some(message => message.data.error === "unsupported_embedded_content"));
  h.send({...binding, type: "website-selection:disable"});
  assert.ok(!h.document.documentElement.children.includes(blocker));
});

test("selection suppresses page actions only while bound and ignores forged disable messages", () => {
  const h = harness();
  let prevented = 0;
  const click = () => h.listeners.get("click")?.({preventDefault() { prevented++; }, stopImmediatePropagation() {}});
  click();
  assert.equal(prevented, 0);
  h.send(binding);
  click();
  assert.equal(prevented, 1);
  h.send({...binding, type: "website-selection:disable", nonce: "x".repeat(43)});
  click();
  assert.equal(prevented, 2);
  h.send({...binding, type: "website-selection:disable"});
  click();
  assert.equal(prevented, 2);
});

test("standalone preview installs no selection handlers", () => {
  const h = harness(true);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.messages.length, 0);
});

test("pointer selection describes the clicked element without hidden or form text", () => {
  const h = harness();
  const main = element("main"); h.body.append(main);
  const heading = element("h1", "Our services"); main.append(heading);
  const hidden = element("span", "hidden-private-value"); hidden.hidden = true; heading.append(hidden);
  const form = element("form", "form-private-value"); main.append(form);
  h.send(binding);
  h.listeners.get("pointerup")?.(eventFor(heading));
  const selected = h.messages.find(message => message.data.type === "website-selection:selected");
  assert.ok(selected);
  assert.equal(selected.data.context.pagePath, "/services");
  assert.equal(selected.data.context.element.locator, "body > main:nth-of-type(1) > h1:nth-of-type(1)");
  assert.equal(selected.data.context.element.text, "Our services");
  assert.equal(selected.data.context.element.bounds.x, 10);
  assert.ok(!JSON.stringify(selected).includes("private-value"));
});

test("keyboard selection reaches image context and embedded content is explicitly unsupported", () => {
  const h = harness();
  h.body.append(element("img", "", {alt: "Workshop entrance"}));
  const frame = element("iframe"); h.body.append(frame);
  h.send(binding);
  h.listeners.get("keydown")?.(eventFor(h.body, {key: "Tab", shiftKey: false}));
  h.listeners.get("keydown")?.(eventFor(h.body, {key: "Enter"}));
  const selected = h.messages.find(message => message.data.type === "website-selection:selected");
  assert.ok(selected);
  assert.equal(selected.data.context.element.tag, "img");
  assert.equal(selected.data.context.element.text, "Workshop entrance");
  h.advance(200);
  h.listeners.get("pointerup")?.(eventFor(frame));
  assert.ok(h.messages.some(message => message.data.error === "unsupported_embedded_content"));
});

test("arming the bridge switches the page to a pick cursor and disarming restores it", () => {
  const h = harness();
  const findStyle = () => h.document.documentElement.children.find(
    (node: any) => node.tagName === "STYLE" && node.hasAttribute("data-selection-overlay"));

  h.send(binding);
  assert.equal(h.document.documentElement.getAttribute("data-website-selection"), "armed");
  const style = findStyle();
  assert.ok(style);
  assert.ok(style.textContent.includes("cursor: crosshair"));

  h.listeners.get("keydown")?.(eventFor(h.body, {key: "Escape"}));
  assert.equal(h.document.documentElement.getAttribute("data-website-selection"), null);
  assert.ok(!h.document.documentElement.children.includes(style));

  h.send(binding);
  assert.equal(h.document.documentElement.getAttribute("data-website-selection"), "armed");
  h.send({...binding, type: "website-selection:disable"});
  assert.equal(h.document.documentElement.getAttribute("data-website-selection"), null);
  assert.ok(!findStyle());
});

test("hovering shows a label naming the element under the pointer", () => {
  const h = harness();
  const heading = element("h2", "Visit us in Helsinge."); h.body.append(heading);
  const longText = "This sentence is intentionally much longer than forty characters, for real.";
  const long = element("p", longText); h.body.append(long);
  const frame = element("iframe"); h.body.append(frame);
  const findLabel = () => h.document.documentElement.children.find(
    (node: any) => node.hasAttribute("data-selection-overlay") && node.hasAttribute("data-selection-label"));
  h.send(binding);

  h.listeners.get("pointermove")?.(eventFor(heading));
  let label = findLabel();
  assert.ok(label);
  assert.equal(label.getAttribute("aria-hidden"), "true");
  assert.equal(label.textContent, "h2 · Visit us in Helsinge.");

  h.listeners.get("pointermove")?.(eventFor(long));
  label = findLabel();
  assert.equal(label.textContent, "p · " + longText.slice(0, 40) + "…");

  h.listeners.get("pointermove")?.(eventFor(frame));
  label = findLabel();
  assert.equal(label.style.display, "none");

  h.listeners.get("pointermove")?.(eventFor(heading));
  label = findLabel();
  assert.notEqual(label.style.display, "none");

  h.send({...binding, type: "website-selection:disable"});
  assert.ok(!h.document.documentElement.children.includes(label));
});

function findMarks(h: ReturnType<typeof harness>): any[] {
  return h.document.documentElement.children.filter(
    (node: any) => node.hasAttribute("data-selection-overlay") && node.hasAttribute("data-selection-mark"));
}

test("a pick leaves a numbered mark that survives rebinding for the next pick", () => {
  const h = harness();
  const heading = element("h2", "First"); h.body.append(heading);
  const paragraph = element("p", "Second"); h.body.append(paragraph);
  const bindingA = {type: "website-selection:init", version: 1, id: `sel_${"a".repeat(32)}`, nonce: "1".repeat(43)};
  const bindingB = {type: "website-selection:init", version: 1, id: `sel_${"b".repeat(32)}`, nonce: "2".repeat(43)};

  h.send(bindingA);
  h.listeners.get("pointerup")?.(eventFor(heading));
  let marks = findMarks(h);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].textContent, "1");
  assert.equal(marks[0].getAttribute("data-selection-id"), bindingA.id);

  h.send(bindingB);
  marks = findMarks(h);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].textContent, "1");

  h.listeners.get("pointerup")?.(eventFor(paragraph));
  marks = findMarks(h);
  assert.equal(marks.length, 2);
  assert.equal(marks[1].textContent, "2");
  assert.equal(marks[1].getAttribute("data-selection-id"), bindingB.id);
});

test("unmark removes one mark and renumbers the rest; clear removes all", () => {
  const h = harness();
  const nodeA = element("h2", "A"); h.body.append(nodeA);
  const nodeB = element("p", "B"); h.body.append(nodeB);
  const nodeC = element("h3", "C"); h.body.append(nodeC);
  const bindingA = {type: "website-selection:init", version: 1, id: `sel_${"a".repeat(32)}`, nonce: "1".repeat(43)};
  const bindingB = {type: "website-selection:init", version: 1, id: `sel_${"b".repeat(32)}`, nonce: "2".repeat(43)};
  const bindingC = {type: "website-selection:init", version: 1, id: `sel_${"c".repeat(32)}`, nonce: "3".repeat(43)};

  h.send(bindingA);
  h.listeners.get("pointerup")?.(eventFor(nodeA));
  h.send(bindingB);
  h.listeners.get("pointerup")?.(eventFor(nodeB));
  h.send(bindingC);
  h.listeners.get("pointerup")?.(eventFor(nodeC));
  assert.equal(findMarks(h).length, 3);

  h.send({type: "website-selection:unmark", version: 1, id: bindingC.id, nonce: bindingC.nonce, target: `sel_${"9".repeat(32)}`});
  assert.equal(findMarks(h).length, 3);

  h.send({type: "website-selection:unmark", version: 1, id: bindingC.id, nonce: bindingC.nonce, target: bindingA.id, extra: "x"});
  assert.equal(findMarks(h).length, 3);

  h.send({type: "website-selection:unmark", version: 1, id: bindingC.id, nonce: bindingC.nonce, target: bindingA.id});
  const remaining = findMarks(h);
  assert.equal(remaining.length, 2);
  assert.equal(remaining[0].textContent, "1");
  assert.equal(remaining[0].getAttribute("data-selection-id"), bindingB.id);
  assert.equal(remaining[1].textContent, "2");
  assert.equal(remaining[1].getAttribute("data-selection-id"), bindingC.id);

  h.send({type: "website-selection:clear", version: 1, id: bindingC.id, nonce: bindingC.nonce});
  assert.equal(findMarks(h).length, 0);
});

test("a parent disable drops the marks, Escape keeps them", () => {
  const h = harness();
  const nodeA = element("h2", "A"); h.body.append(nodeA);
  const nodeB = element("p", "B"); h.body.append(nodeB);
  const bindingA = {type: "website-selection:init", version: 1, id: `sel_${"a".repeat(32)}`, nonce: "1".repeat(43)};
  const bindingB = {type: "website-selection:init", version: 1, id: `sel_${"b".repeat(32)}`, nonce: "2".repeat(43)};
  const bindingC = {type: "website-selection:init", version: 1, id: `sel_${"c".repeat(32)}`, nonce: "3".repeat(43)};

  h.send(bindingA);
  h.listeners.get("pointerup")?.(eventFor(nodeA));
  h.send(bindingB);
  h.listeners.get("pointerup")?.(eventFor(nodeB));
  assert.equal(findMarks(h).length, 2);

  h.listeners.get("keydown")?.(eventFor(h.body, {key: "Escape"}));
  assert.ok(h.messages.some(message => message.data.type === "website-selection:disabled"));
  assert.equal(h.document.documentElement.getAttribute("data-website-selection"), null);
  assert.equal(findMarks(h).length, 2);

  h.send(bindingC);
  assert.equal(findMarks(h).length, 2);

  h.send({...bindingC, type: "website-selection:disable"});
  assert.equal(findMarks(h).length, 0);
});

test("clear and unmark still work with the last binding after Escape unbound the page", () => {
  const h = harness();
  const nodeA = element("h2", "A"); h.body.append(nodeA);
  const nodeB = element("p", "B"); h.body.append(nodeB);
  const bindingA = {type: "website-selection:init", version: 1, id: `sel_${"a".repeat(32)}`, nonce: "1".repeat(43)};
  const bindingB = {type: "website-selection:init", version: 1, id: `sel_${"b".repeat(32)}`, nonce: "2".repeat(43)};
  h.send(bindingA);
  h.listeners.get("pointerup")?.(eventFor(nodeA));
  h.send(bindingB);
  h.listeners.get("pointerup")?.(eventFor(nodeB));
  h.listeners.get("keydown")?.(eventFor(h.body, {key: "Escape"}));
  assert.equal(findMarks(h).length, 2);
  // A stale credential (binding A) is refused; the last binding (B) is honoured.
  h.send({...bindingA, type: "website-selection:unmark", target: bindingA.id});
  assert.equal(findMarks(h).length, 2);
  h.send({...bindingB, type: "website-selection:unmark", target: bindingA.id});
  assert.deepEqual(findMarks(h).map(mark => mark.textContent), ["1"]);
  h.send({...bindingB, type: "website-selection:clear"});
  assert.equal(findMarks(h).length, 0);
});

test("the sixth pick is refused with selection_limit", () => {
  const h = harness();
  const nodes = Array.from({length: 6}, (_, i) => { const node = element("p", "n" + i); h.body.append(node); return node; });

  for (let i = 0; i < 5; i++) {
    const letter = "abcde"[i];
    const b = {type: "website-selection:init", version: 1, id: `sel_${letter.repeat(32)}`, nonce: String(i).repeat(43)};
    h.send(b);
    h.listeners.get("pointerup")?.(eventFor(nodes[i]));
  }
  assert.equal(findMarks(h).length, 5);

  const last = {type: "website-selection:init", version: 1, id: `sel_${"f".repeat(32)}`, nonce: "9".repeat(43)};
  h.send(last);
  h.listeners.get("pointerup")?.(eventFor(nodes[5]));
  assert.ok(h.messages.some(message => message.data.type === "website-selection:error" && message.data.error === "selection_limit"));
  assert.equal(findMarks(h).length, 5);
});

test("disable clears the marks left behind after Escape unbound the page", () => {
  const h = harness();
  const nodeA = element("h2", "A"); h.body.append(nodeA);
  h.send(binding);
  h.listeners.get("pointerup")?.(eventFor(nodeA));
  assert.equal(findMarks(h).length, 1);

  h.listeners.get("keydown")?.(eventFor(h.body, {key: "Escape"}));
  assert.equal(findMarks(h).length, 1);

  h.send({...binding, type: "website-selection:disable", nonce: "x".repeat(43)});
  assert.equal(findMarks(h).length, 1);

  h.send({...binding, type: "website-selection:disable"});
  assert.equal(findMarks(h).length, 0);
});

test("Tab reuses one candidate scan until the DOM changes", () => {
  const h = harness();
  h.body.append(element("h2", "A"));
  h.body.append(element("p", "B"));
  h.send(binding);
  let scans = 0;
  const original = h.document.querySelectorAll;
  h.document.querySelectorAll = (selector: string) => { if (selector.includes("h1")) scans++; return original(selector); };

  h.listeners.get("keydown")?.(eventFor(h.body, {key: "Tab"}));
  h.listeners.get("keydown")?.(eventFor(h.body, {key: "Tab"}));
  assert.equal(scans, 1);

  h.mutate();
  h.listeners.get("keydown")?.(eventFor(h.body, {key: "Tab"}));
  assert.equal(scans, 2);
});

test("a click on a transparent frame of a crossfade stack selects the visible frame beneath it", () => {
  const h = harness();
  const stack = element("div"); h.body.append(stack);
  const shown = element("img", "", {alt: "Factory from the air"});
  const hidden = element("img", "", {alt: "Two generations"}); hidden.style.opacity = "0";
  stack.append(shown); stack.append(hidden);
  h.document.elementsFromPoint = () => [hidden, shown, stack, h.body];
  h.send(binding);
  h.listeners.get("pointerup")?.(eventFor(hidden, {clientX: 50, clientY: 30}));
  const selected = h.messages.find(message => message.data.type === "website-selection:selected");
  assert.ok(selected, "the visible frame is selected");
  assert.equal(selected.data.context.element.text, "Factory from the air");
  assert.equal(selected.data.context.element.locator, "body > div:nth-of-type(1) > img:nth-of-type(1)");
  assert.equal(h.messages.filter(message => message.data.type === "website-selection:error").length, 0);
});

test("a transparent element with nothing visible beneath it is still refused", () => {
  const h = harness();
  const ghost = element("img", "", {alt: "gone"}); ghost.style.opacity = "0"; h.body.append(ghost);
  h.document.elementsFromPoint = () => [ghost, h.body];
  h.send(binding);
  h.listeners.get("pointerup")?.(eventFor(ghost, {clientX: 50, clientY: 30}));
  assert.equal(h.messages.filter(message => message.data.type === "website-selection:selected").length, 0);
  assert.equal(h.messages.at(-1).data.error, "unsupported_sensitive_content");
});

test("a pick made before the next binding arrives is held and applied under that binding, not lost", () => {
  const h = harness();
  const nodeA = element("h2", "A"); h.body.append(nodeA);
  const nodeB = element("p", "B"); h.body.append(nodeB);
  const bindingA = {type: "website-selection:init", version: 1, id: `sel_${"a".repeat(32)}`, nonce: "1".repeat(43)};
  const bindingB = {type: "website-selection:init", version: 1, id: `sel_${"b".repeat(32)}`, nonce: "2".repeat(43)};

  h.send(bindingA);
  h.listeners.get("pointerup")?.(eventFor(nodeA));
  h.advance(500);
  // The app is still creating the next slot; the owner has already clicked again.
  h.listeners.get("pointerup")?.(eventFor(nodeB));
  let selected = h.messages.filter(message => message.data.type === "website-selection:selected");
  assert.equal(selected.length, 1, "the second click waits for its own binding");
  assert.equal(findMarks(h).length, 1, "no mark without a binding to own it");

  h.send(bindingB);
  selected = h.messages.filter(message => message.data.type === "website-selection:selected");
  assert.equal(selected.length, 2);
  assert.equal(selected[1].data.id, bindingB.id);
  assert.equal(selected[1].data.context.element.text, "B");
  const marks = findMarks(h);
  assert.equal(marks.length, 2);
  assert.equal(marks[1].getAttribute("data-selection-id"), bindingB.id);
  assert.equal(h.messages.filter(message => message.data.type === "website-selection:error").length, 0);
});

test("a held pick is dropped when the page is disabled before the next binding", () => {
  const h = harness();
  const nodeA = element("h2", "A"); h.body.append(nodeA);
  const nodeB = element("p", "B"); h.body.append(nodeB);
  const bindingA = {type: "website-selection:init", version: 1, id: `sel_${"a".repeat(32)}`, nonce: "1".repeat(43)};
  const bindingB = {type: "website-selection:init", version: 1, id: `sel_${"b".repeat(32)}`, nonce: "2".repeat(43)};
  h.send(bindingA);
  h.listeners.get("pointerup")?.(eventFor(nodeA));
  h.advance(500);
  h.listeners.get("pointerup")?.(eventFor(nodeB));
  h.send({type: "website-selection:disable", version: 1, id: bindingA.id, nonce: bindingA.nonce});
  h.send(bindingB);
  assert.equal(h.messages.filter(message => message.data.type === "website-selection:selected").length, 1);
});

const built = "b".repeat(40);
const head = "c".repeat(40);
const patch = (text: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  ({type: "website-preview:patch", version: 1, base: built, key: head, text, ...extra});
const applied = (h: ReturnType<typeof harness>) => h.messages.filter(message => message.data.type === "website-preview:applied").map(message => message.data.count);
const added = (...nodes: any[]) => [{type: "childList", addedNodes: nodes, removedNodes: []}];
const retyped = (node: any) => [{type: "characterData", target: node, addedNodes: [], removedNodes: []}];

test("a preview patch replaces exactly matching text and reports how much it changed", () => {
  const h = harness();
  const heading = element("h1", "  Our\n services "); h.body.append(heading);
  const other = element("p", "Our services are great"); h.body.append(other);
  const image = element("img", "", {alt: "Our services"}); h.body.append(image);
  h.send(patch([{from: "Our services", to: "What we do"}]));
  assert.equal(heading.childNodes[0].textContent, "  Our\n services ", "waits for the page to settle first");
  h.flush();
  assert.equal(heading.childNodes[0].textContent, "  What we do ");
  assert.equal(other.childNodes[0].textContent, "Our services are great");
  assert.equal(image.getAttribute("alt"), "What we do");
  assert.deepEqual(applied(h), [2]);
  assert.equal(h.messages.at(-1).destination, origin);
  assert.equal(h.messages.at(-1).data.key, head);
});

test("a preview patch is accepted only from the parent, in the documented shape", () => {
  const h = harness();
  const heading = element("h1", "Our services"); h.body.append(heading);
  const good = patch([{from: "Our services", to: "What we do"}]);
  h.send(good, {}, origin);
  h.send(good, h.parent, "https://evil.example.test");
  h.send({...good, key: "short"});
  h.send({...good, html: "<b>x</b>"});
  h.send(patch([{from: "Our services", to: "What we do", html: "<b>x</b>"}]));
  h.send(patch([{from: "", to: "What we do"}]));
  h.send(patch([{from: "Our services", to: "x".repeat(2001)}]));
  h.send(patch(Array.from({length: 201}, () => ({from: "Our services", to: "What we do"}))));
  h.flush();
  assert.equal(heading.childNodes[0].textContent, "Our services");
  assert.deepEqual(applied(h), []);
});

test("a preview patch measured from another build, or sent to a page that does not know its build, is ignored", () => {
  for (const h of [harness(false, "e".repeat(40)), harness(false, null)]) {
    const heading = element("h1", "Our services"); h.body.append(heading);
    h.send(patch([{from: "Our services", to: "What we do"}]));
    h.flush();
    assert.equal(heading.childNodes[0].textContent, "Our services");
    assert.deepEqual(applied(h), []);
  }
});

test("a preview patch waits for a page that is still loading", () => {
  const h = harness();
  h.document.readyState = "loading";
  const heading = element("h1", "Our services"); h.body.append(heading);
  h.send(patch([{from: "Our services", to: "What we do"}]));
  h.flush();
  assert.equal(heading.childNodes[0].textContent, "Our services");
  h.listeners.get("load")?.({});
  h.flush();
  assert.equal(heading.childNodes[0].textContent, "What we do");
});

test("a preview patch leaves scripts, form fields, the other language and its own overlays alone", () => {
  const h = harness();
  h.document.documentElement.setAttribute("lang", "da");
  const script = element("script", "Our services"); h.body.append(script);
  const field = element("textarea", "Our services"); h.body.append(field);
  const english = element("h1", "Our services"); h.body.append(english);
  const danish = element("h2", "Vores ydelser"); h.body.append(danish);
  h.send(patch([{from: "Our services", to: "What we do", locale: "en"}, {from: "Vores ydelser", to: "Det laver vi", locale: "da"}]));
  h.flush();
  assert.equal(script.childNodes[0].textContent, "Our services");
  assert.equal(field.childNodes[0].textContent, "Our services");
  assert.equal(english.childNodes[0].textContent, "Our services");
  assert.equal(danish.childNodes[0].textContent, "Det laver vi");
  script.childNodes[0].textContent = "Vores ydelser";
  h.mutate(retyped(script.childNodes[0])); h.flush();
  assert.equal(script.childNodes[0].textContent, "Vores ydelser");
});

test("swapped texts are each changed once, also when the page re-renders", () => {
  const h = harness();
  const first = element("h1", "Alpha"); h.body.append(first);
  const second = element("h2", "Beta"); h.body.append(second);
  h.send(patch([{from: "Alpha", to: "Beta"}, {from: "Beta", to: "Alpha"}]));
  h.flush();
  assert.equal(first.childNodes[0].textContent, "Beta");
  assert.equal(second.childNodes[0].textContent, "Alpha");
  h.mutate([...retyped(first.childNodes[0]), ...retyped(second.childNodes[0])]); h.flush();
  assert.equal(first.childNodes[0].textContent, "Beta");
  assert.equal(second.childNodes[0].textContent, "Alpha");
  assert.deepEqual(applied(h), [2]);
});

test("content the page renders later is patched too, and the new total is reported", () => {
  const h = harness();
  const heading = element("h1", "Our services"); h.body.append(heading);
  const untouched = element("h2", "Our services"); 
  h.send(patch([{from: "Our services", to: "What we do"}]));
  h.flush();
  const late = element("p", "Our services"); h.body.append(late);
  heading.childNodes[0].textContent = "Our services";
  h.body.append(untouched);
  h.mutate([...added(late), ...retyped(heading.childNodes[0])]); h.flush();
  assert.equal(late.childNodes[0].textContent, "What we do");
  assert.equal(heading.childNodes[0].textContent, "What we do");
  assert.equal(untouched.childNodes[0].textContent, "Our services", "only what the page reported as changed is walked");
  assert.deepEqual(applied(h), [1, 2]);
});

test("patched content the page has removed is forgotten", () => {
  const h = harness();
  const heading = element("h1", "Our services"); h.body.append(heading);
  const gone = element("p", "Our services"); h.body.append(gone);
  h.send(patch([{from: "Our services", to: "What we do"}]));
  h.flush();
  gone.parentElement = null;
  h.mutate(added(element("span", "unrelated"))); h.flush();
  assert.deepEqual(applied(h), [2, 1]);
});

test("clearing a preview patch puts the built text back and stops patching", () => {
  const h = harness();
  const heading = element("h1", "Our services"); h.body.append(heading);
  const image = element("img", "", {alt: "Our services"}); h.body.append(image);
  h.send(patch([{from: "Our services", to: "What we do"}]));
  h.flush();
  h.send({type: "website-preview:clear", version: 1});
  assert.equal(heading.childNodes[0].textContent, "Our services");
  assert.equal(image.getAttribute("alt"), "Our services");
  const late = element("p", "Our services"); h.body.append(late);
  h.mutate(added(late)); h.flush();
  assert.equal(late.childNodes[0].textContent, "Our services");
});

test("a newer preview patch replaces the previous one from the built text, and the older one's pending start is dropped", () => {
  const h = harness();
  const heading = element("h1", "Our services"); h.body.append(heading);
  h.send(patch([{from: "Our services", to: "What we do"}]));
  h.send(patch([{from: "Our services", to: "How we help"}], {key: "d".repeat(40)}));
  h.flush();
  assert.equal(heading.childNodes[0].textContent, "How we help");
  assert.deepEqual(h.messages.filter(message => message.data.type === "website-preview:applied").map(message => message.data.key), ["d".repeat(40)]);
});

const picture = "data:image/png;base64,iVBORw0KGgo=";
const optimised = (path: string, width: number) => `/_next/image?url=${encodeURIComponent(path)}&w=${width}&q=75`;
const reset = (node: any) => [{type: "attributes", target: node, addedNodes: [], removedNodes: []}];

test("a preview patch swaps a changed picture wherever the built page loads it, and nothing else", () => {
  const h = harness();
  const hero = element("img", "", {src: optimised("/images/hero/a.jpg", 1920), srcset: `${optimised("/images/hero/a.jpg", 640)} 640w, ${optimised("/images/hero/a.jpg", 1920)} 1920w`, sizes: "100vw", alt: "Two men"});
  const plain = element("img", "", {src: "/images/hero/a.jpg"});
  const other = element("img", "", {src: optimised("/images/hero/another.jpg", 1920)});
  const remote = element("img", "", {src: "https://cdn.example.test/images/hero/a.jpg"});
  [hero, plain, other, remote].forEach(node => h.body.append(node));
  h.send(patch([{from: "Two men", to: "A screenshot"}], {images: [{from: "/images/hero/a.jpg", src: picture}]}));
  h.flush();
  assert.equal(hero.getAttribute("src"), picture);
  assert.equal(hero.getAttribute("srcset"), null, "the built sizes would win over the new picture");
  assert.equal(hero.getAttribute("alt"), "A screenshot");
  assert.equal(plain.getAttribute("src"), picture);
  assert.equal(other.getAttribute("src"), optimised("/images/hero/another.jpg", 1920));
  assert.equal(remote.getAttribute("src"), "https://cdn.example.test/images/hero/a.jpg");
  assert.deepEqual(applied(h), [3]);
});

test("a preview patch may carry pictures alone, but only as bounded image data", () => {
  const good = harness();
  const hero = element("img", "", {src: "/images/hero/a.jpg"}); good.body.append(hero);
  good.send(patch([], {images: [{from: "/images/hero/a.jpg", src: picture}]}));
  good.flush();
  assert.equal(hero.getAttribute("src"), picture);

  const h = harness();
  const image = element("img", "", {src: "/images/hero/a.jpg"}); h.body.append(image);
  const heading = element("h1", "Our services"); h.body.append(heading);
  const text = [{from: "Our services", to: "What we do"}];
  h.send(patch([]));
  h.send(patch([], {images: []}));
  h.send(patch(text, {images: [{from: "/images/hero/a.jpg", src: "https://evil.example.test/x.png"}]}));
  h.send(patch(text, {images: [{from: "/images/hero/a.jpg", src: "data:image/svg+xml;base64,PHN2Zz4="}]}));
  h.send(patch(text, {images: [{from: "/images/hero/a.jpg", src: "data:text/html;base64,PGI+"}]}));
  h.send(patch(text, {images: [{from: "images/hero/a.jpg", src: picture}]}));
  h.send(patch(text, {images: [{from: "/images/hero/a.jpg", src: picture, html: "<b>x</b>"}]}));
  h.send(patch(text, {images: [{from: "/images/hero/a.jpg", src: `${picture}${"A".repeat(6_000_000)}`}]}));
  h.send(patch(text, {images: Array.from({length: 9}, () => ({from: "/images/hero/a.jpg", src: picture}))}));
  h.flush();
  assert.equal(image.getAttribute("src"), "/images/hero/a.jpg");
  assert.equal(heading.childNodes[0].textContent, "Our services", "a patch with a bad picture is refused whole");
  assert.deepEqual(applied(h), []);
});

test("a swapped picture survives the page setting it again, and clearing puts the built one back", () => {
  const h = harness();
  const src = optimised("/images/hero/a.jpg", 1920), srcset = `${optimised("/images/hero/a.jpg", 640)} 640w`;
  const hero = element("img", "", {src, srcset}); h.body.append(hero);
  h.send(patch([], {images: [{from: "/images/hero/a.jpg", src: picture}]}));
  h.flush();
  hero.setAttribute("src", src); hero.setAttribute("srcset", srcset);
  h.mutate(reset(hero)); h.flush();
  assert.equal(hero.getAttribute("src"), picture);
  assert.equal(hero.getAttribute("srcset"), null);
  const late = element("img", "", {src}); h.body.append(late);
  h.mutate(added(late)); h.flush();
  assert.equal(late.getAttribute("src"), picture);
  assert.deepEqual(applied(h), [1, 2]);
  h.send({type: "website-preview:clear", version: 1});
  assert.equal(hero.getAttribute("src"), src);
  assert.equal(hero.getAttribute("srcset"), srcset);
  assert.equal(late.getAttribute("src"), src);
  assert.equal(late.getAttribute("srcset"), null);
});

test("a patch posted twice while the page loads leaves nothing behind that stops the next patch", () => {
  const h = harness();
  const heading = element("h1", "Our services"); h.body.append(heading);
  const first = patch([{from: "Our services", to: "What we do"}]);
  h.send(first); h.send(first);
  h.flush();
  h.send({type: "website-preview:clear", version: 1});
  h.mutate(added(element("span", "unrelated")));
  h.send({...patch([{from: "Our services", to: "How we work"}]), key: "d".repeat(40)});
  h.flush();
  assert.equal(heading.childNodes[0].textContent, "How we work");
  const late = element("p", "Our services"); h.body.append(late);
  h.mutate(added(late)); h.flush();
  assert.equal(late.childNodes[0].textContent, "How we work");
});
