// `commit` is the commit this build was made from. A preview patch names the
// build it was measured from and is ignored by any other, so a page without a
// known commit (null) never shows provisional text.
export function selectionBridgeScript(parentOrigin: string, commit: string | null | undefined = process.env.VERCEL_GIT_COMMIT_SHA): string {
  const origin = new URL(parentOrigin);
  if (origin.protocol !== "https:" || origin.origin !== parentOrigin) throw new Error("invalid_selection_origin");
  const builtCommit = commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null;
  return `(function(parentOrigin,builtCommit){${BRIDGE}})(${JSON.stringify(parentOrigin).replace(/</g, "\\u003c")},${JSON.stringify(builtCommit)});`;
}

const BRIDGE = String.raw`
if (window.parent === window) return;
var binding = null, expires = 0, timer = null, highlight = null, focused = null, lastSent = 0;
// A binding is good for one pick. The app arms the next one within a moment,
// and a click that lands in between is held here and applied under that
// binding rather than marked on the page and lost by the app.
var consumed = false, pending = null;
var blockers = [], observer = null, announcement = null, armedStyle = null, label = null;
var marks = [], lastBinding = null, candidates = null;
var tags = 'h1,h2,h3,h4,h5,h6,p,span,div,section,main,article,header,footer,aside,nav,button,a,img,figure,figcaption,li,ul,ol';
var allowed = new Set(tags.split(','));
function active() { return binding !== null && Date.now() < expires; }
function send(type, extra) {
  if (!binding) return;
  window.parent.postMessage(Object.assign({type: type, version: 1, id: binding.id, nonce: binding.nonce}, extra || {}), parentOrigin);
}
function arm() {
  document.documentElement.setAttribute('data-website-selection', 'armed');
  if (!armedStyle) {
    armedStyle = document.createElement('style');
    armedStyle.setAttribute('data-selection-overlay', '');
    armedStyle.textContent = 'html[data-website-selection="armed"], html[data-website-selection="armed"] * { cursor: crosshair !important; }';
    document.documentElement.appendChild(armedStyle);
  }
}
function disarm() {
  document.documentElement.removeAttribute('data-website-selection');
  if (armedStyle) armedStyle.remove();
  armedStyle = null;
}
function unbind() {
  binding = null; expires = 0; focused = null; clearTimeout(timer);
  consumed = false;
  candidates = null;
  if (highlight) highlight.remove();
  highlight = null;
  if (label) label.remove();
  label = null;
  blockers.forEach(function(node) { node.remove(); }); blockers = [];
  if (observer) observer.disconnect(); observer = null;
  if (announcement) announcement.remove(); announcement = null;
  disarm();
}
function inDocument(node) {
  for (var current = node; current; current = current.parentElement) { if (current === document.body) return true; }
  return false;
}
function layoutMarks() {
  marks.forEach(function(mark, index) {
    if (!inDocument(mark.node)) { mark.box.style.display = 'none'; return; }
    var rect = mark.node.getBoundingClientRect();
    mark.box.style.display = '';
    mark.box.style.left = rect.x + 'px'; mark.box.style.top = rect.y + 'px';
    mark.box.style.width = rect.width + 'px'; mark.box.style.height = rect.height + 'px';
    mark.box.textContent = String(index + 1);
  });
}
function addMark(id, node) {
  var box = document.createElement('div');
  box.setAttribute('data-selection-overlay', '');
  box.setAttribute('data-selection-mark', '');
  box.setAttribute('data-selection-id', id);
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px dashed #8a3e22;box-sizing:border-box;background:linear-gradient(#8a3e22,#8a3e22) 0 0/22px 22px no-repeat;color:#fff;font:700 13px/22px system-ui;text-align:left;padding:0 0 0 7px;';
  document.documentElement.appendChild(box);
  marks.push({id: id, node: node, box: box});
  layoutMarks();
}
function removeMark(id) {
  var index = -1;
  for (var i = 0; i < marks.length; i++) { if (marks[i].id === id) { index = i; break; } }
  if (index < 0) return;
  marks[index].box.remove();
  marks.splice(index, 1);
  layoutMarks();
}
function clearMarks() {
  marks.forEach(function(mark) { mark.box.remove(); });
  marks = [];
}
function disable() { pending = null; unbind(); clearMarks(); }
// A provisional view of text and pictures the owner's helper has already
// changed in the source while the build that will really carry them is still
// running. Only whole text nodes and a few text attributes that equal the
// built text are touched, and the source of an img that loads a changed
// picture, never markup; the app clears it, or the reload onto the finished
// build replaces the page. A patch is measured from one build, so it is
// accepted only by a page of that build (builtCommit).
var patchKey = null, patchText = new Map(), patchImages = new Map(), patchedNodes = new Map(), patchedAttrs = new Map(), patchedImages = new Map();
// Each accepted patch is one run; clearing ends it, so a start or a timer
// left over from an earlier run finds itself out of date and does nothing.
var patchRun = 0, patchObserver = null, patchTimer = null, patchReported = -1, patchQueue = [];
var patchAttrs = ['alt', 'title', 'aria-label', 'placeholder'];
var patchSkip = /^(script|style|noscript|template|textarea|select|option|iframe|object|embed)$/;
function squash(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
function patchFor(value) {
  var entries = patchText.get(value);
  if (!entries) return null;
  var lang = String(document.documentElement.getAttribute('lang') || '').toLowerCase();
  for (var i = 0; i < entries.length; i++) {
    var locale = entries[i].locale;
    if (locale && lang && lang !== locale && lang.indexOf(locale + '-') !== 0) continue;
    return entries[i].to;
  }
  return null;
}
function patchExcluded(node) {
  return patchSkip.test(node.tagName.toLowerCase()) || node.hasAttribute('data-selection-overlay') || node.hasAttribute('data-private')
    || (node.hasAttribute('contenteditable') && node.getAttribute('contenteditable') !== 'false');
}
// The site address an img loads: its own path, or the one next/image wraps.
function imagePath(value) {
  if (typeof value !== 'string' || value.charAt(0) !== '/' || value.charAt(1) === '/') return null;
  try {
    var url = new URL(value, 'https://site.invalid');
    if (url.pathname !== '/_next/image') return decodeURI(url.pathname);
    var inner = url.searchParams.get('url');
    return inner && inner.charAt(0) === '/' && inner.charAt(1) !== '/' ? inner.split('?')[0] : null;
  } catch (error) { return null; }
}
function patchImage(node) {
  var current = node.getAttribute('src'), done = patchedImages.get(node);
  if (done && done.value === current) {
    // The built srcset would win over the new picture if the page put it back.
    if (node.hasAttribute('srcset')) { done.srcset = node.getAttribute('srcset'); node.removeAttribute('srcset'); }
    return;
  }
  var to = patchImages.get(imagePath(current));
  if (!to) { if (done) patchedImages.delete(node); return; }
  patchedImages.set(node, {src: current, srcset: node.getAttribute('srcset'), value: to});
  node.removeAttribute('srcset');
  node.setAttribute('src', to);
}
function patchNode(node) {
  if (node.nodeType === 3) {
    var raw = String(node.textContent || ''), done = patchedNodes.get(node);
    if (done && done.value === raw) return;
    var to = patchFor(squash(raw));
    if (to === null) { if (done) patchedNodes.delete(node); return; }
    var value = raw.match(/^\s*/)[0] + to + raw.match(/\s*$/)[0];
    patchedNodes.set(node, {original: raw, value: value});
    node.textContent = value;
    return;
  }
  if (node.nodeType !== 1 || patchExcluded(node)) return;
  if (patchImages.size && node.tagName.toLowerCase() === 'img') patchImage(node);
  for (var i = 0; i < patchAttrs.length; i++) {
    var name = patchAttrs[i], current = node.getAttribute(name);
    if (current === null) continue;
    var seen = patchedAttrs.get(node) || {};
    if (seen[name] && seen[name].value === current) continue;
    var next = patchFor(squash(current));
    if (next === null) { delete seen[name]; continue; }
    seen[name] = {original: current, value: next};
    patchedAttrs.set(node, seen);
    node.setAttribute(name, next);
  }
  for (var child = 0; child < node.childNodes.length; child++) patchNode(node.childNodes[child]);
}
// A node the page changed or added: patched only when nothing above it is
// off limits, which the walk from the body checks on its way down.
function patchChanged(node) {
  var start = node.nodeType === 1 ? node : node.parentElement, reached = false;
  for (var current = start; current; current = current.parentElement) {
    if (current === document.body) { reached = true; break; }
    if (patchExcluded(current)) return;
  }
  if (reached) patchNode(node);
}
function patchCount() {
  var count = 0;
  patchedNodes.forEach(function(record, node) {
    if (!inDocument(node.parentElement)) { patchedNodes.delete(node); return; }
    if (node.textContent === record.value) count++;
  });
  patchedAttrs.forEach(function(seen, node) {
    if (!inDocument(node)) { patchedAttrs.delete(node); return; }
    Object.keys(seen).forEach(function(name) { if (node.getAttribute(name) === seen[name].value) count++; });
  });
  patchedImages.forEach(function(record, node) {
    if (!inDocument(node)) { patchedImages.delete(node); return; }
    if (node.getAttribute('src') === record.value) count++;
  });
  return count;
}
function applyPatch(run, everything) {
  if (run !== patchRun || !document.body) return;
  patchTimer = null;
  var queue = patchQueue; patchQueue = [];
  if (everything || queue.length > 500) patchNode(document.body);
  else queue.forEach(patchChanged);
  var count = patchCount();
  if (count === patchReported || (count === 0 && patchReported < 0)) return;
  patchReported = count;
  window.parent.postMessage({type: 'website-preview:applied', version: 1, key: patchKey, count: count}, parentOrigin);
}
function startPatch(run) {
  if (run !== patchRun) return;
  if (typeof MutationObserver !== 'undefined') {
    patchObserver = new MutationObserver(function(records) {
      records.forEach(function(record) {
        if (record.type === 'characterData' || record.type === 'attributes') patchQueue.push(record.target);
        else Array.from(record.addedNodes || []).forEach(function(node) { patchQueue.push(node); });
      });
      if (patchQueue.length && patchTimer === null) patchTimer = setTimeout(function() { applyPatch(run, false); }, 60);
    });
    var watch = {childList: true, subtree: true, characterData: true};
    if (patchImages.size) { watch.attributes = true; watch.attributeFilter = ['src', 'srcset']; }
    patchObserver.observe(document.body, watch);
  }
  applyPatch(run, true);
}
function clearPatch() {
  if (patchObserver) patchObserver.disconnect();
  patchObserver = null;
  clearTimeout(patchTimer); patchTimer = null; patchRun++;
  patchKey = null; patchText = new Map(); patchImages = new Map(); patchReported = -1; patchQueue = [];
  patchedNodes.forEach(function(record, node) { if (node.textContent === record.value) node.textContent = record.original; });
  patchedAttrs.forEach(function(seen, node) {
    Object.keys(seen).forEach(function(name) { if (node.getAttribute(name) === seen[name].value) node.setAttribute(name, seen[name].original); });
  });
  patchedImages.forEach(function(record, node) {
    if (node.getAttribute('src') !== record.value) return;
    node.setAttribute('src', record.src);
    if (record.srcset !== null) node.setAttribute('srcset', record.srcset);
  });
  patchedNodes = new Map(); patchedAttrs = new Map(); patchedImages = new Map();
}
function boundedPatchText(value) { return typeof value === 'string' && value.length > 0 && value.length <= 2000; }
function previewMessage(data) {
  if (data.version !== 1) return;
  var keys = Object.keys(data).sort().join(',');
  if (data.type === 'website-preview:clear') { if (keys === 'type,version') clearPatch(); return; }
  if (data.type !== 'website-preview:patch' || (keys !== 'base,key,text,type,version' && keys !== 'base,images,key,text,type,version')
    || !/^[0-9a-f]{40}$/.test(data.key) || !builtCommit || data.base !== builtCommit
    || !Array.isArray(data.text) || data.text.length > 200) return;
  // A picture arrives as its own bytes, so the page never fetches anything
  // on the app's say-so.
  var sent = data.images === undefined ? [] : data.images, pictures = new Map();
  if (!Array.isArray(sent) || sent.length > 8 || data.text.length + sent.length < 1) return;
  for (var p = 0; p < sent.length; p++) {
    var image = sent[p];
    if (!image || typeof image !== 'object' || Array.isArray(image) || Object.keys(image).sort().join(',') !== 'from,src'
      || typeof image.from !== 'string' || image.from.length > 500 || imagePath(image.from) !== image.from
      || typeof image.src !== 'string' || image.src.length > 6000000 || !/^data:image\/(jpeg|png|webp|avif|gif);base64,[A-Za-z0-9+\/]+=*$/.test(image.src)) return;
    pictures.set(image.from, image.src);
  }
  var entries = new Map();
  for (var i = 0; i < data.text.length; i++) {
    var entry = data.text[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    var entryKeys = Object.keys(entry).sort().join(',');
    if ((entryKeys !== 'from,to' && entryKeys !== 'from,locale,to') || !boundedPatchText(entry.from) || !boundedPatchText(entry.to)
      || (entry.locale !== undefined && !/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(entry.locale))) return;
    var from = squash(entry.from);
    if (!entries.has(from)) entries.set(from, []);
    entries.get(from).push({to: entry.to, locale: entry.locale || null});
  }
  clearPatch();
  var run = patchRun;
  patchKey = data.key; patchText = entries; patchImages = pictures;
  // Changing server-rendered text while the page is still hydrating makes
  // React throw the subtree away and render it again; wait until it has loaded
  // and had a moment to settle.
  var begin = function() { setTimeout(function() { startPatch(run); }, 300); };
  if (document.readyState && document.readyState !== 'complete') window.addEventListener('load', begin, {once: true});
  else begin();
}
window.addEventListener('message', function(event) {
  if (event.source !== window.parent || event.origin !== parentOrigin) return;
  var data = event.data;
  if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.type === 'string' && data.type.indexOf('website-preview:') === 0) {
    previewMessage(data);
    return;
  }
  var isUnmark = !!data && typeof data === 'object' && data.type === 'website-selection:unmark';
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).sort().join(',') !== (isUnmark ? 'id,nonce,target,type,version' : 'id,nonce,type,version')
    || data.version !== 1 || !/^sel_[a-f0-9]{32}$/.test(data.id)
    || typeof data.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.nonce)
    || (isUnmark && !/^sel_[a-f0-9]{32}$/.test(data.target))) return;
  // Marks outlive the binding (Browse mode unbinds, chips stay), so the parent
  // may still manage them with the credentials of the last binding it held —
  // including the disable that follows the frame's own Escape, which unbound us.
  var known = (active() && data.id === binding.id && data.nonce === binding.nonce)
    || (lastBinding !== null && data.id === lastBinding.id && data.nonce === lastBinding.nonce);
  if (data.type === 'website-selection:disable') {
    if (known) disable();
    return;
  }
  if (data.type === 'website-selection:clear') {
    if (known) clearMarks();
    return;
  }
  if (isUnmark) {
    if (known) removeMark(data.target);
    return;
  }
  if (data.type !== 'website-selection:init') return;
  unbind();
  binding = {id: data.id, nonce: data.nonce};
  lastBinding = binding;
  lastSent = 0;
  consumed = false;
  expires = Date.now() + 10 * 60 * 1000;
  timer = setTimeout(disable, 10 * 60 * 1000);
  blockEmbeds();
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(function(records) {
      invalidateCandidates();
      if (records.some(function(record) { return Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).some(function(node) {
        return node.nodeType === 1 && (/^(IFRAME|OBJECT|EMBED)$/.test(node.tagName) || node.querySelector('iframe,object,embed'));
      }); })) blockEmbeds();
    });
    observer.observe(document.body, {childList: true, subtree: true});
  }
  arm();
  send('website-selection:ready');
  if (pending) { var held = pending; pending = null; select(held.target, held.event); }
}, false);
function suppress(event) {
  if (!active()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}
['pointerdown', 'click', 'auxclick', 'dblclick', 'submit'].forEach(function(type) {
  window.addEventListener(type, suppress, {capture: true, passive: false});
});
function excluded(node) {
  if (!node || node.nodeType !== 1) return true;
  var tag = node.tagName.toLowerCase();
  if (/^(script|style|noscript|template|form|input|textarea|select|option)$/.test(tag)
    || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true'
    || node.hasAttribute('data-private') || node.hasAttribute('data-selection-overlay')
    || (node.hasAttribute('contenteditable') && node.getAttribute('contenteditable') !== 'false')) return true;
  var css = getComputedStyle(node);
  return css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0;
}
function visibleText(node, maximum) {
  var result = '', visited = 0;
  function visit(current) {
    if (++visited > 2000 || result.length >= maximum) return;
    if (current.nodeType === 3) { result += String(current.textContent || '').slice(0, maximum - result.length); return; }
    if (excluded(current) || /^(iframe|object|embed)$/.test(current.tagName.toLowerCase())) return;
    if (current.tagName.toLowerCase() === 'img') result += String(current.getAttribute('alt') || '').slice(0, maximum - result.length);
    for (var child of current.childNodes) visit(child);
    if (result.length < maximum) result += ' ';
  }
  visit(node);
  return result.replace(/\s+/g, ' ').trim().slice(0, maximum);
}
function describe(target) {
  var node = target && target.nodeType === 1 ? target : target && target.parentElement;
  var chosen = null, parts = [], reachedBody = false;
  for (var current = node; current; current = current.parentElement) {
    var tag = current.tagName.toLowerCase();
    if (/^(iframe|object|embed)$/.test(tag) || current.hasAttribute('data-selection-blocked')) throw new Error('unsupported_embedded_content');
    if (excluded(current)) throw new Error('unsupported_sensitive_content');
    if (!chosen && allowed.has(tag)) chosen = current;
    if (current === document.body) { reachedBody = true; break; }
  }
  if (!chosen || !reachedBody) throw new Error('unsupported_element');
  for (var current = chosen; current !== document.body; current = current.parentElement) {
    var tag = current.tagName.toLowerCase();
    if (!allowed.has(tag) || !current.parentElement || parts.length >= 23) throw new Error('unsupported_element');
    var siblings = Array.from(current.parentElement.children).filter(function(sibling) { return sibling.tagName === current.tagName; });
    var index = siblings.indexOf(current) + 1;
    if (index > 9999) throw new Error('unsupported_element');
    parts.unshift(tag + ':nth-of-type(' + index + ')');
  }
  var rect = chosen.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || rect.x >= window.innerWidth || rect.y >= window.innerHeight
    || rect.x + rect.width <= 0 || rect.y + rect.height <= 0) throw new Error('element_not_visible');
  if (window.innerWidth > 1920 || window.innerHeight > 1080) throw new Error('viewport_too_large');
  return {node: chosen, context: {version: 1, pagePath: window.location.pathname,
    viewport: {width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY},
    element: {tag: chosen.tagName.toLowerCase(), locator: 'body > ' + parts.join(' > '), text: visibleText(chosen, 500),
      bounds: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}},
    surroundingText: visibleText(chosen.parentElement, 1500)}};
}
function invalidateCandidates() { candidates = null; }
// describe() walks ancestors with getComputedStyle/getBoundingClientRect, so scanning
// the whole document on every Tab press freezes the page; scan once per binding and
// drop the list when the DOM or the viewport changes underneath it.
function candidateList() {
  if (candidates) return candidates;
  candidates = [];
  var nodes = document.querySelectorAll(tags);
  for (var i = 0; i < nodes.length && candidates.length < 1000; i++) {
    try { if (describe(nodes[i]).node === nodes[i]) candidates.push(nodes[i]); } catch (_) {}
  }
  return candidates;
}
function outline(selected) {
  if (!highlight) {
    highlight = document.createElement('div');
    highlight.setAttribute('data-selection-overlay', '');
    highlight.setAttribute('aria-hidden', 'true');
    document.documentElement.appendChild(highlight);
  }
  var rect = selected.context.element.bounds;
  highlight.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #a9502e;box-sizing:border-box;background:transparent;';
  highlight.style.left = rect.x + 'px'; highlight.style.top = rect.y + 'px';
  highlight.style.width = rect.width + 'px'; highlight.style.height = rect.height + 'px';
  highlight.style.display = '';
  if (!label) {
    label = document.createElement('div');
    label.setAttribute('data-selection-overlay', '');
    label.setAttribute('data-selection-label', '');
    label.setAttribute('aria-hidden', 'true');
    document.documentElement.appendChild(label);
  }
  var text = selected.context.element.text, shown = text.length > 40 ? text.slice(0, 40) + '…' : text;
  label.textContent = shown ? selected.context.element.tag + ' · ' + shown : selected.context.element.tag;
  label.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#a9502e;color:#fff;font-size:12px;line-height:1.4;padding:2px 8px;border-radius:999px;font-family:system-ui;white-space:nowrap;';
  label.style.top = (rect.y < 24 ? rect.y + rect.height + 4 : rect.y - 22) + 'px';
  label.style.left = Math.max(0, Math.min(rect.x, window.innerWidth - 8)) + 'px';
  label.style.display = '';
  if (!announcement) {
    announcement = document.createElement('div');
    announcement.setAttribute('data-selection-overlay', '');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);';
    document.documentElement.appendChild(announcement);
  }
  if (focused !== selected.node) announcement.textContent = selected.context.element.tag + ': ' + selected.context.element.text;
  focused = selected.node;
}
function blockEmbeds() {
  blockers.forEach(function(node) { node.remove(); }); blockers = [];
  if (!active()) return;
  Array.from(document.querySelectorAll('iframe,object,embed')).slice(0, 100).forEach(function(frame) {
    var rect = frame.getBoundingClientRect();
    if (excluded(frame) || rect.width <= 0 || rect.height <= 0) return;
    var blocker = document.createElement('div');
    blocker.setAttribute('data-selection-blocked', 'embedded');
    blocker.setAttribute('data-selection-overlay', '');
    blocker.setAttribute('role', 'button');
    blocker.setAttribute('aria-label', 'Embedded content cannot be selected');
    blocker.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:auto;background:transparent;';
    blocker.style.left = rect.x + 'px'; blocker.style.top = rect.y + 'px';
    blocker.style.width = rect.width + 'px'; blocker.style.height = rect.height + 'px';
    document.documentElement.appendChild(blocker); blockers.push(blocker);
  });
}
['scroll', 'resize'].forEach(function(type) {
  window.addEventListener(type, function() {
    if (type === 'resize') invalidateCandidates();
    if (marks.length) layoutMarks();
    if (!active()) return;
    blockEmbeds();
    if (focused) { try { outline(describe(focused)); } catch (_) { if (highlight) highlight.style.display = 'none'; if (label) label.style.display = 'none'; } }
  }, {capture: true, passive: true});
});
// A crossfade stacks its frames and the transparent one on top takes the click;
// what the owner pointed at is the visible frame beneath it. Only a target that
// is itself transparent falls through, and only to elements that are not.
function describeAt(target, event) {
  try { return describe(target); } catch (error) {
    var css = target && target.nodeType === 1 ? getComputedStyle(target) : null;
    if (!css || (Number(css.opacity) !== 0 && css.visibility === 'visible') || !event
      || typeof document.elementsFromPoint !== 'function') throw error;
    var stack = document.elementsFromPoint(event.clientX, event.clientY);
    for (var i = 0; i < stack.length; i++) {
      var below = stack[i];
      if (below === target || below.hasAttribute('data-selection-overlay')) continue;
      var belowCss = getComputedStyle(below);
      if (Number(belowCss.opacity) === 0 || belowCss.visibility !== 'visible') continue;
      try { return describe(below); } catch (_) { throw error; }
    }
    throw error;
  }
}
function select(target, event) {
  if (!active() || Date.now() - lastSent < 150) return;
  lastSent = Date.now();
  try {
    var selected = describeAt(target, event);
    if (marks.length >= 5) { send('website-selection:error', {error: 'selection_limit'}); return; }
    // A refused click is reported at once; a good one made while the app is
    // still arming the next binding waits for it (see the init handler).
    if (consumed) { pending = {target: target, event: event}; return; }
    outline(selected);
    addMark(binding.id, selected.node);
    consumed = true;
    send('website-selection:selected', {context: selected.context});
  } catch (error) {
    var code = error && error.message;
    send('website-selection:error', {error: ['unsupported_embedded_content', 'unsupported_sensitive_content',
      'unsupported_element', 'element_not_visible', 'viewport_too_large', 'selection_limit'].includes(code) ? code : 'selection_unavailable'});
  }
}
window.addEventListener('pointermove', function(event) {
  if (!active()) return;
  try { outline(describeAt(event.target, event)); } catch (_) { if (highlight) highlight.style.display = 'none'; if (label) label.style.display = 'none'; }
}, {capture: true, passive: true});
window.addEventListener('pointerup', function(event) { if (active()) { suppress(event); select(event.target, event); } }, {capture: true, passive: false});
window.addEventListener('keydown', function(event) {
  if (!active()) return;
  if (event.key === 'Escape') { suppress(event); send('website-selection:disabled'); unbind(); return; }
  if (event.key === 'Enter' || event.key === ' ') { suppress(event); select(focused || event.target); return; }
  if (event.key !== 'Tab') return;
  suppress(event);
  for (var attempt = 0; attempt < 2; attempt++) {
    var list = candidateList();
    if (!list.length) break;
    var index = list.indexOf(focused), next = index < 0 ? (event.shiftKey ? list.length - 1 : 0)
      : (index + (event.shiftKey ? -1 : 1) + list.length) % list.length;
    // A cached candidate can have scrolled out of view since the scan; rebuild once.
    try { outline(describe(list[next])); return; } catch (_) { invalidateCandidates(); }
  }
  send('website-selection:error', {error: 'no_selectable_element'});
}, {capture: true, passive: false});
`;
