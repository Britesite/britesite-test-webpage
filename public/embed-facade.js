// Click-to-load for mirrored pages' embed facades (see facadeIframes in the kit's
// mirror-core). Nothing third-party loads until the visitor presses the facade's
// button; then the original iframe is rebuilt from data-embed-attrs, pointed at
// data-embed-src, and put back where the facade stood.
(function () {
  var DEFERRED_SRC = /^(src|srcdoc|data-(?:[a-z]+-)?src)$/i;

  function load(wrap) {
    var attrs = {};
    try {
      attrs = JSON.parse(wrap.getAttribute("data-embed-attrs") || "{}");
    } catch (e) {}
    var frame = document.createElement("iframe");
    Object.keys(attrs).forEach(function (name) {
      // Never an inline event handler; and one name the DOM rejects must not
      // stop the frame the visitor asked for from loading.
      if (DEFERRED_SRC.test(name) || /^on/i.test(name)) return;
      try {
        frame.setAttribute(name, attrs[name]);
      } catch (e) {}
    });
    var provider = wrap.getAttribute("data-embed-provider");
    if ((provider === "youtube" || provider === "vimeo") && !frame.hasAttribute("allow")) {
      frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
    }
    if (!frame.hasAttribute("title")) {
      var button = wrap.querySelector("[data-embed-load]");
      if (button) frame.setAttribute("title", button.textContent);
    }
    frame.removeAttribute("loading");
    frame.setAttribute("src", wrap.getAttribute("data-embed-src"));
    wrap.replaceWith(frame);
    frame.focus();
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    var button = target && target.closest ? target.closest("[data-embed-load]") : null;
    var wrap = button ? button.closest("[data-embed-facade]") : null;
    if (!wrap) return;
    event.preventDefault();
    load(wrap);
  });
})();
