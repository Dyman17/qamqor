/*
  Qamqor mockups: shared helpers. Vanilla JS, no dependencies.
  - icons (from icons.js, generated from the Phosphor and Tabler SVG files)
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

  /* ---------- icons: Phosphor (regular / fill) and Tabler (fence, route, satellite) ---------- */
  function ic(name, size, cls, weight) {
    var I = window.ICONS || {};
    var key = I["tabler/" + name] ? "tabler/" + name : (weight || "regular") + "/" + name;
    var def = I[key];
    if (!def) { console.warn("MOCK.ic: unknown icon '" + key + "'"); def = { vb: "0 0 24 24", d: "" }; }
    size = size || 24;
    var stroke = key.indexOf("tabler/") === 0;
    return '<svg class="ic' + (stroke ? " ic-stroke" : "") + (cls ? " " + cls : "") + '" width="' + size + '" height="' + size +
      '" viewBox="' + def.vb + '" aria-hidden="true" focusable="false">' + def.d + "</svg>";
  }
  function hydrateIcons(root) {
    (root || document).querySelectorAll("i[data-icon]").forEach(function (el) {
      var tmp = document.createElement("span");
      tmp.innerHTML = ic(el.getAttribute("data-icon"), parseInt(el.getAttribute("data-size") || "24", 10), el.getAttribute("class") || "", el.getAttribute("data-weight"));
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

  /* ---------- markers (7.6): small calm dot; only deviations carry extra marks ---------- */
  function markerSVG(status, o) {
    o = o || {};
    var size = o.size || 44;
    var dot;
    if (status === "danger") {
      dot = '<circle class="mk-pulse" cx="22" cy="22" r="9"/><circle class="mk-casing" cx="22" cy="22" r="8.75"/><circle class="mk-out" cx="22" cy="22" r="7"/>';
    } else if (status === "offline") {
      dot = '<circle class="mk-off" cx="22" cy="22" r="6"/>';
    } else {
      dot = '<circle class="mk-ring" cx="22" cy="22" r="6.5"/>';
    }
    var fence = (window.ICONS || {})["tabler/fence-off"];
    var plate = o.nofence && fence
      ? '<rect class="mk-plate" x="28" y="4" width="14" height="14" rx="4"/><svg x="30" y="6" width="10" height="10" viewBox="' + fence.vb + '" class="mk-plate-ic">' + fence.d + "</svg>"
      : "";
    return '<svg class="mk-svg' + (o.selected ? " is-selected" : "") + '" width="' + size + '" height="' + size + '" viewBox="0 0 44 44" aria-hidden="true" focusable="false">' +
      '<circle class="mk-sel" cx="22" cy="22" r="15"/>' + dot + plate + "</svg>";
  }
  function clusterSVG(n, size) {
    size = size || 44;
    return '<svg class="mk-svg" width="' + size + '" height="' + size + '" viewBox="0 0 44 44" aria-hidden="true" focusable="false">' +
      '<rect class="mk-cluster-box" x="4" y="8" width="36" height="28" rx="9"/><text class="mk-cluster-text" x="22" y="22.5">' + n + "</text></svg>";
  }

  /* ---------- component markup helpers ---------- */
  var BADGES = {
    online: { cls: "badge-ok", dot: true, key: "status.online" },
    inZone: { cls: "badge-zone", dot: false, key: "status.inZone" },
    outOfZone: { cls: "badge-danger", dot: true, key: "status.outOfZone" },
    noConn: { cls: "badge-offline", dot: true, key: "status.noConnection" },
    lastSeen: { cls: "badge-warning", dot: true, key: "status.lastSeen" },
    noFence: { cls: "badge-warning", icon: "fence", key: "status.noFence" }
  };
  function badgeHTML(kind, time) {
    var b = BADGES[kind];
    var p = time ? ' data-p="time=' + time + '"' : "";
    var mark = b.icon ? ic(b.icon, 16) : (b.dot ? '<span class="sdot"></span>' : "");
    return '<span class="badge ' + b.cls + '">' + mark + '<span data-i18n="' + b.key + '"' + p + "></span></span>";
  }
  var ROW_DOT = { ok: "ok", danger: "out", offline: "off", warning: "warn" };
  /* o: {status, titleKey, subKey, badge, ago, n, state} ; state: "", selected, pressed, focus, disabled */
  function rowHTML(o) {
    var st = o.state ? " is-" + o.state : "";
    return '<button type="button" class="row' + st + '"' + (o.state === "disabled" ? " disabled" : "") + (o.state === "selected" ? ' aria-pressed="true"' : "") + ">" +
      ic("check-circle", 24, "row-check", "fill") +
      '<span class="row-dot ' + ROW_DOT[o.status] + '"></span>' +
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
    var dot = o.type === "danger" ? '<span class="sdot dot-danger"></span>' : '<span class="sdot dot-offline"></span>';
    var where = o.whereKeys.map(function (k) { return '<span data-i18n="' + k + '"></span>'; }).join(" · ");
    return '<article class="alert alert-' + o.type + (o.unread ? " is-unread" : "") + (o.state ? " is-" + o.state : "") + '">' +
      '<div class="alert-head">' + dot + '<h3 class="alert-title" data-i18n="' + o.titleKey + '"></h3></div>' +
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
