/*
  Qamqor directions: shared S2 (map screen) markup + map layer builder.
  Same content and actions as docs/frontend/app-ui-spec.md S2; only the visual skin differs per direction.
  All data is placeholder (fake counts). Vanilla JS, no dependencies. Russian only.
*/
(function () {
  "use strict";
  var QI = window.QI;

  var D = {
    farm: "Ферма Жайлау",
    on: 138, total: 142, updated: "14:32",
    summary: [
      { k: "out", n: 2, l: "Вне зоны", dev: true },
      { k: "nofence", n: 1, l: "Без границы" },
      { k: "offline", n: 4, l: "Нет связи" },
      { k: "low", n: 3, l: "Низкий заряд" }
    ],
    pens: [
      { id: "n", name: "Северный", count: 64, status: "Применён", active: true },
      { id: "s", name: "Южный", count: 51, status: "Применён" },
      { id: "r", name: "Речной", count: 27, status: "Черновик", draft: true }
    ],
    alerts: [
      { kind: "out", t: "Корова #0142 вышла за забор", s: "Загон «Северный»", time: "12:41" },
      { kind: "off", t: "Корова #0231 без связи", s: "Загон «Южный»", time: "3 ч назад" },
      { kind: "low", t: "Ошейник #0087: заряд 14%", s: "Загон «Речной»", time: "вчера" }
    ],
    // map geometry, in map units (the 1800 x 1800 raster/vector layers)
    geo: {
      n: [[760, 640], [960, 610], [1000, 770], [790, 800]],
      s: [[800, 830], [990, 810], [1040, 980], [830, 1010]],
      r: [[1040, 640], [1190, 620], [1220, 770], [1060, 790]],
      clusterN: [908, 724], clusterS: [908, 912],
      sel: [868, 585], out2: [1066, 905],
      trail: "M812,758 C838,722 812,684 838,650 S858,614 868,585",
      labels: { n: [906, 668], s: [915, 862], r: [1130, 664] }
    }
  };
  window.QD = D;

  function plural(n) { return n % 10 === 1 && n % 100 !== 11 ? n + " животное" : n + " животных"; }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function inPoly(p, poly) { var c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) { c = !c; } } return c; }
  function pts(poly) { return poly.map(function (p) { return p[0] + "," + p[1]; }).join(" "); }

  /* ---------- map ---------- */
  function mapSvg(cfg) {
    var s = cfg.scale, W = cfg.w, H = cfg.h, vw = W / s, vh = H / s, g = D.geo, u = function (px) { return px / s; };
    var o = '<svg class="mapsvg" width="' + W + '" height="' + H + '" viewBox="' + cfg.x + " " + cfg.y + " " + vw + " " + vh + '" role="img" aria-label="Карта фермы: загоны Северный, Южный, Речной и стадо">';
    o += '<g class="layers">' + cfg.layers + "</g>";
    // pens
    D.pens.forEach(function (p) {
      o += '<polygon class="pen' + (p.active ? " is-active" : "") + (p.draft ? " is-draft" : "") + '" points="' + pts(g[p.id]) + '"/>';
    });
    // herd
    var r = rng(11), dots = [], tries = 0, bb = [1040, 620, 1220, 790];
    while (dots.length < 27 && tries++ < 4000) {
      var q = [bb[0] + r() * (bb[2] - bb[0]), bb[1] + r() * (bb[3] - bb[1])];
      if (!inPoly(q, g.r)) { continue; }
      var ok = dots.every(function (d) { return Math.hypot(d[0] - q[0], d[1] - q[1]) > u(17); });
      if (ok && Math.hypot(q[0] - 1130, q[1] - 664) > u(38)) { dots.push(q); }
    }
    dots.forEach(function (d, i) {
      o += '<circle class="dot' + (i < 2 ? " off" : "") + '" cx="' + d[0].toFixed(1) + '" cy="' + d[1].toFixed(1) + '" r="' + u(5.5) + '"/>';
    });
    function cluster(c, n) {
      var w = u(36), h = u(28);
      return '<g class="cluster" transform="translate(' + c[0] + " " + c[1] + ')"><rect x="' + (-w / 2) + '" y="' + (-h / 2) + '" width="' + w + '" height="' + h + '" rx="' + u(cfg.clusterRadius || 9) + '"/><text y="' + u(5) + '" font-size="' + u(14) + '" text-anchor="middle">' + n + "</text></g>";
    }
    o += cluster(g.clusterN, 62) + cluster(g.clusterS, 50);
    // out-of-zone animals and the selected one
    if (cfg.trail) { o += '<path class="trail-glow" d="' + g.trail + '"/><path class="trail" d="' + g.trail + '"/>'; }
    o += '<circle class="dot out" cx="' + g.out2[0] + '" cy="' + g.out2[1] + '" r="' + u(6) + '"/>';
    o += '<circle class="sel-ring" cx="' + g.sel[0] + '" cy="' + g.sel[1] + '" r="' + u(15) + '"/>';
    o += '<circle class="dot out" cx="' + g.sel[0] + '" cy="' + g.sel[1] + '" r="' + u(6.5) + '"/>';
    // pen names
    D.pens.forEach(function (p) {
      var l = g.labels[p.id];
      o += '<text class="penlabel" x="' + l[0] + '" y="' + l[1] + '" font-size="' + u(12.5) + '" text-anchor="middle">' + p.name + "</text>";
    });
    return o + "</svg>";
  }

  /* ---------- screen ---------- */
  function ic(n, w, s, c) { return QI.ph(n, w, s, c); }

  function summaryHtml(cfg) {
    return D.summary.map(function (x) {
      return '<button type="button" class="stat' + (x.dev ? " is-dev" : "") + '" data-k="' + x.k + '"><span class="n">' + x.n + '</span><span class="l">' + x.l + "</span></button>";
    }).join("");
  }
  function pensHtml(cfg) {
    return D.pens.map(function (p) {
      return '<li><button type="button" class="row pen' + (p.draft ? " is-draft" : "") + '"><span class="row-main"><span class="t">' + p.name + '</span><span class="s">' + plural(p.count) + '</span></span><span class="st"><i class="sd"></i>' + p.status + "</span>" + (cfg.chev ? ic("caret-right", "regular", 16, "chev") : "") + "</button></li>";
    }).join("");
  }
  function alertsHtml(cfg) {
    return D.alerts.map(function (a) {
      return '<li><button type="button" class="row alert k-' + a.kind + '"><i class="ad" aria-hidden="true"></i><span class="row-main"><span class="t">' + a.t + '</span><span class="s">' + a.s + '</span></span><time class="tm">' + a.time + "</time></button></li>";
    }).join("");
  }
  function actionsHtml(cfg) {
    return '<div class="actions"><button type="button" class="btn primary">' + ic("path", cfg.iw.btn, 22) + '<span>Перегнать стадо</span></button><button type="button" class="btn quiet">' + QI.tb("fence", 22, cfg.iw.tbsw || 1.5) + "<span>Нарисовать забор</span></button></div>";
  }
  function contentHtml(cfg) {
    return '<div class="actions-wrap">' + actionsHtml(cfg) + '</div><section aria-labelledby="h-pens-' + cfg.id + '"><h2 class="sec" id="h-pens-' + cfg.id + '">Загоны</h2><ul class="list">' + pensHtml(cfg) + '</ul></section><section aria-labelledby="h-al-' + cfg.id + '"><h2 class="sec" id="h-al-' + cfg.id + '">Оповещения</h2><ul class="list">' + alertsHtml(cfg) + '</ul><p class="updated">Обновлено ' + D.updated + "</p></section>";
  }
  function ctlHtml(cfg) {
    var w = cfg.iw.ctl;
    return '<div class="mapctl" role="group" aria-label="Управление картой">' +
      '<button type="button" class="ctl" aria-label="Слои и схема">' + ic("stack", w, 24) + "</button>" +
      '<button type="button" class="ctl" aria-label="Моё положение">' + ic("crosshair-simple", w, 24) + "</button>" +
      '<button type="button" class="ctl" aria-label="Ко всему стаду">' + ic("corners-out", w, 24) + "</button></div>";
  }
  function navItems(cfg, rail) {
    var items = [["map-trifold", "Карта", true], ["cow", "Стадо"], ["bell-ringing", "Оповещения", false, 3], ["tag", "Ошейники"]];
    return items.map(function (i) {
      return '<a href="#" class="nav-i' + (i[2] ? " is-cur" : "") + '"' + (i[2] ? ' aria-current="page"' : "") + ">" +
        '<span class="nav-ic">' + ic(i[0], i[2] ? cfg.iw.navOn : cfg.iw.nav, rail ? 26 : 26) + (i[3] ? '<b class="badge" aria-label="3 новых">' + i[3] + "</b>" : "") + '</span><span class="nav-l">' + i[1] + "</span></a>";
    }).join("");
  }
  function chipHtml() {
    return '<div class="selchip" role="status"><i class="sd out"></i><span class="t">Корова #0142</span><span class="s">Вне зоны, 12:41</span></div>';
  }
  function miniCard() {
    return '<section class="mini" aria-label="Выбранное животное"><div class="mini-h"><span class="t">Корова #0142</span><span class="st is-out"><i class="sd"></i>Вне зоны</span></div><p class="s">Последняя точка в 12:41</p><div class="mini-a"><button type="button" class="btn small primary"><span>Профиль</span></button><button type="button" class="btn small quiet"><span>Выбрать для перегона</span></button></div></section>';
  }

  function render(root, device, cfg, sheet) {
    cfg.id = device + (sheet ? "-" + sheet : "");
    var ph = device === "phone";
    var W = ph ? 375 : 1366, H = ph ? 812 : 1024;
    var cam = ph ? cfg.cam.phone[sheet] : cfg.cam.tablet;
    var map = mapSvg({ w: W, h: H, x: cam.x, y: cam.y, scale: cam.scale, layers: cfg.layers, trail: cfg.trail, clusterRadius: cfg.clusterRadius });
    var sel = D.geo.sel, chipX = (sel[0] - cam.x) * cam.scale, chipY = (sel[1] - cam.y) * cam.scale;
    var html = '<div class="map">' + map + '</div>';
    html += '<div class="selchip-pos" style="left:' + chipX.toFixed(0) + "px;top:" + chipY.toFixed(0) + 'px">' + chipHtml() + "</div>";
    html += '<p class="attrib">' + cfg.attrib + "</p>";
    if (ph) {
      html += '<header class="top"><button type="button" class="farmbtn" aria-label="Ферма: ' + D.farm + '. Переключить ферму"><span class="farm-n">' + D.farm + "</span>" + ic("caret-down", "regular", 18) + '</button>' +
        '<button type="button" class="connbtn" aria-label="На связи ' + D.on + " из " + D.total + '. Показать животных без связи"><i class="sd ok"></i><span>' + D.on + "/" + D.total + "</span></button>" +
        '<button type="button" class="gear" aria-label="Настройки">' + ic("gear-six", cfg.iw.ctl, 24) + "</button></header>";
      html += ctlHtml(cfg);
      html += '<section class="sheet" aria-label="Сводка по стаду"><button type="button" class="grab" aria-expanded="true" aria-label="Свернуть панель"><i></i></button><div class="stats" role="group" aria-label="Сводка по стаду">' + summaryHtml(cfg) + '</div><div class="sheet-body">' + contentHtml(cfg) + "</div></section>";
      html += '<nav class="tabs" aria-label="Основная навигация">' + navItems(cfg, false) + "</nav>";
    } else {
      html += '<nav class="rail" aria-label="Основная навигация"><div class="rail-top"><button type="button" class="rail-farm" aria-label="Ферма: ' + D.farm + '. Переключить ферму">' + ic("farm", cfg.iw.nav, 26) + '<span>Ферма</span></button><button type="button" class="rail-lang" aria-label="Язык: русский"><span class="lg">RU</span></button></div><div class="rail-nav">' + navItems(cfg, true) + '</div><button type="button" class="rail-set" aria-label="Настройки">' + ic("gear-six", cfg.iw.nav, 26) + "<span>Настройки</span></button></nav>";
      html += '<button type="button" class="connlong"><i class="sd ok"></i><span>На связи: ' + D.on + " из " + D.total + "</span></button>";
      html += ctlHtml(cfg);
      html += '<aside class="panel" aria-label="Сводка и загоны">' + miniCard() + '<div class="stats" role="group" aria-label="Сводка по стаду">' + summaryHtml(cfg) + '</div><div class="panel-body">' + contentHtml(cfg) + "</div></aside>";
    }
    root.innerHTML = html;
    QI.hydrate(root);
    var grab = root.querySelector(".grab");
    if (grab) {
      grab.addEventListener("click", function () {
        var half = root.getAttribute("data-sheet") !== "peek";
        root.setAttribute("data-sheet", half ? "peek" : "half");
        grab.setAttribute("aria-expanded", half ? "false" : "true");
        grab.setAttribute("aria-label", half ? "Развернуть панель" : "Свернуть панель");
      });
    }
  }

  /* ---------- viewer: phone + tablet on one page, or ?device=phone|tablet alone ---------- */
  function mount(cfg) {
    var qp = new URLSearchParams(location.search), q = qp.get("device"), sh = qp.get("sheet") === "half" ? "half" : "peek";
    var host = document.getElementById("stage");
    var items = q === "phone" ? [["phone", sh]] : q === "tablet" ? [["tablet"]] : [["phone", "peek"], ["phone", "half"], ["tablet"]];
    if (q === "phone" || q === "tablet") { document.body.classList.add("solo", "solo-" + q); }
    items.forEach(function (it) {
      var d = it[0], st = it[1];
      var fig = document.createElement("figure");
      fig.className = "fig fig-" + d;
      var cap = document.createElement("figcaption");
      cap.textContent = d === "phone" ? "Телефон 375 × 812, панель " + (st === "peek" ? "свёрнута (peek)" : "наполовину (half)") : "Планшет 1366 × 1024";
      var wrap = document.createElement("div");
      wrap.className = "scalebox";
      var scr = document.createElement("div");
      scr.className = "scr " + d;
      scr.setAttribute("data-sheet", st || "half");
      wrap.appendChild(scr);
      fig.appendChild(wrap); fig.appendChild(cap);
      host.appendChild(fig);
      render(scr, d, cfg, st);
    });
    function fit() {
      document.querySelectorAll(".fig-tablet .scalebox").forEach(function (b) {
        if (document.body.classList.contains("solo")) { b.style.width = ""; b.style.height = ""; b.firstChild.style.transform = ""; return; }
        var avail = Math.min(window.innerWidth - 48, 1366 + 0), k = Math.min(1, avail / 1366);
        if (window.innerWidth > 1500) { k = Math.min(1, (window.innerWidth - 2 * 375 - 200) / 1366); }
        b.firstChild.style.transformOrigin = "0 0"; b.firstChild.style.transform = "scale(" + k + ")";
        b.style.width = (1366 * k) + "px"; b.style.height = (1024 * k) + "px";
      });
    }
    fit(); window.addEventListener("resize", fit);
  }
  window.QS = { mount: mount, D: D };
})();
