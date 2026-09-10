export function selectionBridgeScript(parentOrigin: string): string {
  const origin = new URL(parentOrigin);
  if (origin.protocol !== "https:" || origin.origin !== parentOrigin) throw new Error("invalid_selection_origin");
  return `(function(parentOrigin){${BRIDGE}})(${JSON.stringify(parentOrigin).replace(/</g, "\\u003c")});`;
}

const BRIDGE = String.raw`
if (window.parent === window) return;
var binding = null, expires = 0, timer = null, highlight = null, focused = null, lastSent = 0;
var blockers = [], observer = null, announcement = null;
var tags = 'h1,h2,h3,h4,h5,h6,p,span,div,section,main,article,header,footer,aside,nav,button,a,img,figure,figcaption,li,ul,ol';
var allowed = new Set(tags.split(','));
function active() { return binding !== null && Date.now() < expires; }
function send(type, extra) {
  if (!binding) return;
  window.parent.postMessage(Object.assign({type: type, version: 1, id: binding.id, nonce: binding.nonce}, extra || {}), parentOrigin);
}
function disable() {
  binding = null; expires = 0; focused = null; clearTimeout(timer);
  if (highlight) highlight.remove();
  highlight = null;
  blockers.forEach(function(node) { node.remove(); }); blockers = [];
  if (observer) observer.disconnect(); observer = null;
  if (announcement) announcement.remove(); announcement = null;
}
window.addEventListener('message', function(event) {
  if (event.source !== window.parent || event.origin !== parentOrigin) return;
  var data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).sort().join(',') !== 'id,nonce,type,version'
    || data.version !== 1 || !/^sel_[a-f0-9]{32}$/.test(data.id)
    || typeof data.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.nonce)) return;
  if (data.type === 'website-selection:disable') {
    if (active() && data.id === binding.id && data.nonce === binding.nonce) disable();
    return;
  }
  if (data.type !== 'website-selection:init') return;
  disable();
  binding = {id: data.id, nonce: data.nonce};
  lastSent = 0;
  expires = Date.now() + 10 * 60 * 1000;
  timer = setTimeout(disable, 10 * 60 * 1000);
  blockEmbeds();
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(function(records) {
      if (records.some(function(record) { return Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).some(function(node) {
        return node.nodeType === 1 && (/^(IFRAME|OBJECT|EMBED)$/.test(node.tagName) || node.querySelector('iframe,object,embed'));
      }); })) blockEmbeds();
    });
    observer.observe(document.body, {childList: true, subtree: true});
  }
  send('website-selection:ready');
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
function outline(selected) {
  if (!highlight) {
    highlight = document.createElement('div');
    highlight.setAttribute('data-selection-overlay', '');
    highlight.setAttribute('aria-hidden', 'true');
    document.documentElement.appendChild(highlight);
  }
  var rect = selected.context.element.bounds;
  highlight.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #125e56;box-sizing:border-box;background:transparent;';
  highlight.style.left = rect.x + 'px'; highlight.style.top = rect.y + 'px';
  highlight.style.width = rect.width + 'px'; highlight.style.height = rect.height + 'px';
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
    if (!active()) return;
    blockEmbeds();
    if (focused) { try { outline(describe(focused)); } catch (_) { if (highlight) highlight.style.display = 'none'; } }
  }, {capture: true, passive: true});
});
function select(target) {
  if (!active() || Date.now() - lastSent < 150) return;
  lastSent = Date.now();
  try {
    var selected = describe(target);
    outline(selected);
    send('website-selection:selected', {context: selected.context});
  } catch (error) {
    var code = error && error.message;
    send('website-selection:error', {error: ['unsupported_embedded_content', 'unsupported_sensitive_content',
      'unsupported_element', 'element_not_visible', 'viewport_too_large'].includes(code) ? code : 'selection_unavailable'});
  }
}
window.addEventListener('pointermove', function(event) {
  if (!active()) return;
  try { outline(describe(event.target)); } catch (_) { if (highlight) highlight.style.display = 'none'; }
}, {capture: true, passive: true});
window.addEventListener('pointerup', function(event) { if (active()) { suppress(event); select(event.target); } }, {capture: true, passive: false});
window.addEventListener('keydown', function(event) {
  if (!active()) return;
  if (event.key === 'Escape') { suppress(event); send('website-selection:disabled'); disable(); return; }
  if (event.key === 'Enter' || event.key === ' ') { suppress(event); select(focused || event.target); return; }
  if (event.key !== 'Tab') return;
  suppress(event);
  var candidates = Array.from(document.querySelectorAll(tags)).slice(0, 5000).filter(function(node) {
    try { return describe(node).node === node; } catch (_) { return false; }
  });
  if (!candidates.length) { send('website-selection:error', {error: 'no_selectable_element'}); return; }
  var index = candidates.indexOf(focused), next = index < 0 ? (event.shiftKey ? candidates.length - 1 : 0)
    : (index + (event.shiftKey ? -1 : 1) + candidates.length) % candidates.length;
  outline(describe(candidates[next]));
}, {capture: true, passive: false});
`;
