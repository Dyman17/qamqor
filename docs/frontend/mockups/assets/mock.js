/*
  Qamqor mockups: shared helpers. Vanilla JS, no dependencies.
  - icons (from icons.js, generated from the Lucide SVG files)
  - i18n (ru / en / kk) with a language switcher
  - markup helpers for components (marker, badge, herd row, alert card)
  - stub toast for screens that are built in later phases
*/
(function () {
  "use strict";

  var LANGS = ["kk", "ru", "en"];
  var lang = "ru";

  function safeGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } }

  (function initLang() {
    var q = new URLSearchParams(window.location.search).get("lang");
    var s = safeGet("qamqor-mock-lang");
    var pick = LANGS.indexOf(q) >= 0 ? q : (LANGS.indexOf(s) >= 0 ? s : "ru");
    lang = pick;
  })();

  /* ---------- icons ---------- */
  function ic(name, size, cls) {
    var body = (window.ICONS || {})[name] || "";
    if (!body) { console.warn("MOCK.ic: unknown icon '" + name + "'"); }
    size = size || 24;
    return '<svg class="ic' + (cls ? " " + cls : "") + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + body + "</svg>";
  }
  function hydrateIcons(root) {
    (root || document).querySelectorAll("i[data-icon]").forEach(function (el) {
      var tmp = document.createElement("span");
      tmp.innerHTML = ic(el.getAttribute("data-icon"), parseInt(el.getAttribute("data-size") || "24", 10), el.getAttribute("class") || "");
      el.replaceWith(tmp.firstChild);
    });
  }

  /* ---------- i18n ---------- */
  function raw(key) {
    var S = window.STRINGS;
    var v = S[lang] && S[lang][key];
    if (v === undefined) { v = S.ru[key]; }          // kk (and any gap) falls back to ru
    return v === undefined ? key : v;
  }
  function isFallback(key) {
    return lang !== "ru" && window.STRINGS[lang][key] === undefined;
  }
  function t(key, params) {
    var s = raw(key);
    if (params) { Object.keys(params).forEach(function (k) { s = s.split("{" + k + "}").join(params[k]); }); }
    return s;
  }
  function paramsOf(el) {
    var p = el.getAttribute("data-p");
    if (!p) { return null; }
    var o = {};
    p.split(";").forEach(function (kv) { var i = kv.indexOf("="); o[kv.slice(0, i)] = kv.slice(i + 1); });
    Object.keys(o).forEach(function (k) { if (o[k].indexOf("@") === 0) { o[k] = t(o[k].slice(1)); } });
    return o;
  }
  function applyI18n(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      var k = el.getAttribute("data-i18n");
      el.textContent = t(k, paramsOf(el));
      // text that fell back to Russian inside another language is marked so screen readers pronounce it correctly
      if (lang !== "ru" && isFallback(k)) { el.setAttribute("lang", "ru"); } else { el.removeAttribute("lang"); }
    });
    root.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr").split(";").forEach(function (pair) {
        var i = pair.indexOf(":");
        if (i > 0) { el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim(), paramsOf(el))); }
      });
    });
    root.querySelectorAll("[data-aria-parts]").forEach(function (el) {
      el.setAttribute("aria-label", el.getAttribute("data-aria-parts").split("|").map(function (k) { return t(k); }).join(", "));
    });
  }
  function syncSwitchers() {
    document.documentElement.setAttribute("lang", lang);
    document.querySelectorAll("[data-lang]").forEach(function (b) {
      var on = b.getAttribute("data-lang") === lang;
      if (b.type === "radio") { b.checked = on; }
      else if (b.getAttribute("role") === "menuitemradio") { b.setAttribute("aria-checked", on ? "true" : "false"); }
      else { b.setAttribute("aria-pressed", on ? "true" : "false"); }
    });
    document.querySelectorAll("[data-lang-code]").forEach(function (el) { el.textContent = lang.toUpperCase(); });
  }
  function setLang(l) {
    if (LANGS.indexOf(l) < 0) { return; }
    lang = l;
    safeSet("qamqor-mock-lang", l);
    applyI18n(document);
    syncSwitchers();
    document.title = t(document.documentElement.getAttribute("data-title") || "mk.title.index") + " · Qamqor";
    document.dispatchEvent(new CustomEvent("langchange", { detail: l }));
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-lang]");
    if (b) { setLang(b.getAttribute("data-lang")); }
  });

  /* ---------- stub toast: the live region is created once (at build / init), only its text changes ---------- */
  var toastTimer = null;
  function toastHostHTML() {
    return '<div class="mk-toast" role="status" aria-live="polite"><div class="toast"></div></div>';
  }
  function ensureBodyToast() {
    if (!document.querySelector("body > .mk-toast")) { document.body.insertAdjacentHTML("beforeend", toastHostHTML()); }
  }
  function stub(fromEl, text) {
    var scope = fromEl.closest(".app") || fromEl.closest(".device") || document.body;
    var host = scope.querySelector(":scope > .mk-toast") || document.querySelector("body > .mk-toast");
    if (!host) { return; }
    var box = host.firstElementChild;
    box.textContent = t("stub", { text: text });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.textContent = ""; }, 5000);
  }
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-stub]");
    if (!el) { return; }
    if (el.tagName === "A") { e.preventDefault(); }
    if (el.disabled || el.getAttribute("aria-disabled") === "true") { return; }
    stub(el, t(el.getAttribute("data-stub"), paramsOf(el)));
  });

  /* ---------- markers ---------- */
  var FENCE_SLASH = '<path d="M4 18v-6 M8 18V9 M12 18V9 M16 18V9 M20 18v-6" /><path d="M2 21L22 3" />';
  function markerSVG(status, o) {
    o = o || {};
    var size = o.size || 44;
    var pts = {
      circle: null,
      diamond: "22,6 38,22 22,38 6,22",
      tri: "22,7 37,35 7,35"
    };
    var kind = { ok: "circle", offline: "circle", warning: "diamond", danger: "tri" }[status] || "circle";
    function shape(cls, extra) {
      if (kind === "circle") { return '<circle cx="22" cy="22" r="14" class="' + cls + '"' + (extra || "") + "/>"; }
      return '<polygon points="' + pts[kind] + '" class="' + cls + '"' + (extra || "") + "/>";
    }

    var glyph = {
      ok: '<path class="mk-glyph" d="M15.5 22.5l5 5 8-10"/>',
      warning: '<circle class="mk-glyph-dot" cx="22" cy="22" r="3.2"/>',
      danger: '<path class="mk-glyph mk-glyph-white" d="M22 19v8"/><circle class="mk-glyph-white-dot" cx="22" cy="31.5" r="1.9"/>',
      offline: '<path class="mk-glyph" d="M15 29L29 15"/>'
    }[status];
    var ring = status === "offline" ? shape("mk-ring mk-offline-ring") : shape("mk-ring");
    var plate = o.nofence
      ? '<rect class="mk-plate" x="28" y="0.5" width="15" height="15" rx="3"/><svg x="30" y="2.5" width="11" height="11" viewBox="0 0 24 24" class="mk-plate-ic">' + FENCE_SLASH + "</svg>"
      : "";
    return '<svg class="mk-svg' + (o.selected ? " is-selected" : "") + '" width="' + size + '" height="' + size + '" viewBox="0 0 44 44" aria-hidden="true" focusable="false">' +
      shape(status === "offline" ? "mk-halo mk-halo-dash" : "mk-halo") + shape("mk-acc") + ring + shape("mk-" + status) + glyph + plate + "</svg>";
  }
  function clusterSVG(n, size) {
    size = size || 44;
    return '<svg class="mk-svg" width="' + size + '" height="' + size + '" viewBox="0 0 44 44" aria-hidden="true" focusable="false">' +
      '<rect class="mk-halo" x="4" y="4" width="36" height="36" rx="8"/><rect class="mk-ring" x="4" y="4" width="36" height="36" rx="8"/>' +
      '<rect class="mk-cluster-fill" x="5" y="5" width="34" height="34" rx="7"/><text class="mk-cluster-text" x="22" y="23">' + n + "</text></svg>";
  }

  /* ---------- component markup helpers ---------- */
  var BADGES = {
    online: { cls: "badge-ok", icon: "wifi", key: "status.online" },
    inZone: { cls: "badge-ok", icon: "circle-check", key: "status.inZone" },
    outOfZone: { cls: "badge-danger", icon: "arrow-up-right", key: "status.outOfZone" },
    noConn: { cls: "badge-offline", icon: "wifi-off", key: "status.noConnection" },
    lastSeen: { cls: "badge-warning", icon: "clock", key: "status.lastSeen" },
    noFence: { cls: "badge-warning", icon: "fence", key: "status.noFence" }
  };
  function badgeHTML(kind, time) {
    var b = BADGES[kind];
    var p = time ? ' data-p="time=' + time + '"' : "";
    return '<span class="badge ' + b.cls + '">' + ic(b.icon, 16) + '<span data-i18n="' + b.key + '"' + p + "></span></span>";
  }
  /* o: {status, titleKey, subKey, badge, ago, state} ; state: "", selected, pressed, focus, disabled */
  function rowHTML(o) {
    var st = o.state ? " is-" + o.state : "";
    return '<button type="button" class="row' + st + '"' + (o.state === "disabled" ? " disabled" : "") + (o.state === "selected" ? ' aria-pressed="true"' : "") + ">" +
      ic("check", 24, "row-check") +
      markerSVG(o.status, { size: 32, nofence: o.nofence }) +
      '<span class="row-main"><span class="row-title" data-i18n="' + (o.titleKey || "animal.sample") + '"></span>' +
      '<span class="row-sub" data-i18n="' + (o.subKey || "tag.short") + '" data-p="n=' + (o.n || 42) + '"></span></span>' +
      '<span class="row-side">' + badgeHTML(o.badge) + '<span class="row-time" data-i18n="time.ago" data-p="n=' + (o.ago || 5) + '"></span></span></button>';
  }
  function rowSkeletonHTML() {
    return '<div class="row is-skeleton" aria-hidden="true"><span class="skel skel-dot"></span>' +
      '<span class="row-main skel-lines"><span class="skel skel-l1"></span><span class="skel skel-l2"></span></span>' +
      '<span class="skel skel-badge"></span></div>';
  }
  /* o: {type: danger|offline, unread, titleKey, whereKeys:[...], ago, state} */
  function alertHTML(o) {
    var icon = o.type === "danger" ? "triangle-exclamation-point" : "wifi-off";
    var where = o.whereKeys.map(function (k) { return '<span data-i18n="' + k + '"></span>'; }).join(" · ");
    return '<article class="alert alert-' + o.type + (o.unread ? " is-unread" : "") + (o.state ? " is-" + o.state : "") + '">' +
      '<div class="alert-head">' + ic(icon, 24, "alert-ic") + '<div><h3 class="alert-title" data-i18n="' + o.titleKey + '"></h3></div></div>' +
      '<p class="alert-text">' + where + '</p><p class="alert-time"><span data-i18n="time.ago" data-p="n=' + (o.ago || 5) + '"></span></p>' +
      '<div class="alert-actions"><button type="button" class="btn btn-tertiary" data-stub="alert.show" data-i18n="alert.show"></button>' +
      '<button type="button" class="btn btn-tertiary" data-stub="alert.profile" data-i18n="alert.profile"></button>' +
      (o.unread ? '<button type="button" class="btn btn-tertiary" data-stub="alert.markRead" data-i18n="alert.markRead"></button>' : "") +
      "</div></article>";
  }

  /* ---------- fit helper for scaled frames ---------- */
  function fitScale(avail, w) { return Math.min(1, avail / w); }

  window.MOCK = {
    LANGS: LANGS,
    ic: ic, hydrateIcons: hydrateIcons,
    t: t, applyI18n: applyI18n, setLang: setLang, syncSwitchers: syncSwitchers,
    getLang: function () { return lang; },
    stub: stub,
    markerSVG: markerSVG, clusterSVG: clusterSVG,
    badgeHTML: badgeHTML, rowHTML: rowHTML, rowSkeletonHTML: rowSkeletonHTML, alertHTML: alertHTML,
    fitScale: fitScale, toastHostHTML: toastHostHTML, paramsOf: paramsOf, isFallback: isFallback
  };

  /* init once the page defines its content; pages call MOCK.init() after building DOM */
  /* number of product strings in the current kk object that are not final (drafts or ru fallback) */
  function kkNoteCount() {
    return Object.keys(window.STRINGS.ru).filter(function (k) { return k.indexOf("mk.") !== 0; }).length;
  }
  window.MOCK.init = function () {
    ensureBodyToast();
    document.querySelectorAll('[data-i18n="mk.note.kk"]').forEach(function (el) { el.setAttribute("data-p", "n=" + kkNoteCount()); });
    hydrateIcons(document);
    applyI18n(document);
    syncSwitchers();
    document.title = t(document.documentElement.getAttribute("data-title") || "mk.title.index") + " · Qamqor";
  };
})();
