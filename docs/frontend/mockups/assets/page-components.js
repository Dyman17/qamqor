/* Page script for components.html: builds every component with its states from the shared helpers. */
(function () {
  "use strict";
  var M = window.MOCK;
  var $ = function (id) { return document.getElementById(id); };

  function cell(cap, inner, cls) {
    return '<div class="mk-cell' + (cls ? " " + cls : "") + '"><span class="cap">' + cap + "</span>" + inner + "</div>";
  }
  function fill(id, html) { $(id).innerHTML = html; }
  var STATES = [
    { name: "default", cls: "", disabled: false },
    { name: "pressed", cls: "is-pressed", disabled: false },
    { name: "focus", cls: "is-focus", disabled: false },
    { name: "disabled", cls: "is-disabled", disabled: true }
  ];
  function attrs(cls, st, extra) {
    return 'class="' + cls + (st.cls ? " " + st.cls : "") + '"' + (st.disabled ? " disabled" : "") + (extra ? " " + extra : "");
  }

  /* ---------- buttons ---------- */
  (function () {
    var types = [["btn-primary", "action.done"], ["btn-secondary", "action.cancel"], ["btn-tertiary", "action.retry"], ["btn-danger", "action.apply"]];
    var out = "";
    types.forEach(function (ty) {
      out += '<div class="mk-card row-wrap-demo"><span class="cap t-caption cap-strong basis-full">' + ty[0] + "</span>";
      STATES.concat([{ name: "loading", cls: "is-loading", disabled: false }]).forEach(function (st) {
        var loading = st.name === "loading";
        out += cell("state=" + st.name, "<button type=\"button\" " + attrs("btn " + ty[0], st, loading ? 'aria-busy="true"' : "") + '><span class="btn-text" data-i18n="' + ty[1] + '"></span>' + (loading ? M.ic("loader", 24, "spin") : "") + "</button>");
      });
      out += "</div>";
    });
    out += '<div class="mk-card mk-w-320"><span class="cap t-caption cap-strong">320: long labels wrap between words, no clipping</span>' +
      '<div class="stack-2 mt-2"><button type="button" class="btn btn-primary btn-block" data-i18n="action.saveApply"></button>' +
      '<button type="button" class="btn btn-secondary btn-block" data-i18n="action.moveHerd"></button></div></div>';
    fill("btn-grid", out);
  })();

  /* ---------- icon button + FAB ---------- */
  (function () {
    var out = "";
    STATES.forEach(function (st) {
      out += cell("icon-button · " + st.name, "<button type=\"button\" " + attrs("icon-btn is-surface", st, 'data-i18n-attr="aria-label:settings.title"') + ">" + M.ic("settings", 24) + "</button>");
    });
    STATES.forEach(function (st) {
      out += cell("FAB 52 · " + st.name, '<div class="mk-on-map pad-3"><button type="button" ' + attrs("fab", st, 'data-i18n-attr="aria-label:map.locate"') + ">" + M.ic("locate-fixed", 24) + "</button></div>");
    });
    out += cell("FAB · selected (aria-pressed)", '<div class="mk-on-map pad-3"><button type="button" class="fab" aria-pressed="true" data-i18n-attr="aria-label:map.layers">' + M.ic("layers", 24) + "</button></div>");
    fill("fab-grid", out);
  })();

  /* ---------- inputs ---------- */
  (function () {
    function field(id, labelKey, cls, value, hint) {
      var err = cls === "is-error";
      return '<div class="field mk-w-320"><label class="field-label" for="' + id + '" data-i18n="' + labelKey + '"></label>' +
        '<div class="input ' + cls + '"><input id="' + id + '" type="text"' + (value ? ' value="" data-i18n-attr="value:' + value + '"' : "") + (cls === "is-disabled" ? " disabled" : "") + (err ? ' aria-invalid="true" aria-describedby="' + id + '-e"' : "") + "></div>" +
        (err ? '<p class="field-error" id="' + id + '-e">' + M.ic("circle-exclamation-point", 16) + '<span data-i18n="field.error"></span></p>' : "") +
        (hint ? '<p class="field-hint" data-i18n="field.hint"></p>' : "") + "</div>";
    }
    var out = "";
    out += cell("default (+ hint)", field("f1", "field.email", "", null, true));
    out += cell("focus", field("f2", "field.email", "is-focus", "field.hint"));
    out += cell("filled", field("f3", "field.email", "", "field.hint"));
    out += cell("error", field("f4", "field.password", "is-error", "field.dash"));
    out += cell("disabled", field("f5", "field.email", "is-disabled", "field.dash"));
    out += cell("password + show", '<div class="field mk-w-320"><label class="field-label" for="f6" data-i18n="field.password"></label><div class="input"><input id="f6" type="password" value="demo-password-not-real"><button type="button" class="btn btn-tertiary btn-inline" data-act="toggle-pw" data-i18n="field.show"></button></div></div>');
    out += cell("search", '<div class="field mk-w-320"><label class="field-label" for="f7" data-i18n="field.search"></label><div class="input">' + M.ic("search", 24) + '<input id="f7" type="search" value="" data-i18n-attr="value:field.searchValue"><button type="button" class="icon-btn icon-btn-sm" data-act="clear-search" data-i18n-attr="aria-label:field.clear">' + M.ic("x", 24) + "</button></div></div>");
    out += cell("numeric, ± 48 × 48", '<div class="field mk-w-320"><label class="field-label" for="f8" data-i18n="field.limit"></label><div class="row-gap-2"><button type="button" class="icon-btn is-surface" data-i18n-attr="aria-label:field.dec" data-act="dec">' + M.ic("chevron-down", 24) + '</button><div class="input grow"><input id="f8" inputmode="numeric" type="text" value="" placeholder="—"></div><button type="button" class="icon-btn is-surface" data-i18n-attr="aria-label:field.inc" data-act="inc">' + M.ic("plus", 24) + "</button></div></div>");
    fill("input-grid", out);
  })();

  /* ---------- chips, segment, steps ---------- */
  (function () {
    function chip(key, state) {
      return '<button type="button" class="chip' + (state === "focus" ? " is-focus" : "") + '" aria-pressed="' + (state === "selected") + '"' + (state === "disabled" ? " disabled" : "") + ">" + M.ic("check", 20, "ic-check") + '<span data-i18n="' + key + '"></span></button>';
    }
    function steps(n, m) {
      var seg = "";
      for (var i = 1; i <= m; i++) { seg += '<span class="' + (i <= n ? "is-done" : "") + '"></span>'; }
      return '<div class="steps mk-w-343" role="group"><div class="steps-bar" aria-hidden="true">' + seg + '</div><p class="t-label" data-i18n="step.title" data-p="n=' + n + ";m=" + m + ';text=@step.who"></p></div>';
    }
    var out = "";
    out += cell("chips: default / selected / focus / disabled", '<div class="chips">' + chip("filter.all", "default") + chip("status.outOfZone", "selected") + chip("status.noFence", "focus") + chip("status.noConnection", "disabled") + chip("filter.pen", "default") + "</div>", "mk-card");
    out += cell("segment (2 and 3 items)", '<div class="stack-3"><div class="segment" role="group"><button type="button" aria-pressed="true" data-i18n="seg.new"></button><button type="button" aria-pressed="false" data-i18n="seg.all"></button></div>' +
      '<div class="segment" role="group"><button type="button" aria-pressed="false" data-i18n="filter.all"></button><button type="button" aria-pressed="true" data-i18n="status.outOfZone"></button><button type="button" aria-pressed="false" data-i18n="status.noFence"></button></div></div>', "mk-card");
    out += cell("step indicator 1 of 3 / 2 of 3", '<div class="mk-card stack-4">' + steps(1, 3) + steps(2, 3) + "</div>");
    fill("chip-grid", out);
  })();

  /* ---------- badges ---------- */
  (function () {
    var out = "";
    [["online", ""], ["inZone", ""], ["outOfZone", ""], ["noConn", ""], ["lastSeen", "14:05"], ["noFence", ""]].forEach(function (b) {
      out += cell(b[0], M.badgeHTML(b[0], b[1]));
    });
    out += cell("no connection · time", '<span class="badge badge-offline">' + M.ic("wifi-off", 16) + '<span data-i18n="status.noConnectionTime" data-p="time=14:05"></span></span>');
    fill("badge-grid", out);
  })();

  /* ---------- rows ---------- */
  (function () {
    function host(w, inner) { return '<div class="mk-w-' + w + " row-host shadow-e1\">" + inner + "</div>"; }
    var out = "";
    [["default", "ok", "inZone"], ["pressed", "ok", "inZone"], ["selected", "danger", "outOfZone"], ["focus", "offline", "noConn"], ["disabled", "ok", "inZone"]].forEach(function (r) {
      out += cell("343 · " + r[0], host(343, M.rowHTML({ status: r[1], badge: r[2], state: r[0] === "default" ? "" : r[0], ago: 5 })));
    });
    out += cell("320 · selected (subtitle never wraps)", host(320, M.rowHTML({ status: "danger", badge: "outOfZone", state: "selected", ago: 5 })));
    out += cell("320 · selected · no connection", host(320, M.rowHTML({ status: "offline", badge: "noConn", state: "selected", ago: 25 })));
    out += cell("320 · no fence", host(320, M.rowHTML({ status: "warning", badge: "noFence", nofence: true, ago: 6 })));
    out += cell("skeleton", '<div class="mk-w-343 shadow-e1">' + M.rowSkeletonHTML() + M.rowSkeletonHTML() + "</div>");
    fill("row-grid", out);
  })();

  /* ---------- markers ---------- */
  (function () {
    function set() {
      return M.markerSVG("ok") + M.markerSVG("warning") + M.markerSVG("danger") + M.markerSVG("offline") +
        M.markerSVG("ok", { selected: true }) + M.markerSVG("warning", { nofence: true }) + M.markerSVG("offline", { nofence: true }) + M.clusterSVG(14);
    }
    var cap = "ok · warning · danger · offline (dashed) · selected · no fence · offline + no fence · cluster";
    var out = "";
    out += cell(cap + " — dark grass", '<div class="mk-on-map">' + set() + "</div>");
    out += cell(cap + " — light sand", '<div class="mk-on-map mk-on-sand">' + set() + "</div>");
    out += cell(cap + " — greyscale (QA)", '<div class="mk-on-map mk-on-grey">' + set() + "</div>");
    out += cell("in a list row, 32 px", '<div class="mk-card row-gap-3">' + ["ok", "warning", "danger", "offline"].map(function (s) { return M.markerSVG(s, { size: 32 }); }).join("") + "</div>");
    out += '<p class="t-caption t-muted basis-full max-70ch" data-i18n="mk.note.cluster"></p>';
    fill("marker-grid", out);
  })();

  /* ---------- alert cards ---------- */
  (function () {
    function card(type, unread, ago, state) {
      return M.alertHTML({ type: type, unread: unread, state: state, titleKey: type === "danger" ? "alert.leftFence" : "status.noConnection", whereKeys: type === "danger" ? ["animal.sample", "pen.north"] : ["animal.sample3", "tag.s0231"], ago: ago });
    }
    var out = "";
    out += cell("danger · unread", '<div class="mk-w-343">' + card("danger", true, 5) + "</div>");
    out += cell("danger · read", '<div class="mk-w-343">' + card("danger", false, 40) + "</div>");
    out += cell("offline · unread", '<div class="mk-w-343">' + card("offline", true, 12) + "</div>");
    out += cell("offline · read", '<div class="mk-w-343">' + card("offline", false, 90) + "</div>");
    out += cell("320 · danger · unread (buttons must not clip)", '<div class="mk-w-320">' + card("danger", true, 5) + "</div>");
    out += cell("focus", '<div class="mk-w-343">' + card("danger", false, 5, "focus") + "</div>");
    fill("alert-grid", out);
  })();

  /* ---------- bottom sheet (3 positions) inside real device frames ---------- */
  (function () {
    var host = $("sheet-frames");
    [["peek", 320, 640], ["half", 320, 640], ["full", 320, 640], ["half", 375, 812]].forEach(function (d) {
      var wrap = document.createElement("div");
      wrap.className = "mk-frame-wrap";
      wrap.innerHTML = '<h3 class="frame-title">sheet = ' + d[0] + " · " + d[1] + " × " + d[2] + '</h3><div class="mk-scroll"></div>';
      var dev = document.createElement("div");
      dev.className = "device";
      dev.style.setProperty("--w", d[1] + "px");
      dev.style.setProperty("--h", d[2] + "px");
      if (d[2] === 812) { dev.setAttribute("data-safe-b", ""); }
      dev.appendChild(MAPAPP.build({ state: "normal", sheet: d[0], name: "sheet " + d[0] + " " + d[1] }));
      wrap.querySelector(".mk-scroll").appendChild(dev);
      host.appendChild(wrap);
      dev.firstChild.refresh();
    });
  })();

  /* ---------- top bar + bottom nav (isolated) ---------- */
  (function () {
    function bar(w, inner) { return '<div class="mk-scroll"><div class="mk-bar-demo" style="--bw:' + w + 'px">' + inner + "</div></div>"; }
    var out = "";
    [320, 375].forEach(function (w) { out += cell("top bar " + w, bar(w, MAPAPP.topbarHTML())); });
    [320, 375].forEach(function (w) { out += cell("bottom nav " + w, bar(w, MAPAPP.bottomnavHTML("Qamqor · bottom nav " + w))); });
    out += cell("top bar 320 · long farm name (ellipsis)", bar(320, MAPAPP.topbarHTML().replace(/data-i18n="farm.demo"/, 'data-i18n="mk.longfarm"')));
    fill("nav-grid", out);
  })();

  /* ---------- rail ---------- */
  (function () {
    var out = "";
    out += cell("rail 104 (inner text width 88)", '<div class="mk-rail-demo">' + MAPAPP.railHTML(false, "Qamqor · rail") + "</div>");
    out += cell("rail 104 · language menu open", '<div class="mk-rail-demo is-menu">' + MAPAPP.railHTML(true, "Qamqor · rail with menu") + "</div>");
    fill("rail-grid", out);
  })();

  /* ---------- language switcher: real radio inputs (arrow keys and grouping come from the browser) ---------- */
  (function () {
    var rows = [["kk", "Қазақша"], ["ru", "Русский"], ["en", "English"]].map(function (l) {
      return '<label class="lang-row"><input type="radio" name="lang-demo" data-lang="' + l[0] + '">' + M.ic("check", 24, "ic-check") + "<span>" + l[1] + "</span></label>";
    }).join("");
    var out = cell("radio rows 56", '<div class="mk-card mk-w-343"><div role="radiogroup" class="stack-2" data-i18n-attr="aria-label:lang.aria">' + rows + "</div></div>");
    out += cell("rail button 48 × 48 (code, not flag)", '<div class="mk-card row-gap-4"><button type="button" class="rail-lang is-square" data-i18n-attr="aria-label:lang.aria"><span data-lang-code></span></button><span class="t-caption t-muted">KK / RU / EN</span></div>');
    fill("lang-grid", out);
  })();

  /* ---------- misc ---------- */
  (function () {
    var out = "";
    out += cell("dialog (width = frame − 32, tablet 480)", '<div class="mk-w-343"><div class="dialog" role="group" aria-labelledby="dlg-t"><h3 class="t-title-2" id="dlg-t" data-i18n="dlg.title"></h3><p class="t-body" data-i18n="dlg.text"></p>' +
      '<div class="dialog-actions"><button type="button" class="btn btn-secondary" data-i18n="dlg.back"></button><button type="button" class="btn btn-primary" data-i18n="action.apply"></button></div></div></div>');
    out += cell("toast", '<div class="toast">' + M.ic("circle-check", 24) + '<span data-i18n="toast.saved"></span></div>');
    out += cell("battery (only with data)", '<div class="mk-card"><span class="battery">' + M.ic("battery-medium", 24) + '<span data-i18n="battery.label"></span></span><p class="t-caption t-muted mt-2 max-30ch" data-i18n="mk.battery.note"></p></div>');
    out += cell("fence shapes (7.10)", fenceDemo());
    fill("misc-grid", out);
  })();

  function fenceDemo() {
    return '<div class="mk-on-map pad-0"><svg width="360" height="190" viewBox="0 0 360 190" aria-hidden="true" focusable="false">' +
      '<rect x="0" y="0" width="360" height="190" class="t-base"/>' +
      '<polygon class="pen-fill" points="14,20 110,14 118,84 20,92"/><polygon class="pen-casing" points="14,20 110,14 118,84 20,92"/><polygon class="pen-line" points="14,20 110,14 118,84 20,92"/>' +
      '<polygon class="pen-fill-active" points="130,20 226,14 234,84 136,92"/><polygon class="pen-casing" points="130,20 226,14 234,84 136,92"/><polygon class="pen-line pen-line-active" points="130,20 226,14 234,84 136,92"/>' +
      '<polygon class="pen-fill" points="246,20 342,14 350,84 252,92"/><polygon class="pen-casing" points="246,20 342,14 350,84 252,92"/><polygon class="pen-line" points="246,20 342,14 350,84 252,92"/>' +
      '<polyline class="pen-casing" points="342,14 350,84"/><polyline class="pen-line pen-line-alarm" points="342,14 350,84"/>' +
      '<polygon class="fence-new" points="20,110 110,104 118,176 24,180"/>' +
      '<rect class="vertex" x="13" y="103" width="14" height="14"/><rect class="vertex" x="103" y="97" width="14" height="14"/><rect class="vertex" x="111" y="169" width="14" height="14"/>' +
      '<rect class="vertex is-sel" x="17" y="173" width="14" height="14"/>' +
      '<polygon class="pen-casing is-selected-fence" points="140,110 226,104 234,176 144,180"/><polygon class="pen-line is-selected-fence" points="140,110 226,104 234,176 144,180"/>' +
      '</svg></div><p class="t-caption t-muted max-360" data-i18n="mk.fence.note"></p>';
  }

  /* ---------- small live behaviours of the demos ---------- */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (b) {
      var a = b.getAttribute("data-act");
      if (a === "toggle-pw") { var i = $("f6"); i.type = i.type === "password" ? "text" : "password"; }
      else if (a === "clear-search") { $("f7").value = ""; $("f7").focus(); }
      else if (a === "inc" || a === "dec") {
        var f = $("f8"); var n = parseInt(f.value || "0", 10) || 0;
        f.value = String(Math.max(1, n + (a === "inc" ? 1 : -1)));
      }
    }
    var c = e.target.closest(".chip[aria-pressed]");
    if (c && !c.hasAttribute("data-lang") && !c.disabled) { c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") === "true" ? "false" : "true"); }
    var sb = e.target.closest(".segment button");
    if (sb) { sb.parentNode.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === sb ? "true" : "false"); }); }
  });

  // demo buttons that have no behaviour of their own are labelled as static samples (they say so when pressed)
  document.querySelectorAll("main button.btn, main button.icon-btn, main button.fab, main button.row, main button.rail-farm").forEach(function (b) {
    if (b.closest(".app") || b.closest(".rail") || b.closest(".topbar")) { return; }
    if (b.hasAttribute("data-stub") || b.hasAttribute("data-act") || b.hasAttribute("data-lang") || b.hasAttribute("aria-pressed")) { return; }
    b.setAttribute("data-stub", "mk.static");
  });

  M.hydrateIcons(document);
  M.init();
})();
