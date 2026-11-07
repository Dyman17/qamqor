/*
  Qamqor mockups: screen S2 "Карта — главный" as a reusable element.
  MAPAPP.build({state, sheet, role, name}) returns <div class="app"> to place inside a .device frame.
  Layout (phone vs tablet) comes from CSS container queries on the frame, so the same element works at any width.
  Everything here is mock behaviour: no data, no network. Not-yet-built destinations show an in-frame notice.
*/
(function () {
  "use strict";
  var M = window.MOCK;
  var uid = 0;

  var STATUS_KEY = { ok: "status.inZone", danger: "status.outOfZone", warning: "status.noFence", offline: "status.noConnection" };
  var BADGE_KIND = { ok: "inZone", danger: "outOfZone", warning: "noFence", offline: "noConn" };
  var STATES = ["normal", "loading", "loadingLong", "emptyAnimals", "emptyPens", "error", "offline", "allOk", "wifi"];

  /* world coordinates are px from the visible-area centre (see .map-world); tag number = last two digits of the id */
  var ANIMALS = [
    { id: "0087", st: "ok", x: -95, y: -120, ago: 1, num: true },
    { id: "0054", st: "ok", x: -45, y: -135, ago: 2 },
    { id: "0099", st: "ok", x: -85, y: -65, ago: 3 },
    { id: "0231", st: "offline", x: -25, y: -85, ago: 12 },
    { id: "0142", st: "danger", x: 48, y: -100, ago: 5, num: true },
    { id: "0301", st: "ok", x: -60, y: 55, ago: 1 },
    { id: "0310", st: "ok", x: -5, y: 45, ago: 2 },
    { id: "0322", st: "ok", x: 25, y: 95, ago: 4 },
    { id: "0338", st: "ok", x: -50, y: 105, ago: 1 },
    { id: "0410", st: "warning", x: 110, y: 50, ago: 6, nofence: true },
    { id: "0415", st: "offline", x: 95, y: -30, ago: 25, nofence: true }
  ];

  function stipa() {
    return '<svg class="stipa" width="120" height="72" viewBox="0 0 120 72" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M18 70C20 48 16 30 8 12"/><path d="M8 12l-3 7M8 12l4 6M13 30l-4 5M14 38l5 4"/>' +
      '<path d="M50 70C52 44 50 24 42 6"/><path d="M42 6l-3 8M42 6l5 7M47 26l-5 5M49 36l6 4"/>' +
      '<path d="M84 70C86 50 84 34 78 18"/><path d="M78 18l-3 6M78 18l5 6M83 38l-5 5"/>' +
      '<path d="M106 70C108 56 106 44 101 32"/><path d="M101 32l-2 5M101 32l4 4"/></svg>';
  }

  function markerInner(a, forceOffline) {
    var st = forceOffline ? "offline" : a.st;
    return M.markerSVG(st, { nofence: a.nofence }) + (a.num ? '<span class="mk-num">' + a.id + "</span>" : "");
  }
  function markersHTML() {
    return ANIMALS.map(function (a) {
      return '<button type="button" class="mk" style="--x:' + a.x + ";--y:" + a.y + '" data-animal="' + a.id + '" data-status="' + a.st + '"' +
        (a.nofence ? ' data-nofence="1"' : "") + ">" + markerInner(a, false) + "</button>";
    }).join("") +
      '<button type="button" class="mk mk-cluster" style="--x:115;--y:-150" data-stub="map.cluster" data-p="n=14" data-i18n-attr="aria-label:map.cluster">' + M.clusterSVG(14) + "</button>";
  }

  function mapSVG() {
    return '<svg class="map-svg" viewBox="-700 -600 1400 1200" aria-hidden="true" focusable="false">' +
      '<rect class="t-base" x="-700" y="-600" width="1400" height="1200"/>' +
      '<polygon class="t-field" points="-420,-300 -190,-340 -170,-120 -400,-90"/>' +
      '<polygon class="t-field" points="210,-260 470,-300 500,-60 230,-30"/>' +
      '<polygon class="t-field" points="-380,170 -180,150 -150,380 -400,400"/>' +
      '<polygon class="t-field" points="220,120 460,140 440,360 240,340"/>' +
      '<polygon class="t-sand" points="-700,230 -520,200 -300,260 -120,330 120,360 360,330 700,420 700,520 300,470 -100,470 -400,380 -700,330"/>' +
      '<path class="t-water" d="M-700 -480 C-520 -430 -430 -520 -300 -470 C-180 -430 -90 -520 40 -520 C140 -520 200 -460 320 -480 L330 -600 L-700 -600 Z"/>' +
      '<path class="t-road" d="M-700 -20 C-400 -60 -250 20 -150 -10 S 150 -40 250 40 S 600 60 700 20"/>' +
      '<polygon class="pen pen-fill" points="190,-190 330,-210 345,-80 205,-65"/>' +
      '<polygon class="pen pen-casing" points="190,-190 330,-210 345,-80 205,-65"/>' +
      '<polygon class="pen pen-line" points="190,-190 330,-210 345,-80 205,-65"/>' +
      '<polygon class="pen pen-fill" points="-130,-150 0,-165 20,-50 -115,-35"/>' +
      '<polygon class="pen pen-casing" points="-130,-150 0,-165 20,-50 -115,-35"/>' +
      '<polygon class="pen pen-line" points="-130,-150 0,-165 20,-50 -115,-35"/>' +
      '<polyline class="pen pen-casing" points="0,-165 20,-50"/><polyline class="pen pen-line pen-line-alarm" points="0,-165 20,-50"/>' +
      '<polygon class="pen pen-fill-active" points="-100,20 40,10 60,120 -85,135"/>' +
      '<polygon class="pen pen-casing" points="-100,20 40,10 60,120 -85,135"/>' +
      '<polygon class="pen pen-line pen-line-active" points="-100,20 40,10 60,120 -85,135"/>' +
      "</svg>";
  }

  function navItems(label) {
    var items = [["map", "nav.map", true], ["users", "nav.herd", false], ["bell", "nav.alerts", false], ["tag", "nav.collars", false]];
    return items.map(function (it) {
      var alerts = it[1] === "nav.alerts";
      var badge = alerts ? '<span class="nav-badge" aria-hidden="true">3</span>' : "";
      var aria = alerts ? ' data-aria-parts="nav.alerts|alerts.new3"' : "";
      return '<a href="#" class="nav-item"' + (it[2] ? ' aria-current="page"' : ' data-stub="' + it[1] + '"') + aria + ">" +
        '<span class="nav-icon"><i data-icon="' + it[0] + '" data-size="28"></i>' + badge + '</span><span class="nav-label" data-i18n="' + it[1] + '"></span></a>';
    }).join("");
  }

  function topbarHTML() {
    return '<div class="topbar">' +
      '<button type="button" class="farm-btn" data-stub="farm.switch" aria-haspopup="dialog"><span class="farm-name" data-i18n="farm.demo"></span><i data-icon="chevron-down" data-size="16"></i></button>' +
      '<button type="button" class="conn-btn" data-stub="nav.herd" data-i18n-attr="aria-label:conn.aria"><i data-icon="wifi" data-size="16"></i><span aria-hidden="true">138/142</span></button>' +
      '<button type="button" class="icon-btn" data-stub="settings.title" data-i18n-attr="aria-label:settings.title"><i data-icon="settings"></i></button>' +
      "</div>";
  }
  function railHTML(openMenu, label) {
    return '<nav class="rail" aria-label="' + (label || "Qamqor") + '">' +
      '<div class="rail-top">' +
        '<button type="button" class="rail-farm" data-stub="farm.switch" aria-haspopup="dialog"><span data-i18n="farm.demo"></span><i data-icon="chevron-down" data-size="16"></i></button>' +
        '<button type="button" class="rail-lang" aria-haspopup="menu" aria-expanded="false" data-i18n-attr="aria-label:lang.aria"><i data-icon="languages" data-size="20"></i><span data-lang-code></span></button>' +
      "</div>" +
      '<div class="rail-nav">' + navItems() + "</div>" +
      '<div class="rail-bottom"><a href="#" class="nav-item" data-stub="settings.title"><span class="nav-icon"><i data-icon="settings" data-size="28"></i></span><span class="nav-label" data-i18n="settings.title"></span></a></div>' +
      '<div class="menu" role="menu"' + (openMenu ? "" : " hidden") + ' data-i18n-attr="aria-label:lang.aria">' +
        '<button type="button" role="menuitemradio" data-lang="kk" aria-checked="false"><i data-icon="check" data-size="20"></i>Қазақша</button>' +
        '<button type="button" role="menuitemradio" data-lang="ru" aria-checked="false"><i data-icon="check" data-size="20"></i>Русский</button>' +
        '<button type="button" role="menuitemradio" data-lang="en" aria-checked="false"><i data-icon="check" data-size="20"></i>English</button>' +
      "</div></nav>";
  }
  function bottomnavHTML(label) {
    return '<nav class="bottomnav" aria-label="' + (label || "Qamqor") + '">' + navItems() + "</nav>";
  }

  function html(id, name) {
    var navLabel = "Qamqor · " + name;
    return '' +
      '<div class="banner banner-offline" role="status"><i data-icon="wifi-off" data-size="20"></i><span class="banner-text" data-i18n="banner.offline" data-p="time=14:02"></span></div>' +
      '<div class="banner banner-server" role="alert"><i data-icon="circle-exclamation-point" data-size="20"></i><span class="banner-text" data-i18n="banner.server"></span><button type="button" class="btn btn-tertiary" data-stub="action.retry" data-i18n="action.retry"></button></div>' +
      topbarHTML() +
      railHTML(false, navLabel) +
      '<button type="button" class="map-pill" data-stub="nav.herd" data-i18n-attr="aria-label:conn.aria"><i data-icon="wifi" data-size="20"></i><span aria-hidden="true" data-i18n="conn.long"></span></button>' +
      '<p class="updated-plate" data-i18n="map.updated" data-p="time=14:02"></p>' +

      '<div class="map" role="region" data-i18n-attr="aria-label:map.placeholder">' +
        '<div class="map-world">' + mapSVG() +
          '<span class="map-label pen-label" style="--x:-65;--y:-182" data-i18n="pen.north"></span>' +
          '<span class="map-label pen-label" style="--x:-20;--y:150" data-i18n="pen.south"></span>' +
          markersHTML() +
        "</div>" +
        '<div class="map-loading" role="status"><i class="spin" data-icon="loader" data-size="32"></i><p class="t-title-2" data-i18n="map.loading"></p>' +
          '<div class="slow"><p class="t-body" data-i18n="map.slow"></p><button type="button" class="btn btn-secondary" data-stub="action.retry" data-i18n="action.retry"></button></div></div>' +
        '<p class="map-ph-label" data-i18n="map.placeholder"></p>' +
      "</div>" +

      '<div class="wifi-plate" role="status" data-show="wifi"><i data-icon="circle-exclamation-point" data-size="20"></i><p data-i18n="wifi.text"></p>' +
        '<button type="button" class="btn btn-tertiary" data-act="wifi-ok" data-i18n="wifi.ok"></button></div>' +

      '<div class="fabs">' +
        '<button type="button" class="fab" data-act="scheme" aria-pressed="false" data-i18n-attr="aria-label:map.layers"><i data-icon="layers" data-size="24"></i></button>' +
        '<button type="button" class="fab" data-stub="map.locate" data-i18n-attr="aria-label:map.locate"><i data-icon="locate-fixed" data-size="24"></i></button>' +
        '<button type="button" class="fab" data-stub="map.fitAll" data-i18n-attr="aria-label:map.fitAll"><i data-icon="maximize" data-size="24"></i></button>' +
      "</div>" +

      '<section class="sheet" aria-labelledby="sheet-title-' + id + '">' +
        '<div class="sheet-head">' +
          '<button type="button" class="sheet-handle" data-act="handle" data-i18n-attr="aria-label:sheet.expand"></button>' +
          '<button type="button" class="icon-btn sheet-chev" data-act="chev" data-i18n-attr="aria-label:sheet.expand"><i data-icon="chevron-up" data-size="24"></i></button>' +
        "</div>" +
        '<div class="sheet-body">' +
          '<h2 class="sheet-title" id="sheet-title-' + id + '" tabindex="-1" data-i18n="sheet.summary"></h2>' +

          '<div class="mini" data-show="normal emptyPens error offline allOk wifi" aria-live="polite"></div>' +

          '<div class="sum" role="group" data-i18n-attr="aria-label:sheet.summary" data-show="normal emptyPens error offline wifi">' +
            '<button type="button" class="sum-tile is-danger" data-stub="status.outOfZone"><span class="n">1</span><span class="l" data-i18n="status.outOfZone"></span></button>' +
            '<button type="button" class="sum-tile is-warning" data-stub="status.noFence"><span class="n">2</span><span class="l" data-i18n="status.noFence"></span></button>' +
            '<button type="button" class="sum-tile is-offline" data-stub="status.noConnection"><span class="n">2</span><span class="l" data-i18n="status.noConnection"></span></button>' +
          "</div>" +
          '<p class="allok" data-show="allOk"><i data-icon="circle-check" data-size="24"></i><span data-i18n="sheet.allOk" data-p="time=14:02"></span></p>' +

          '<div class="empty only-half" data-show="emptyAnimals">' + stipa() + '<p class="t-body-l" data-i18n="empty.animals"></p>' +
            '<button type="button" class="btn btn-primary" data-stub="empty.addCollar" data-i18n="empty.addCollar"></button></div>' +
          '<div class="empty only-half" data-show="emptyPens">' + stipa() + '<p class="t-title-2" data-i18n="empty.pens"></p>' +
            '<button type="button" class="btn btn-primary perm" data-stub="action.drawFence" data-i18n="action.drawFence"></button></div>' +

          '<div class="skeleton only-half" data-show="loading loadingLong" aria-hidden="true"><span class="skel"></span><span class="skel skel-w70"></span><span class="skel"></span><span class="skel skel-w55"></span></div>' +

          '<div class="acts only-half perm" data-show="normal emptyAnimals error offline loading loadingLong allOk wifi">' +
            '<button type="button" class="btn btn-primary" data-write data-stub="action.drawFence" data-i18n="action.drawFence"></button>' +
            '<button type="button" class="btn btn-secondary" data-write data-stub="action.moveHerd" data-i18n="action.moveHerd"></button>' +
          "</div>" +
          '<p class="note note-write note-offline only-half perm" data-show="offline"><i data-icon="wifi-off" data-size="16"></i><span data-i18n="write.disabled"></span></p>' +
          '<p class="note note-write note-server only-half perm" data-show="error"><i data-icon="circle-exclamation-point" data-size="16"></i><span data-i18n="write.disabledServer"></span></p>' +

          '<section class="pens only-half block" data-show="normal emptyAnimals error offline allOk wifi" aria-labelledby="pens-' + id + '"><h3 class="sec-title" id="pens-' + id + '" data-i18n="pens.title"></h3>' +
            '<button type="button" class="pen-row" data-stub="pen.north"><div><p class="pen-name" data-i18n="pen.north"></p><p class="pen-meta"><span data-i18n="pen.animals"></span> 24</p></div>' + '<span class="badge badge-ok"><i data-icon="circle-check" data-size="16"></i><span data-i18n="pen.applied"></span></span></button>' +
            '<button type="button" class="pen-row" data-stub="pen.south"><div><p class="pen-name" data-i18n="pen.south"></p><p class="pen-meta"><span data-i18n="pen.animals"></span> 12</p></div>' + '<span class="badge badge-info"><i data-icon="pencil-line" data-size="16"></i><span data-i18n="pen.draft"></span></span></button>' +
          "</section>" +

          '<section class="alerts only-half block" data-show="normal error offline wifi" aria-labelledby="al-' + id + '"><h3 class="sec-title" id="al-' + id + '" data-i18n="alerts.nearest"></h3>' +
            '<div data-show="normal error offline">' + M.alertHTML({ type: "danger", unread: true, titleKey: "alert.leftFence", whereKeys: ["animal.sample", "pen.north"], ago: 5 }) + "</div>" +
            M.alertHTML({ type: "offline", unread: false, titleKey: "status.noConnection", whereKeys: ["animal.sample3", "tag.s0231"], ago: 12 }) +
          "</section>" +
        "</div>" +
      "</section>" +

      bottomnavHTML(navLabel) +
      M.toastHostHTML();
  }

  function build(opts) {
    opts = opts || {};
    var id = ++uid;
    var app = document.createElement("div");
    app.className = "app";
    app.setAttribute("data-state", opts.state || "normal");
    app.setAttribute("data-sheet", opts.sheet || "peek");
    app.setAttribute("data-role", opts.role || "owner");
    app.setAttribute("data-scheme", "sat");
    app.innerHTML = html(id, opts.name || String(id));
    M.hydrateIcons(app);
    M.applyI18n(app);
    wire(app);
    app.setState(app.getAttribute("data-state"));
    app.setSheet(app.getAttribute("data-sheet"));
    return app;
  }

  /* ---------- helpers that act on one app ---------- */
  function effStatus(app, b) { return app.getAttribute("data-state") === "wifi" ? "offline" : b.getAttribute("data-status"); }

  function refreshMarkers(app) {
    app.querySelectorAll(".mk[data-animal]").forEach(function (b) {
      var st = effStatus(app, b);
      var s = M.t(STATUS_KEY[st]);
      if (b.getAttribute("data-nofence") && st !== "warning") { s += ", " + M.t("status.noFence"); }
      b.setAttribute("aria-label", M.t("animal.prefix") + b.getAttribute("data-animal") + ", " + s);
    });
  }
  function restyleMarkers(app) {
    var wifi = app.getAttribute("data-state") === "wifi";
    app.querySelectorAll(".mk[data-animal]").forEach(function (b) {
      var a = ANIMALS.filter(function (x) { return x.id === b.getAttribute("data-animal"); })[0];
      b.innerHTML = markerInner(a, wifi);
    });
    refreshMarkers(app);
  }

  function renderMini(app) {
    var box = app.querySelector(".mini");
    var id = app.getAttribute("data-mini");
    if (!id) { box.innerHTML = ""; return; }
    var a = ANIMALS.filter(function (x) { return x.id === id; })[0];
    var st = app.getAttribute("data-state") === "wifi" ? "offline" : a.st;
    box.innerHTML =
      '<button type="button" class="icon-btn mini-close" data-act="mini-close" data-i18n-attr="aria-label:mini.close"><i data-icon="x" data-size="24"></i></button>' +
      '<div class="mini-head">' + M.markerSVG(st, { size: 40, nofence: a.nofence }) +
      '<div><p class="t-body-l mini-name"><span data-i18n="animal.prefix"></span>' + a.id + "</p>" +
      '<p class="t-caption t-muted"><span data-i18n="tag.sample" data-p="n=' + a.id.slice(-2) + '"></span> · <span data-i18n="time.ago" data-p="n=' + a.ago + '"></span></p></div></div>' +
      "<div>" + M.badgeHTML(BADGE_KIND[st]) + "</div>" +
      '<div class="mini-actions"><button type="button" class="btn btn-secondary" data-stub="mini.profile" data-i18n="mini.profile"></button>' +
      '<button type="button" class="btn btn-primary perm" data-write data-stub="mini.pick" data-i18n="mini.pick"></button></div>';
    M.hydrateIcons(box);
    M.applyI18n(box);
    var s = app.getAttribute("data-state");
    var off = s === "offline" || s === "error";
    box.querySelectorAll("[data-write]").forEach(function (b) { b.disabled = off; });
  }

  var SHEET_ORDER = ["peek", "half", "full"];
  var OUTSIDE = ".banner, .topbar, .rail, .map-pill, .updated-plate, .map, .fabs, .bottomnav, .wifi-plate";

  function wire(app) {
    var sheet = app.querySelector(".sheet");
    var head = app.querySelector(".sheet-head");
    var title = app.querySelector(".sheet-title");
    var chev = app.querySelector('[data-act="chev"]');
    var handle = app.querySelector('[data-act="handle"]');
    var opener = null;

    // the modal (dialog) semantics exist only where the bottom sheet exists; on tablet the sheet is a side panel
    function isModal() { return app.isConnected && app.getAttribute("data-sheet") === "full" && getComputedStyle(head).display !== "none"; }

    function setBusy(on) {
      app.querySelectorAll("button, a.nav-item").forEach(function (el) {
        if (el.closest(".map-loading")) { return; }
        var isBtn = el.tagName === "BUTTON";
        if (on && !el.hasAttribute("data-busy")) {
          el.setAttribute("data-busy", "");
          if (isBtn) { el.disabled = true; } else { el.setAttribute("aria-disabled", "true"); el.setAttribute("tabindex", "-1"); }
        } else if (!on && el.hasAttribute("data-busy")) {
          el.removeAttribute("data-busy");
          if (isBtn) { el.disabled = false; } else { el.removeAttribute("aria-disabled"); el.removeAttribute("tabindex"); }
        }
      });
    }

    app.setState = function (s) {
      var busy = s === "loading" || s === "loadingLong";
      app.setAttribute("data-state", s);
      app.removeAttribute("data-wifi-dismissed");
      setBusy(false);
      if (busy) { setBusy(true); }
      var off = busy || s === "offline" || s === "error";
      app.querySelectorAll("[data-write]").forEach(function (b) { b.disabled = off; });
      var counts = s === "wifi" ? [0, 0, 11] : [1, 2, 2];
      app.querySelectorAll(".sum-tile .n").forEach(function (n, i) { n.textContent = counts[i]; });
      if (busy || s === "emptyAnimals") { app.removeAttribute("data-mini"); }
      app.querySelectorAll(".mk-selected").forEach(function (x) { if (!app.getAttribute("data-mini")) { x.classList.remove("mk-selected"); } });
      restyleMarkers(app);
      renderMini(app);
    };
    app.setRole = function (r) { app.setAttribute("data-role", r); };
    app.setSheet = function (s, focus) {
      var prev = app.getAttribute("data-sheet");
      app.setAttribute("data-sheet", s);
      var modal = isModal();
      sheet.setAttribute("role", modal ? "dialog" : "region");
      if (modal) { sheet.setAttribute("aria-modal", "true"); } else { sheet.removeAttribute("aria-modal"); }
      app.querySelectorAll(OUTSIDE).forEach(function (el) { if (modal) { el.setAttribute("inert", ""); } else { el.removeAttribute("inert"); } });
      var next = s === "full" ? "sheet.collapse" : "sheet.expand";
      [chev, handle].forEach(function (b) { b.setAttribute("data-i18n-attr", "aria-label:" + next); b.setAttribute("aria-label", M.t(next)); });
      chev.innerHTML = M.ic(s === "full" ? "chevron-down" : "chevron-up", 24);
      if (focus && modal && prev !== "full") { opener = document.activeElement; title.focus(); }
      if (focus && !modal && prev === "full") { var back = opener && app.contains(opener) ? opener : chev; back.focus(); opener = null; }
    };
    app.refresh = function () { refreshMarkers(app); renderMini(app); app.setSheet(app.getAttribute("data-sheet")); };

    // re-evaluate once the app is attached to a frame (at build time it is detached and has no layout)
    if (window.ResizeObserver) { new ResizeObserver(function () { app.setSheet(app.getAttribute("data-sheet")); }).observe(app); }

    function step(dir, focus) {
      var i = Math.max(0, Math.min(2, SHEET_ORDER.indexOf(app.getAttribute("data-sheet")) + dir));
      app.setSheet(SHEET_ORDER[i], focus);
    }
    function closeMenu(returnFocus) {
      var menu = app.querySelector(".menu");
      var rl = app.querySelector(".rail-lang");
      menu.hidden = true;
      rl.setAttribute("aria-expanded", "false");
      if (returnFocus) { rl.focus(); }
    }

    app.addEventListener("click", function (e) {
      var act = e.target.closest("[data-act]");
      var mk = e.target.closest(".mk[data-animal]");
      var menu = app.querySelector(".menu");
      if (act) {
        var a = act.getAttribute("data-act");
        if (a === "chev") { step(app.getAttribute("data-sheet") === "full" ? -1 : 1, true); }
        else if (a === "handle") { step(app.getAttribute("data-sheet") === "peek" ? 1 : -1, true); }
        else if (a === "scheme") {
          var on = app.getAttribute("data-scheme") !== "scheme";
          app.setAttribute("data-scheme", on ? "scheme" : "sat");
          act.setAttribute("aria-pressed", on ? "true" : "false");
          var key = on ? "map.placeholderScheme" : "map.placeholder";
          app.querySelector(".map-ph-label").setAttribute("data-i18n", key);
          app.querySelector(".map").setAttribute("data-i18n-attr", "aria-label:" + key);
          M.applyI18n(app);
        } else if (a === "mini-close") {
          app.removeAttribute("data-mini");
          app.querySelectorAll(".mk-selected").forEach(function (x) { x.classList.remove("mk-selected"); });
          renderMini(app);
        } else if (a === "wifi-ok") {
          app.setAttribute("data-wifi-dismissed", "");
        }
      } else if (mk && mk.hasAttribute("data-animal")) {
        app.querySelectorAll(".mk-selected").forEach(function (x) { x.classList.remove("mk-selected"); });
        mk.classList.add("mk-selected");
        app.setAttribute("data-mini", mk.getAttribute("data-animal"));
        renderMini(app);
        if (app.getAttribute("data-sheet") === "peek") { app.setSheet("half"); }
      }
      var lang = e.target.closest(".rail-lang");
      if (lang) {
        var open = menu.hidden;
        menu.hidden = !open;
        lang.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) { (menu.querySelector('[aria-checked="true"]') || menu.querySelector("button")).focus(); }
      } else if (!menu.hidden && !e.target.closest(".menu")) {
        closeMenu(false);
      } else if (e.target.closest(".menu [data-lang]")) {
        closeMenu(true);
      }
    });

    app.addEventListener("keydown", function (e) {
      var menu = app.querySelector(".menu");
      if (e.key === "Escape") {
        // Esc closes menus and the modal (full) sheet only; the non-modal half sheet is left alone
        if (!menu.hidden) { closeMenu(true); return; }
        if (isModal()) { step(-1, true); }
      }
      if (e.key === "Tab" && isModal()) {
        var f = Array.prototype.filter.call(sheet.querySelectorAll("button, [tabindex='-1']"), function (el) { return !el.disabled && el.offsetParent !== null; });
        if (!f.length) { return; }
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === title)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      if (!menu.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        var items = Array.prototype.slice.call(menu.querySelectorAll("button"));
        var i = (items.indexOf(document.activeElement) + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        items[i].focus();
      }
    });
  }

  // one delegated listener for all apps on the page (language change, frame resize between phone/tablet layouts)
  document.addEventListener("langchange", function () {
    document.querySelectorAll(".app").forEach(function (app) { if (app.refresh) { app.refresh(); } });
  });
  window.addEventListener("resize", function () {
    document.querySelectorAll(".app").forEach(function (app) { if (app.refresh) { app.refresh(); } });
  });

  window.MAPAPP = { build: build, topbarHTML: topbarHTML, railHTML: railHTML, bottomnavHTML: bottomnavHTML, STATES: STATES };
})();
