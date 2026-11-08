/*
  Qamqor Interactive Application Prototype
  Full multi-view implementation based on brief v3, Direction A3, and app-ui-spec.md.
  Views: Map (S2), Herd (S5), Profile (S6), Alerts (S7), Collars (S8), Settings (S9), Draw (S3), Move (S4), Auth (S1).
  Features: Circular droplet expanding transition, synchronized active navigation pill, and live search/filtering.
*/
(function () {
  "use strict";
  var M = window.MOCK;
  var uid = 0;

  var STATUS_KEY = { ok: "status.inZone", danger: "status.outOfZone", warning: "status.noFence", offline: "status.noConnection" };
  var BADGE_KIND = { ok: "inZone", danger: "outOfZone", warning: "noFence", offline: "noConn" };
  var STATES = ["normal", "loading", "loadingLong", "emptyAnimals", "emptyPens", "error", "offline", "allOk", "wifi"];
  var NAV_ORDER = ["map", "herd", "alerts", "collars"];
  var NAV_ICONS = {
    map: "map-trifold",
    herd: "cow",
    alerts: "bell-ringing",
    collars: "tag",
    settings: "gear-six"
  };

  var ANIMALS = [
    { id: "0142", st: "danger", x: 48, y: -100, ago: 5, num: true, pen: "Загон «Северный»", tag: "DEMO-A42", collar: "QAM-0001", breed: "Казахская белоголовая", lat: "43.650123", lng: "51.157245" },
    { id: "0087", st: "ok", x: -95, y: -120, ago: 1, num: true, pen: "Загон «Северный»", tag: "DEMO-A87", collar: "QAM-0002", breed: "Казахская белоголовая", lat: "43.649850", lng: "51.156100" },
    { id: "0054", st: "ok", x: -45, y: -135, ago: 2, pen: "Загон «Северный»", tag: "DEMO-A54", collar: "QAM-0005", breed: "Алатауская", lat: "43.649910", lng: "51.156800" },
    { id: "0099", st: "ok", x: -85, y: -65, ago: 3, pen: "Загон «Северный»", tag: "DEMO-A99", collar: "QAM-0006", breed: "Казахская белоголовая", lat: "43.649500", lng: "51.156400" },
    { id: "0231", st: "offline", x: -25, y: -85, ago: 12, pen: "Загон «Северный»", tag: "DEMO-A31", collar: "QAM-0004", breed: "Аулиеатинская", lat: "43.649300", lng: "51.157100" },
    { id: "0301", st: "ok", x: -60, y: 55, ago: 1, pen: "Загон «Южный»", tag: "DEMO-A01", collar: "QAM-0007", breed: "Казахская белоголовая", lat: "43.648200", lng: "51.156700" },
    { id: "0310", st: "ok", x: -5, y: 45, ago: 2, pen: "Загон «Южный»", tag: "DEMO-A10", collar: "QAM-0008", breed: "Казахская белоголовая", lat: "43.648300", lng: "51.157500" },
    { id: "0322", st: "ok", x: 25, y: 95, ago: 4, pen: "Загон «Южный»", tag: "DEMO-A22", collar: "QAM-0009", breed: "Казахская белоголовая", lat: "43.647900", lng: "51.158100" },
    { id: "0338", st: "ok", x: -50, y: 105, ago: 1, pen: "Загон «Южный»", tag: "DEMO-A38", collar: "QAM-0010", breed: "Алатауская", lat: "43.647800", lng: "51.157000" },
    { id: "0410", st: "warning", x: 110, y: 50, ago: 6, nofence: true, pen: "Без границы", tag: "DEMO-A11", collar: "QAM-0011", breed: "Алатауская", lat: "43.648100", lng: "51.159200" },
    { id: "0415", st: "offline", x: 95, y: -30, ago: 25, nofence: true, pen: "Без границы", tag: "DEMO-A15", collar: "QAM-0012", breed: "Казахская белоголовая", lat: "43.648900", lng: "51.158900" }
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

  function pensSVG() {
    return '<svg class="map-svg" viewBox="-700 -600 1400 1200" aria-hidden="true" focusable="false">' +
      '<polygon class="pen pen-extra" points="190,-190 330,-210 345,-80 205,-65"/>' +
      '<polygon class="pen is-active" points="-130,-150 0,-165 20,-50 -115,-35"/>' +
      '<polygon class="pen is-draft" points="-100,20 40,10 60,120 -85,135"/>' +
      '<polygon class="pen pen-draw-preview" style="display:none; stroke-dasharray:6,6; stroke:var(--accent-glow); fill:rgba(188,240,111,0.15);" points="-220,-80 -160,-220 50,-240 -10,-100"/>' +
      '<line class="pen-route-preview" style="display:none; stroke:var(--accent-glow); stroke-width:4; stroke-dasharray:8,6;" x1="-60" y1="-90" x2="-20" y2="70"/>' +
      "</svg>";
  }

  function navItems(activeView) {
    var items = [
      ["map-trifold", "nav.map", "map"],
      ["cow", "nav.herd", "herd"],
      ["bell-ringing", "nav.alerts", "alerts"],
      ["tag", "nav.collars", "collars"]
    ];
    return items.map(function (it) {
      var isCurrent = (activeView || "map") === it[2];
      var alerts = it[2] === "alerts";
      var badge = alerts ? '<span class="nav-badge" aria-hidden="true">3</span>' : "";
      var aria = alerts ? ' data-aria-parts="nav.alerts|alerts.new3"' : "";
      return '<a href="#" class="nav-item"' + (isCurrent ? ' aria-current="page"' : "") + ' data-tab="' + it[2] + '"' + aria + ">" +
        '<span class="nav-icon">' + M.ic(it[0], 26, "", isCurrent ? "fill" : "regular") + badge + '</span><span class="nav-label" data-i18n="' + it[1] + '"></span></a>';
    }).join("");
  }

  function topbarHTML() {
    return '<div class="topbar">' +
      '<button type="button" class="farm-btn" data-stub="farm.switch" aria-haspopup="dialog"><span class="farm-name" data-i18n="farm.demo"></span><i data-icon="caret-down" data-size="16"></i></button>' +
      '<button type="button" class="conn-btn" data-tab="herd" data-filter="offline" data-i18n-attr="aria-label:conn.aria"><span class="sdot" aria-hidden="true"></span><span aria-hidden="true">138/142</span></button>' +
      '<button type="button" class="gear-btn" data-tab="settings" data-i18n-attr="aria-label:settings.title"><i data-icon="gear-six" data-size="24"></i></button>' +
      "</div>";
  }

  function railHTML(openMenu, label, activeView) {
    return '<nav class="rail" aria-label="' + (label || "Qamqor") + '">' +
      '<div class="rail-top">' +
        '<button type="button" class="rail-farm" data-stub="farm.switch" aria-haspopup="dialog"><span data-i18n="farm.demo"></span><i data-icon="caret-down" data-size="16"></i></button>' +
        '<button type="button" class="rail-lang" aria-haspopup="menu" aria-expanded="false" data-i18n-attr="aria-label:lang.aria"><i data-icon="translate" data-size="20"></i><span data-lang-code></span></button>' +
      "</div>" +
      '<div class="rail-nav">' + navItems(activeView) + "</div>" +
      '<div class="rail-bottom"><a href="#" class="nav-item" data-tab="settings"><span class="nav-icon">' + M.ic("gear-six", 26, "", activeView === "settings" ? "fill" : "regular") + '</span><span class="nav-label" data-i18n="settings.title"></span></a></div>' +
      '<div class="menu" role="menu"' + (openMenu ? "" : " hidden") + ' data-i18n-attr="aria-label:lang.aria">' +
        '<button type="button" role="menuitemradio" data-lang="kk" aria-checked="false"><i data-icon="check" data-size="20"></i>Қазақша</button>' +
        '<button type="button" role="menuitemradio" data-lang="ru" aria-checked="false"><i data-icon="check" data-size="20"></i>Русский</button>' +
        '<button type="button" role="menuitemradio" data-lang="en" aria-checked="false"><i data-icon="check" data-size="20"></i>English</button>' +
      "</div></nav>";
  }

  function bottomnavHTML(label, activeView) {
    var idx = NAV_ORDER.indexOf(activeView || "map");
    var style = idx >= 0 ? ' style="--i:' + idx + ';"' : "";
    return '<nav class="bottomnav"' + style + ' aria-label="' + (label || "Qamqor") + '">' + navItems(activeView) + "</nav>";
  }

  function renderHerdRows(animals) {
    return animals.map(function (a) {
      var dotCls = a.st === "danger" ? "out" : (a.st === "offline" ? "off" : (a.st === "warning" ? "warn" : "ok"));
      return '<div class="row pad-3 herd-row" data-animal="' + a.id + '">' +
        '<input type="checkbox" class="herd-check" style="display:none; width:calc(20 * var(--u)); height:calc(20 * var(--u)); accent-color:var(--primary);">' +
        '<span class="row-dot ' + dotCls + '"></span>' +
        '<div class="row-main">' +
          '<span class="row-title">Корова #' + a.id + '</span>' +
          '<span class="row-sub">Бирка ' + a.tag + ' · ' + a.pen + '</span>' +
        '</div>' +
        '<div class="row-side">' +
          M.badgeHTML(BADGE_KIND[a.st]) +
          '<span class="t-caption t-muted" style="margin-top:calc(2 * var(--u));">' + a.ago + ' мин назад</span>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  function html(id, name) {
    var navLabel = "Qamqor · " + name;
    return '' +
      '<div class="app-droplet" aria-hidden="true"></div>' +
      '<div class="banner banner-offline" role="status"><i data-icon="wifi-slash" data-size="20"></i><span class="banner-text" data-i18n="banner.offline" data-p="time=14:02"></span></div>' +
      '<div class="banner banner-server" role="alert"><i data-icon="warning-circle" data-size="20"></i><span class="banner-text" data-i18n="banner.server"></span><button type="button" class="btn btn-tertiary" data-stub="action.retry" data-i18n="action.retry"></button></div>' +

      /* ---------- S2: MAP VIEW ---------- */
      '<div class="map" role="region" data-i18n-attr="aria-label:map.label">' +
        '<div class="map-world"><img class="map-img" src="assets/img/sentinel2-ili.webp" alt="" width="1800" height="1800">' + pensSVG() +
          '<span class="map-label pen-label" style="--x:-65;--y:-182" data-i18n="pen.north"></span>' +
          '<span class="map-label pen-label" style="--x:-20;--y:150" data-i18n="pen.south"></span>' +
          markersHTML() +
        "</div>" +
        '<div class="map-loading" role="status"><i class="spin" data-icon="arrow-clockwise" data-size="32"></i><p class="t-title-2" data-i18n="map.loading"></p>' +
          '<div class="slow"><p class="t-body" data-i18n="map.slow"></p><button type="button" class="btn btn-secondary" data-stub="action.retry" data-i18n="action.retry"></button></div></div>' +
        '<p class="attrib" data-i18n="map.placeholder"></p>' +
      "</div>" +

      topbarHTML() +
      railHTML(false, navLabel, "map") +
      '<button type="button" class="map-pill" data-tab="herd" data-filter="offline" data-i18n-attr="aria-label:conn.aria"><span class="sdot" aria-hidden="true"></span><span aria-hidden="true" data-i18n="conn.long"></span></button>' +
      '<p class="updated-plate" data-i18n="map.updated" data-p="time=14:02"></p>' +

      '<div class="wifi-plate" role="status" data-show="wifi"><i data-icon="warning-circle" data-size="20"></i><p data-i18n="wifi.text"></p>' +
        '<button type="button" class="btn btn-tertiary" data-act="wifi-ok" data-i18n="wifi.ok"></button></div>' +

      '<div class="fabs">' +
        '<button type="button" class="fab" data-act="scheme" aria-pressed="false" data-i18n-attr="aria-label:map.layers"><i data-icon="stack" data-size="24"></i></button>' +
        '<button type="button" class="fab" data-stub="map.locate" data-i18n-attr="aria-label:map.locate"><i data-icon="crosshair-simple" data-size="24"></i></button>' +
        '<button type="button" class="fab" data-stub="map.fitAll" data-i18n-attr="aria-label:map.fitAll"><i data-icon="corners-out" data-size="24"></i></button>' +
      "</div>" +

      '<section class="sheet" aria-labelledby="sheet-title-' + id + '">' +
        '<div class="sheet-head">' +
          '<button type="button" class="sheet-handle" data-act="handle" data-i18n-attr="aria-label:sheet.expand"></button>' +
        "</div>" +
        '<div class="sheet-body">' +
          '<h2 class="sheet-title" id="sheet-title-' + id + '" tabindex="-1" data-i18n="sheet.summary"></h2>' +
          '<div class="mini" data-show="normal emptyPens error offline allOk wifi" aria-live="polite"></div>' +
          '<div class="sum" role="group" data-i18n-attr="aria-label:sheet.summary" data-show="normal emptyPens error offline wifi">' +
            '<button type="button" class="sum-tile is-danger" data-tab="herd" data-filter="danger"><span class="n">1</span><span class="l" data-i18n="status.outOfZone"></span></button>' +
            '<button type="button" class="sum-tile" data-tab="herd" data-filter="warning"><span class="n">2</span><span class="l" data-i18n="status.noFence"></span></button>' +
            '<button type="button" class="sum-tile" data-tab="herd" data-filter="offline"><span class="n">2</span><span class="l" data-i18n="status.noConnection"></span></button>' +
          "</div>" +
          '<p class="allok" data-show="allOk"><i data-icon="check-circle" data-weight="fill" data-size="24"></i><span data-i18n="sheet.allOk" data-p="time=14:02"></span></p>' +
          '<div class="empty only-half" data-show="emptyAnimals">' + stipa() + '<p class="t-body-l" data-i18n="empty.animals"></p>' +
            '<button type="button" class="btn btn-primary" data-tab="collars" data-act="open-pair-wizard" data-i18n="empty.addCollar"></button></div>' +
          '<div class="empty only-half" data-show="emptyPens">' + stipa() + '<p class="t-title-2" data-i18n="empty.pens"></p>' +
            '<button type="button" class="btn btn-primary perm" data-tab="draw" data-i18n="action.drawFence"></button></div>' +
          '<div class="skeleton only-half" data-show="loading loadingLong" aria-hidden="true"><span class="skel"></span><span class="skel skel-w70"></span><span class="skel"></span><span class="skel skel-w55"></span></div>' +
          '<div class="acts only-half perm" data-show="normal emptyAnimals error offline loading loadingLong allOk wifi">' +
            '<button type="button" class="btn btn-primary" data-write data-tab="draw"><i data-icon="fence" data-size="22"></i><span data-i18n="action.drawFence"></span></button>' +
            '<button type="button" class="btn btn-secondary" data-write data-tab="move"><i data-icon="path" data-size="22"></i><span data-i18n="action.moveHerd"></span></button>' +
          "</div>" +
          '<p class="note note-write note-offline only-half perm" data-show="offline"><i data-icon="wifi-slash" data-size="16"></i><span data-i18n="write.disabled"></span></p>' +
          '<p class="note note-write note-server only-half perm" data-show="error"><i data-icon="warning-circle" data-size="16"></i><span data-i18n="write.disabledServer"></span></p>' +
          '<section class="pens only-half block" data-show="normal emptyAnimals error offline allOk wifi" aria-labelledby="pens-' + id + '"><h3 class="sec-title" id="pens-' + id + '" data-i18n="pens.title"></h3>' +
            '<div class="list">' +
            '<button type="button" class="pen-row" data-tab="draw"><div><p class="pen-name" data-i18n="pen.north"></p><p class="pen-meta"><span data-i18n="pen.animals"></span> <span class="num">24</span></p></div><span class="badge badge-zone"><span data-i18n="pen.applied"></span></span></button>' +
            '<button type="button" class="pen-row" data-tab="draw"><div><p class="pen-name" data-i18n="pen.south"></p><p class="pen-meta"><span data-i18n="pen.animals"></span> <span class="num">12</span></p></div><span class="badge badge-danger"><span class="sdot"></span><span data-i18n="pen.draft"></span></span></button>' +
            "</div></section>" +
          '<section class="alerts only-half block" data-show="normal error offline wifi" aria-labelledby="al-' + id + '"><h3 class="sec-title" id="al-' + id + '" data-i18n="alerts.nearest"></h3><div class="alerts-list">' +
            '<div data-show="normal error offline">' + M.alertHTML({ type: "danger", unread: true, titleKey: "alert.leftFence", whereKeys: ["animal.sample", "pen.north"], ago: 5 }) + "</div>" +
            M.alertHTML({ type: "offline", unread: false, titleKey: "status.noConnection", whereKeys: ["animal.sample3", "tag.s0231"], ago: 12 }) +
          "</div></section>" +
        "</div>" +
      "</section>" +

      /* ---------- S5: HERD VIEW ---------- */
      '<div class="app-view view-herd" role="region" aria-label="Стадо">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
          '<h2 class="t-title-1" data-i18n="herd.title">Стадо</h2>' +
          '<span class="t-caption t-muted herd-counter" data-i18n="herd.count" data-p="n=142">В стаде: 142</span>' +
        '</div>' +
        '<div class="view-search-row">' +
          '<div class="input" style="flex:1;"><i data-icon="magnifying-glass" data-size="20"></i><input type="text" class="herd-search-input" placeholder="Номер или бирка..." data-i18n-attr="placeholder:herd.search"></div>' +
          '<button type="button" class="btn btn-secondary btn-sm herd-select-toggle" data-i18n="herd.select">Выбрать</button>' +
        '</div>' +
        '<div class="filter-pills" role="tablist">' +
          '<button type="button" class="chip is-active" data-herd-filter="all" data-i18n="filter.all">Все</button>' +
          '<button type="button" class="chip" data-herd-filter="ok" data-i18n="filter.inZone">В зоне</button>' +
          '<button type="button" class="chip" data-herd-filter="danger" data-i18n="filter.outOfZone">Вне зоны</button>' +
          '<button type="button" class="chip" data-herd-filter="offline" data-i18n="filter.noConn">Без связи</button>' +
        '</div>' +
        '<div class="herd-action-bar" style="display:none; justify-content:space-between; align-items:center; background:var(--surface-1); padding:var(--space-2) var(--space-3); border-radius:var(--r-sm);">' +
          '<span class="t-caption t-muted herd-selected-count">Выбрано: 0</span>' +
          '<button type="button" class="btn btn-primary btn-sm" data-tab="move" data-i18n="herd.moveSelected">Перегнать выбранных</button>' +
        '</div>' +
        '<div class="list-card herd-items-container">' + renderHerdRows(ANIMALS) + '</div>' +
      '</div>' +

      /* ---------- S6: PROFILE VIEW ---------- */
      '<div class="app-view view-profile" role="region" aria-label="Карточка животного">' +
        '<div style="display:flex; align-items:center; justify-content:space-between;">' +
          '<button type="button" class="btn btn-secondary btn-sm" data-act="back-from-profile"><i data-icon="caret-left" data-size="16"></i> <span data-i18n="profile.back">Назад к стаду</span></button>' +
          '<button type="button" class="btn btn-tertiary btn-sm" data-stub="profile.btnEdit" data-i18n="profile.btnEdit">Изменить</button>' +
        '</div>' +
        '<div class="profile-card">' +
          '<div class="profile-header">' +
            '<div class="profile-marker-box"></div>' +
            '<div><h3 class="t-title-1 profile-name">Корова #0142</h3><p class="t-caption t-muted profile-sub">Бирка DEMO-A42 · Казахская белоголовая</p></div>' +
            '<div style="margin-left:auto;" class="profile-status"></div>' +
          '</div>' +
          '<div class="profile-grid">' +
            '<div class="profile-grid-item"><span class="profile-grid-label" data-i18n="profile.pen">Текущий загон</span><span class="profile-grid-val profile-pen">Загон «Северный»</span></div>' +
            '<div class="profile-grid-item"><span class="profile-grid-label" data-i18n="profile.collar">Ошейник</span><span class="profile-grid-val profile-collar">QAM-0001 (Онлайн)</span></div>' +
            '<div class="profile-grid-item"><span class="profile-grid-label" data-i18n="profile.coords">Координаты</span><span class="profile-grid-val num profile-coords">43.6501, 51.1572</span></div>' +
            '<div class="profile-grid-item"><span class="profile-grid-label" data-i18n="profile.lastSeen">Последняя связь</span><span class="profile-grid-val profile-ago">5 мин назад</span></div>' +
          '</div>' +
          '<div style="display:flex; flex-direction:column; gap:var(--space-2); margin-top:var(--space-2);">' +
            '<button type="button" class="btn btn-primary btn-block" data-tab="move"><i data-icon="path" data-size="20"></i> <span data-i18n="profile.btnMove">Перегнать в другой загон</span></button>' +
            '<button type="button" class="btn btn-secondary btn-block" data-act="profile-show-map"><i data-icon="map-trifold" data-size="20"></i> <span data-i18n="profile.btnShowMap">Показать на карте</span></button>' +
          '</div>' +
        '</div>' +
        '<div class="trigger-panel">' +
          '<div style="display:flex; justify-content:space-between; align-items:center;">' +
            '<span class="t-caption cap-strong" data-i18n="profile.testTriggers">Тестирование датчиков ошейника</span>' +
            '<span class="badge badge-ok"><span class="sdot"></span>Тест-режим</span>' +
          '</div>' +
          '<div class="trigger-list">' +
            '<div class="trigger-row">' +
              '<div class="trigger-icon-box"><i data-icon="bell-ringing" data-size="20"></i></div>' +
              '<div class="trigger-info">' +
                '<span class="trigger-title">Звуковой сигнал</span>' +
                '<span class="trigger-sub">0.5 Вт · 800–2400 Гц свип</span>' +
              '</div>' +
              '<button type="button" class="btn btn-secondary btn-sm" data-trigger="sound">Тест звука</button>' +
            '</div>' +
            '<div class="trigger-row">' +
              '<div class="trigger-icon-box"><i data-icon="sliders-horizontal" data-size="20"></i></div>' +
              '<div class="trigger-info">' +
                '<span class="trigger-title">Вибромотор</span>' +
                '<span class="trigger-sub">ERM мотор · 2 секунды</span>' +
              '</div>' +
              '<button type="button" class="btn btn-secondary btn-sm" data-trigger="vibro">Тест вибро</button>' +
            '</div>' +
            '<div class="trigger-row">' +
              '<div class="trigger-icon-box is-danger"><i data-icon="warning" data-size="20"></i></div>' +
              '<div class="trigger-info">' +
                '<span class="trigger-title">Электро-импульс</span>' +
                '<span class="trigger-sub">150 мс · 400 кВ при границе</span>' +
              '</div>' +
              '<button type="button" class="btn btn-danger btn-sm" data-trigger="shock">Импульс</button>' +
            '</div>' +
          '</div>' +
          '<div class="trigger-status-box" style="display:none; padding:var(--space-2); background:var(--surface-0); border-radius:var(--r-sm); font-size:var(--fs-caption); color:var(--primary); align-items:center; gap:var(--space-2);">' +
            '<i data-icon="check-circle" data-size="16"></i> <span class="trigger-msg"></span>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ---------- S7: ALERTS VIEW ---------- */
      '<div class="app-view view-alerts" role="region" aria-label="Оповещения">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
          '<h2 class="t-title-1" data-i18n="nav.alerts">Оповещения</h2>' +
          '<span class="badge badge-danger">3 новых</span>' +
        '</div>' +
        '<div class="filter-pills" role="tablist">' +
          '<button type="button" class="chip is-active" data-alert-filter="new" data-i18n="seg.new">Новые (3)</button>' +
          '<button type="button" class="chip" data-alert-filter="all" data-i18n="seg.all">Все</button>' +
        '</div>' +
        '<div class="stack-3 alerts-feed">' +
          '<div class="alert-card is-danger is-unread" data-alert-id="1">' +
            '<div class="alert-head"><i data-icon="warning" data-size="20"></i><span class="alert-title" data-i18n="alert.leftFence">Вышло за забор</span><span class="alert-time">5 мин назад</span></div>' +
            '<p class="t-body" style="font-weight:600;">Корова #0142 · Загон «Северный»</p>' +
            '<p class="t-caption t-muted">Ошейник QAM-0001 подал предупреждение (звук и вибрация)</p>' +
            '<div class="alert-actions">' +
              '<button type="button" class="btn btn-secondary btn-sm" data-act="alert-show-map" data-animal="0142" data-i18n="alert.show">Показать на карте</button>' +
              '<button type="button" class="btn btn-primary btn-sm" data-tab="move" data-i18n="action.moveHerd">Перегнать</button>' +
              '<button type="button" class="btn btn-tertiary btn-sm" data-act="alert-dismiss" data-i18n="alert.markRead">Прочитано</button>' +
            '</div>' +
          '</div>' +
          '<div class="alert-card is-offline" data-alert-id="2">' +
            '<div class="alert-head"><i data-icon="cloud-slash" data-size="20"></i><span class="alert-title" data-i18n="status.noConnection">Нет связи</span><span class="alert-time">12 мин назад</span></div>' +
            '<p class="t-body" style="font-weight:600;">Корова #0231 · Бирка DEMO-A31</p>' +
            '<p class="t-caption t-muted">Последнее положение у восточной границы</p>' +
            '<div class="alert-actions">' +
              '<button type="button" class="btn btn-secondary btn-sm" data-act="alert-show-map" data-animal="0231" data-i18n="alert.show">Показать на карте</button>' +
              '<button type="button" class="btn btn-tertiary btn-sm" data-act="alert-dismiss" data-i18n="alert.markRead">Прочитано</button>' +
            '</div>' +
          '</div>' +
          '<div class="alert-card is-warning" data-alert-id="3">' +
            '<div class="alert-head"><i data-icon="wifi-slash" data-size="20"></i><span class="alert-title">Ошейники вне зоны Wi-Fi</span><span class="alert-time">25 мин назад</span></div>' +
            '<p class="t-body" style="font-weight:600;">Корова #0410, #0415 (2 животных)</p>' +
            '<p class="t-caption t-muted">Ошейники удерживают виртуальный забор автономно</p>' +
            '<div class="alert-actions">' +
              '<button type="button" class="btn btn-tertiary btn-sm" data-act="alert-dismiss" data-i18n="wifi.ok">Понятно</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ---------- S8: COLLARS VIEW ---------- */
      '<div class="app-view view-collars" role="region" aria-label="Ошейники">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
          '<div><h2 class="t-title-1" data-i18n="collars.title">Ошейники</h2><p class="t-caption t-muted" data-i18n="collars.count" data-p="n=145">Всего: 145 ошейников</p></div>' +
          '<button type="button" class="btn btn-primary btn-sm" data-act="open-pair-wizard" data-i18n="collars.add">+ Добавить ошейник</button>' +
        '</div>' +
        '<div class="list-card">' +
          '<div class="row pad-3" style="display:flex; justify-content:space-between; align-items:center;">' +
            '<div class="row-main">' +
              '<div style="display:flex; align-items:center; gap:var(--space-2);"><span class="row-title num">QAM-0001</span><span class="badge badge-ok"><span class="sdot"></span>Онлайн</span></div>' +
              '<span class="row-sub">Привязан: <strong>Корова #0142</strong> · Wi-Fi -68 dBm · GPS ±4.5м</span>' +
            '</div>' +
            '<button type="button" class="btn btn-tertiary btn-sm" data-act="view-collar-profile" data-animal="0142">Профиль</button>' +
          '</div>' +
          '<div class="row pad-3" style="display:flex; justify-content:space-between; align-items:center;">' +
            '<div class="row-main">' +
              '<div style="display:flex; align-items:center; gap:var(--space-2);"><span class="row-title num">QAM-0002</span><span class="badge badge-ok"><span class="sdot"></span>Онлайн</span></div>' +
              '<span class="row-sub">Привязан: <strong>Корова #0087</strong> · Wi-Fi -72 dBm · GPS ±3.2м</span>' +
            '</div>' +
            '<button type="button" class="btn btn-tertiary btn-sm" data-act="view-collar-profile" data-animal="0087">Профиль</button>' +
          '</div>' +
          '<div class="row pad-3" style="display:flex; justify-content:space-between; align-items:center;">' +
            '<div class="row-main">' +
              '<div style="display:flex; align-items:center; gap:var(--space-2);"><span class="row-title num">QAM-0003</span><span class="badge badge-zone">Свободен</span></div>' +
              '<span class="row-sub">Не привязан к животному · Готов к назначению</span>' +
            '</div>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-act="open-pair-wizard">Привязать</button>' +
          '</div>' +
          '<div class="row pad-3" style="display:flex; justify-content:space-between; align-items:center;">' +
            '<div class="row-main">' +
              '<div style="display:flex; align-items:center; gap:var(--space-2);"><span class="row-title num">QAM-0004</span><span class="badge badge-danger"><span class="sdot"></span>Офлайн</span></div>' +
              '<span class="row-sub">Привязан: <strong>Корова #0231</strong> · Нет связи 12 мин</span>' +
            '</div>' +
            '<button type="button" class="btn btn-tertiary btn-sm" data-act="view-collar-profile" data-animal="0231">Профиль</button>' +
          '</div>' +
        '</div>' +
        '<div class="modal collar-wizard-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:25; align-items:center; justify-content:center; padding:var(--space-3);">' +
          '<div class="profile-card" style="width:100%; max-width:440px; background:var(--surface-1); box-shadow:var(--shadow-modal);">' +
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
              '<h3 class="t-title-2" data-i18n="collars.wizardTitle">Привязка ошейника</h3>' +
              '<button type="button" class="icon-btn" data-act="close-pair-wizard"><i data-icon="x" data-size="20"></i></button>' +
            '</div>' +
            '<div class="field">' +
              '<label class="field-label" data-i18n="collars.enterId">Идентификатор ошейника</label>' +
              '<div class="input"><input type="text" class="wizard-collar-id" value="QAM-0003"></div>' +
            '</div>' +
            '<div class="field">' +
              '<label class="field-label" data-i18n="collars.chooseAnimal">Выберите животное</label>' +
              '<div class="input">' +
                '<select class="wizard-animal-select" style="width:100%; height:calc(52 * var(--u)); background:transparent; border:0; color:var(--ink); font:inherit; outline:none; padding:0 var(--space-2);">' +
                  '<option value="0301" style="background:var(--surface-1); color:var(--ink);">Корова #0301 (бирка DEMO-A01)</option>' +
                  '<option value="0310" style="background:var(--surface-1); color:var(--ink);">Корова #0310 (бирка DEMO-A10)</option>' +
                  '<option value="0322" style="background:var(--surface-1); color:var(--ink);">Корова #0322 (бирка DEMO-A22)</option>' +
                '</select>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex; gap:var(--space-2); margin-top:var(--space-2);">' +
              '<button type="button" class="btn btn-secondary btn-block" data-act="close-pair-wizard" data-i18n="action.cancel">Отмена</button>' +
              '<button type="button" class="btn btn-primary btn-block" data-act="submit-pair" data-i18n="collars.pairButton">Привязать ошейник</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ---------- S9: SETTINGS VIEW ---------- */
      '<div class="app-view view-settings" role="region" aria-label="Настройки">' +
        '<div style="display:flex; align-items:center; justify-content:space-between;">' +
          '<h2 class="t-title-1" data-i18n="settings.title">Настройки</h2>' +
          '<button type="button" class="btn btn-secondary btn-sm" data-act="back-from-settings"><i data-icon="x" data-size="16"></i></button>' +
        '</div>' +
        '<div class="profile-card">' +
          '<span class="cap t-caption cap-strong" data-i18n="settings.farmSection">Параметры фермы</span>' +
          '<div class="field"><label class="field-label" data-i18n="settings.farmName">Название фермы</label><div class="input"><input type="text" value="Ферма Демо (Северный Участок)"></div></div>' +
          '<div class="field"><label class="field-label" data-i18n="settings.farmArea">Площадь пастбищ</label><div class="input"><input type="text" value="1 200 га" readonly></div></div>' +
        '</div>' +
        '<div class="profile-card">' +
          '<span class="cap t-caption cap-strong" data-i18n="settings.usersSection">Доступ и сотрудники</span>' +
          '<div class="list-card">' +
            '<div class="row pad-3" style="display:flex; justify-content:space-between; align-items:center;"><div><p class="t-body" style="font-weight:600;">owner@qamqor.kz</p><p class="t-caption t-muted" data-i18n="settings.ownerRole">Владелец</p></div><span class="badge badge-zone">Полный доступ</span></div>' +
            '<div class="row pad-3" style="display:flex; justify-content:space-between; align-items:center;"><div><p class="t-body" style="font-weight:600;">serik@qamqor.kz</p><p class="t-caption t-muted" data-i18n="settings.workerRole">Работник</p></div><span class="badge badge-ok">Оператор</span></div>' +
          '</div>' +
          '<label class="check-row" style="display:flex; align-items:center; gap:var(--space-2); margin-top:var(--space-2); cursor:pointer;"><input type="checkbox" checked style="width:calc(20 * var(--u)); height:calc(20 * var(--u)); accent-color:var(--primary);"><span class="t-body" data-i18n="settings.workerCanEdit">Работник может изменять границы</span></label>' +
          '<button type="button" class="btn btn-secondary btn-sm" style="margin-top:max(var(--space-1), calc((44px - 36 * var(--u)) / 2));" data-stub="settings.inviteWorker" data-i18n="settings.inviteWorker">+ Пригласить сотрудника</button>' +
        '</div>' +
        '<div class="profile-card">' +
          '<span class="cap t-caption cap-strong" data-i18n="settings.signalsSection">Лимиты и пороги сигналов</span>' +
          '<div class="field"><label class="field-label" data-i18n="settings.soundFreq">Звуковое предупреждение (800–2400 Гц)</label><div class="input"><input type="text" value="0.5 Вт динамик, 15 м до границы" readonly></div></div>' +
          '<div class="field"><label class="field-label" data-i18n="settings.vibroTime">Длительность вибрации</label><div class="input"><input type="text" value="2 сек при 3 м до границы" readonly></div></div>' +
          '<div class="field"><label class="field-label" data-i18n="settings.shockPulse">Импульс воздействия</label><div class="input"><input type="text" value="150 мс, 400 кВ (строго при пересечении)" readonly></div></div>' +
        '</div>' +
        '<div class="profile-card">' +
          '<span class="cap t-caption cap-strong" data-i18n="settings.appLang">Язык интерфейса</span>' +
          '<div class="filter-pills">' +
            '<button type="button" class="chip" data-lang="kk">Қазақша</button>' +
            '<button type="button" class="chip" data-lang="ru">Русский</button>' +
            '<button type="button" class="chip" data-lang="en">English</button>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-danger btn-block" data-act="logout" data-i18n="settings.logout">Выйти из аккаунта</button>' +
      '</div>' +

      /* ---------- S3: DRAW VIEW OVERLAY ---------- */
      '<div class="app-view view-draw" role="region" aria-label="Рисование загона">' +
        '<div class="overlay-toolbar">' +
          '<div><p class="t-body-l" data-i18n="draw.title">Режим рисования загона</p><p class="t-caption t-muted" data-i18n="draw.areaEst">Примерная площадь: ~38.4 га</p></div>' +
          '<div style="display:flex; gap:var(--space-2);">' +
            '<button type="button" class="btn btn-secondary btn-sm" data-act="cancel-draw" data-i18n="draw.cancel">Отмена</button>' +
            '<button type="button" class="btn btn-primary btn-sm" data-act="save-fence" data-i18n="draw.save">Сохранить</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ---------- S4: MOVE HERD OVERLAY ---------- */
      '<div class="app-view view-move" role="region" aria-label="Перегон стада">' +
        '<div class="overlay-toolbar">' +
          '<div><p class="t-body-l" data-i18n="move.title">Перегон стада (24 животных)</p><p class="t-caption t-muted" data-i18n="move.step">Шаг 1 из 2: Выберите загон назначения</p></div>' +
          '<div style="display:flex; gap:var(--space-2);">' +
            '<button type="button" class="btn btn-secondary btn-sm" data-act="cancel-move" data-i18n="action.cancel">Отмена</button>' +
            '<button type="button" class="btn btn-primary btn-sm" data-act="start-steering" data-i18n="move.start">Начать перегон</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ---------- S1: AUTH VIEW ---------- */
      '<div class="app-view view-auth" role="region" aria-label="Вход">' +
        '<div class="profile-card" style="width:100%; max-width:400px; box-shadow:var(--shadow-modal);">' +
          '<div style="text-align:center; margin-bottom:var(--space-2);">' +
            '<h1 class="t-display" style="color:var(--primary); font-size:max(11px, calc(32 * var(--u))); letter-spacing:0.04em;">QAMQOR</h1>' +
            '<p class="t-caption t-muted" data-i18n="auth.sub">Умный спутниковый выпас скота</p>' +
          '</div>' +
          '<div class="field"><label class="field-label" data-i18n="field.email">Email</label><div class="input"><input type="email" value="owner@qamqor.kz"></div></div>' +
          '<div class="field"><label class="field-label" data-i18n="field.password">Пароль</label><div class="input"><input type="password" value="••••••••••••"></div></div>' +
          '<button type="button" class="btn btn-primary btn-block" data-act="do-login" data-i18n="auth.loginBtn" style="margin-top:var(--space-2);">Войти в систему</button>' +
          '<div style="display:flex; justify-content:space-between; font-size:var(--fs-caption); margin-top:var(--space-2);">' +
            '<a href="#" class="t-muted hit-link" data-stub="auth.forgot" data-i18n="auth.forgot">Забыли пароль?</a>' +
            '<a href="#" class="hit-link" style="color:var(--primary); font-weight:600;" data-stub="auth.createFarm" data-i18n="auth.createFarm">Создать ферму</a>' +
          '</div>' +
          '<div class="filter-pills" style="justify-content:center; margin-top:var(--space-3);">' +
            '<button type="button" class="chip" data-lang="kk">Қазақша</button>' +
            '<button type="button" class="chip" data-lang="ru">Русский</button>' +
            '<button type="button" class="chip" data-lang="en">English</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      bottomnavHTML(navLabel, "map") +
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
    app.setAttribute("data-view", opts.view || "map");
    app.setAttribute("data-scheme", "sat");
    app.innerHTML = html(id, opts.name || String(id));
    M.hydrateIcons(app);
    M.applyI18n(app);
    wire(app);
    app.setState(app.getAttribute("data-state"));
    app.setSheet(app.getAttribute("data-sheet"));
    app.setView(app.getAttribute("data-view"), null, true);
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
      if (a) { b.innerHTML = markerInner(a, wifi); }
    });
    refreshMarkers(app);
  }

  function renderSelChip(app) {
    var old = app.querySelector(".selchip");
    if (old) { old.remove(); }
    var id = app.getAttribute("data-mini");
    if (!id) { return; }
    var a = ANIMALS.filter(function (x) { return x.id === id; })[0];
    if (!a) { return; }
    var st = app.getAttribute("data-state") === "wifi" ? "offline" : a.st;
    var chip = document.createElement("div");
    chip.className = "selchip";
    chip.setAttribute("aria-hidden", "true");
    chip.style.cssText = "--x:" + a.x + ";--y:" + a.y;
    chip.innerHTML = '<div class="t"><span data-i18n="animal.prefix"></span>' + a.id + '</div><div class="s">' + M.badgeHTML(BADGE_KIND[st]).replace("badge ", "badge badge-chip ") + ' <span data-i18n="time.ago" data-p="n=' + a.ago + '"></span></div>';
    app.querySelector(".map-world").appendChild(chip);
    M.applyI18n(chip);
  }

  function renderMini(app) {
    var box = app.querySelector(".mini");
    var id = app.getAttribute("data-mini");
    renderSelChip(app);
    if (!id) { box.innerHTML = ""; return; }
    var a = ANIMALS.filter(function (x) { return x.id === id; })[0];
    if (!a) { return; }
    var st = app.getAttribute("data-state") === "wifi" ? "offline" : a.st;
    box.innerHTML =
      '<button type="button" class="icon-btn mini-close" data-act="mini-close" data-i18n-attr="aria-label:mini.close"><i data-icon="x" data-size="24"></i></button>' +
      '<div class="mini-head">' + M.markerSVG(st, { size: 40, nofence: a.nofence }) +
      '<div><p class="t-body-l mini-name"><span data-i18n="animal.prefix"></span>' + a.id + "</p>" +
      '<p class="t-caption t-muted"><span data-i18n="tag.sample" data-p="n=' + a.id.slice(-2) + '"></span> · <span data-i18n="time.ago" data-p="n=' + a.ago + '"></span></p></div></div>' +
      "<div>" + M.badgeHTML(BADGE_KIND[st]) + "</div>" +
      '<div class="mini-actions"><button type="button" class="btn btn-secondary" data-act="open-profile" data-animal="' + a.id + '" data-i18n="mini.profile"></button>' +
      '<button type="button" class="btn btn-primary perm" data-write data-tab="move" data-i18n="mini.pick"></button></div>';
    M.hydrateIcons(box);
    M.applyI18n(box);
    var s = app.getAttribute("data-state");
    var off = s === "offline" || s === "error";
    box.querySelectorAll("[data-write]").forEach(function (b) { b.disabled = off; });
  }

  function updateNavState(app, view) {
    var effectiveView = view === "profile" ? "herd" : view;
    var idx = NAV_ORDER.indexOf(effectiveView);
    var bnav = app.querySelector(".bottomnav");
    if (bnav) {
      if (idx >= 0) {
        bnav.classList.remove("has-no-active-tab");
        bnav.style.setProperty("--i", idx);
      } else {
        bnav.classList.add("has-no-active-tab");
      }
    }
    app.querySelectorAll(".nav-item[data-tab]").forEach(function (item) {
      var tab = item.getAttribute("data-tab");
      var active = tab === effectiveView || (tab === "settings" && view === "settings");
      if (active) {
        item.setAttribute("aria-current", "page");
      } else {
        item.removeAttribute("aria-current");
      }
      var iconName = NAV_ICONS[tab];
      var iconSpan = item.querySelector(".nav-icon");
      if (iconName && iconSpan) {
        var badge = (tab === "alerts") ? '<span class="nav-badge" aria-hidden="true">3</span>' : '';
        iconSpan.innerHTML = M.ic(iconName, 26, "", active ? "fill" : "regular") + badge;
      }
    });
  }

  function triggerDroplet(app, destView, event, callback) {
    var droplet = app.querySelector(".app-droplet");
    if (!droplet || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      app.setAttribute("data-view", destView);
      updateNavState(app, destView);
      if (callback) callback();
      document.dispatchEvent(new CustomEvent("appviewchange", { detail: destView }));
      return;
    }

    if (app._dropBusy) {
      clearTimeout(app._dropT1);
      clearTimeout(app._dropT2);
      clearTimeout(app._dropT3);
    }
    app._dropBusy = true;

    // Immediate tactile feedback on navigation indicator
    updateNavState(app, destView);

    var rect = app.getBoundingClientRect();
    var x, y;
    if (event && typeof event.clientX === "number" && event.clientX > 0) {
      x = Math.round(event.clientX - rect.left);
      y = Math.round(event.clientY - rect.top);
    } else if (event && event.target && event.target.getBoundingClientRect) {
      var tRect = event.target.getBoundingClientRect();
      x = Math.round(tRect.left + tRect.width / 2 - rect.left);
      y = Math.round(tRect.top + tRect.height / 2 - rect.top);
    } else {
      x = Math.round((rect.width || 375) / 2);
      y = Math.round((rect.height || 812) / 2);
    }

    x = Math.max(0, Math.min(rect.width || 375, x));
    y = Math.max(0, Math.min(rect.height || 812, y));
    var maxR = Math.ceil(Math.hypot(Math.max(x, (rect.width || 375) - x), Math.max(y, (rect.height || 812) - y))) + 40;

    // Reset to start state at exact click point (radius 0px)
    droplet.className = "app-droplet";
    droplet.style.setProperty("--drop-x", x + "px");
    droplet.style.setProperty("--drop-y", y + "px");
    droplet.style.setProperty("--drop-r", maxR + "px");
    void droplet.offsetWidth; // Force synchronous reflow so start is registered

    // Expand white circle to cover the screen
    droplet.className = "app-droplet is-expanding";

    // When circle fully covers the screen (320ms): switch view underneath!
    app._dropT1 = setTimeout(function () {
      app.setAttribute("data-view", destView);
      var newView = app.querySelector('.view-' + destView);
      if (newView) {
        newView.scrollTop = 0;
        newView.classList.remove("is-entering");
        void newView.offsetWidth;
        newView.classList.add("is-entering");
      }
      if (callback) callback();
      document.dispatchEvent(new CustomEvent("appviewchange", { detail: destView }));
    }, 320);

    // After switching under the white cover, dissolve the droplet to reveal the new page
    app._dropT2 = setTimeout(function () {
      droplet.className = "app-droplet is-dissolving";
    }, 350);

    // Reset idle state
    app._dropT3 = setTimeout(function () {
      droplet.className = "app-droplet";
      app._dropBusy = false;
    }, 600);
  }

  var SHEET_ORDER = ["peek", "half", "full"];
  var OUTSIDE = ".banner, .topbar, .rail, .map-pill, .updated-plate, .map, .fabs, .bottomnav, .wifi-plate";

  function wire(app) {
    var sheet = app.querySelector(".sheet");
    var head = app.querySelector(".sheet-head");
    var title = app.querySelector(".sheet-title");
    var handle = app.querySelector('[data-act="handle"]');
    var opener = null;

    function isModal() { return app.getAttribute("data-sheet") === "full" && window.getComputedStyle(sheet).position === "fixed"; }

    app.setState = function (st) {
      if (STATES.indexOf(st) < 0) { return; }
      app.setAttribute("data-state", st);
      var off = st === "offline" || st === "error";
      app.querySelectorAll(".perm button[data-write]").forEach(function (b) { b.disabled = off; });
      app.querySelectorAll(".banner").forEach(function (b) { b.setAttribute("aria-hidden", "true"); });
      var activeBanner = st === "offline" ? app.querySelector(".banner-offline") : (st === "error" ? app.querySelector(".banner-server") : null);
      if (activeBanner) { activeBanner.removeAttribute("aria-hidden"); }
      var wifiPlate = app.querySelector(".wifi-plate");
      if (wifiPlate) { wifiPlate.style.display = st === "wifi" ? "flex" : "none"; }
      restyleMarkers(app);
      renderMini(app);
    };

    app.setSheet = function (s, focus) {
      if (SHEET_ORDER.indexOf(s) < 0) { return; }
      var prev = app.getAttribute("data-sheet");
      app.setAttribute("data-sheet", s);
      var modal = isModal();
      sheet.setAttribute("role", modal ? "dialog" : "region");
      if (modal) {
        sheet.setAttribute("aria-modal", "true");
        app.querySelectorAll(OUTSIDE).forEach(function (el) { el.setAttribute("aria-hidden", "true"); });
      } else {
        sheet.removeAttribute("aria-modal");
        app.querySelectorAll(OUTSIDE).forEach(function (el) { el.removeAttribute("aria-hidden"); });
      }
      var next = s === "full" ? "sheet.collapse" : "sheet.expand";
      handle.setAttribute("data-i18n-attr", "aria-label:" + next); handle.setAttribute("aria-label", M.t(next));
      if (focus && modal && prev !== "full") { opener = document.activeElement; title.focus(); }
      if (focus && !modal && prev === "full") { var back = opener && app.contains(opener) ? opener : handle; back.focus(); opener = null; }
    };

    app.setView = function (view, event, immediate) {
      if (app.getAttribute("data-view") === view) { return; }
      var curView = app.getAttribute("data-view");
      if (curView !== "profile" && curView !== "settings") {
        app._prevView = curView;
      }
      if (immediate) {
        app.setAttribute("data-view", view);
        updateNavState(app, view);
        var preview = app.querySelector(".pen-draw-preview");
        var route = app.querySelector(".pen-route-preview");
        if (preview) { preview.style.display = view === "draw" ? "block" : "none"; }
        if (route) { route.style.display = view === "move" ? "block" : "none"; }
        return;
      }
      triggerDroplet(app, view, event, function () {
        var preview = app.querySelector(".pen-draw-preview");
        var route = app.querySelector(".pen-route-preview");
        if (preview) { preview.style.display = view === "draw" ? "block" : "none"; }
        if (route) { route.style.display = view === "move" ? "block" : "none"; }
      });
    };

    app.showProfile = function (animalId, event) {
      app._prevView = app.getAttribute("data-view") || "herd";
      var a = ANIMALS.filter(function (x) { return x.id === animalId; })[0] || ANIMALS[0];
      var pView = app.querySelector(".view-profile");
      if (!pView) { return; }
      pView.querySelector(".profile-name").textContent = "Корова #" + a.id;
      pView.querySelector(".profile-sub").textContent = "Бирка " + a.tag + " · " + (a.breed || "Казахская белоголовая");
      pView.querySelector(".profile-pen").textContent = a.pen || "Загон «Северный»";
      pView.querySelector(".profile-collar").textContent = a.collar + (a.st === "offline" ? " (Офлайн)" : " (Онлайн)");
      pView.querySelector(".profile-coords").textContent = a.lat + ", " + a.lng;
      pView.querySelector(".profile-ago").textContent = a.ago + " мин назад";
      pView.querySelector(".profile-marker-box").innerHTML = M.markerSVG(a.st, { size: 48, nofence: a.nofence });
      pView.querySelector(".profile-status").innerHTML = M.badgeHTML(BADGE_KIND[a.st]);
      pView.setAttribute("data-animal", a.id);
      app.setView("profile", event);
    };

    app.filterHerd = function (st) {
      app.querySelectorAll(".filter-pills [data-herd-filter]").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-herd-filter") === st);
      });
      var container = app.querySelector(".herd-items-container");
      var filtered = st === "all" ? ANIMALS : ANIMALS.filter(function (a) { return a.st === st; });
      container.innerHTML = renderHerdRows(filtered);
      M.hydrateIcons(container);
    };

    app.refresh = function () { refreshMarkers(app); renderMini(app); app.setSheet(app.getAttribute("data-sheet")); };

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

    /* ---------- Delegated Click Events ---------- */
    app.addEventListener("click", function (e) {
      var tab = e.target.closest("[data-tab]");
      var act = e.target.closest("[data-act]");
      var mk = e.target.closest(".mk[data-animal]");
      var row = e.target.closest(".herd-row");
      var sumTile = e.target.closest(".sum-tile[data-filter]");
      var connBtn = e.target.closest(".conn-btn");
      var gearBtn = e.target.closest(".gear-btn");
      var herdFilter = e.target.closest("[data-herd-filter]");
      var triggerBtn = e.target.closest("[data-trigger]");
      var menu = app.querySelector(".menu");

      if (tab) {
        e.preventDefault();
        var dest = tab.getAttribute("data-tab");
        app.setView(dest, e);
        if (dest === "herd" && tab.hasAttribute("data-filter")) {
          app.filterHerd(tab.getAttribute("data-filter"));
        }
        return;
      }

      if (connBtn) {
        e.preventDefault();
        app.setView("herd", e);
        app.filterHerd("offline");
        return;
      }

      if (gearBtn) {
        e.preventDefault();
        app.setView("settings", e);
        return;
      }

      if (sumTile) {
        e.preventDefault();
        app.setView("herd", e);
        app.filterHerd(sumTile.getAttribute("data-filter"));
        return;
      }

      if (herdFilter) {
        app.filterHerd(herdFilter.getAttribute("data-herd-filter"));
        return;
      }

      if (row && !e.target.closest(".herd-check")) {
        app.showProfile(row.getAttribute("data-animal"), e);
        return;
      }

      if (triggerBtn) {
        var trig = triggerBtn.getAttribute("data-trigger");
        var animalId = app.querySelector(".view-profile").getAttribute("data-animal") || "0142";
        var a = ANIMALS.filter(function (x) { return x.id === animalId; })[0] || ANIMALS[0];
        var box = app.querySelector(".trigger-status-box");
        var msg = box.querySelector(".trigger-msg");
        box.style.display = "flex";
        if (trig === "sound") {
          msg.textContent = "Сирена MAX98357 0.5W воспроизведена на ошейнике " + a.collar + " (800–2400 Гц)";
          try {
            var AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
              var ctx = new AudioCtx();
              var osc = ctx.createOscillator();
              var gain = ctx.createGain();
              osc.type = "sine";
              osc.frequency.setValueAtTime(800, ctx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.35);
              gain.gain.setValueAtTime(0.12, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.start();
              osc.stop(ctx.currentTime + 0.4);
            }
          } catch (err) {}
          M.stub(app, "Ошейник " + a.collar + ": звуковой сигнал 0.5 Вт подан");
        } else if (trig === "vibro") {
          msg.textContent = "Вибромотор ошейника " + a.collar + " запущен на 2 секунды";
          if (navigator.vibrate) { navigator.vibrate([200, 100, 200]); }
          M.stub(app, "Ошейник " + a.collar + ": вибромотор активирован на 2 с");
        } else if (trig === "shock") {
          msg.textContent = "Импульс 150мс (400 кВ) подан на контакты ошейника " + a.collar;
          M.stub(app, "Ошейник " + a.collar + ": тестовый импульс 150 мс передан");
        }
        return;
      }

      if (act) {
        var a = act.getAttribute("data-act");
        if (a === "handle") {
          var cur = SHEET_ORDER.indexOf(app.getAttribute("data-sheet"));
          app.setSheet(SHEET_ORDER[(cur + 1) % 3], true);
        } else if (a === "scheme") {
          var on = app.getAttribute("data-scheme") !== "scheme";
          app.setAttribute("data-scheme", on ? "scheme" : "sat");
          act.setAttribute("aria-pressed", on ? "true" : "false");
          var key = on ? "map.placeholderScheme" : "map.placeholder";
          app.querySelector(".attrib").setAttribute("data-i18n", key);
          app.querySelector(".map").setAttribute("data-i18n-attr", "aria-label:" + (on ? "map.placeholderScheme" : "map.label"));
          M.applyI18n(app);
        } else if (a === "mini-close") {
          app.removeAttribute("data-mini");
          app.querySelectorAll(".mk-selected").forEach(function (x) { x.classList.remove("mk-selected"); });
          renderMini(app);
        } else if (a === "wifi-ok") {
          app.setAttribute("data-wifi-dismissed", "");
        } else if (a === "open-profile") {
          app.showProfile(act.getAttribute("data-animal"), e);
        } else if (a === "back-from-profile") {
          app.setView(app._prevView || "herd", e);
        } else if (a === "back-from-settings") {
          app.setView(app._prevView || "map", e);
        } else if (a === "profile-show-map") {
          var id = app.querySelector(".view-profile").getAttribute("data-animal");
          app.setView("map", e);
          var m = app.querySelector('.mk[data-animal="' + id + '"]');
          if (m) {
            app.querySelectorAll(".mk-selected").forEach(function (x) { x.classList.remove("mk-selected"); });
            m.classList.add("mk-selected");
            app.setAttribute("data-mini", id);
            renderMini(app);
            app.setSheet("half");
          }
        } else if (a === "alert-show-map") {
          var id = act.getAttribute("data-animal");
          app.setView("map", e);
          var m = app.querySelector('.mk[data-animal="' + id + '"]');
          if (m) {
            app.querySelectorAll(".mk-selected").forEach(function (x) { x.classList.remove("mk-selected"); });
            m.classList.add("mk-selected");
            app.setAttribute("data-mini", id);
            renderMini(app);
            app.setSheet("half");
          }
        } else if (a === "alert-dismiss") {
          var card = act.closest(".alert-card");
          if (card) { card.style.opacity = "0.4"; card.style.pointerEvents = "none"; }
        } else if (a === "view-collar-profile") {
          app.showProfile(act.getAttribute("data-animal"), e);
        } else if (a === "open-pair-wizard") {
          var modal = app.querySelector(".collar-wizard-modal");
          if (modal) { modal.style.display = "flex"; }
        } else if (a === "close-pair-wizard") {
          var modal = app.querySelector(".collar-wizard-modal");
          if (modal) { modal.style.display = "none"; }
        } else if (a === "submit-pair") {
          var modal = app.querySelector(".collar-wizard-modal");
          var cid = modal.querySelector(".wizard-collar-id").value;
          var sel = modal.querySelector(".wizard-animal-select").value;
          modal.style.display = "none";
          M.stub(app, "Ошейник " + cid + " успешно привязан к Корове #" + sel);
        } else if (a === "save-fence") {
          app.setView("map", e);
          M.stub(app, "Граница загона сохранена и передана на ошейники");
        } else if (a === "cancel-draw") {
          app.setView("map", e);
        } else if (a === "start-steering") {
          app.setView("map", e);
          M.stub(app, "Перегон стада запущен: звуковой коридор активирован");
        } else if (a === "cancel-move") {
          app.setView("map", e);
        } else if (a === "logout") {
          app.setView("auth", e);
        } else if (a === "do-login") {
          app.setView("map", e);
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

    /* Live Herd Search Input */
    var searchInput = app.querySelector(".herd-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        var query = searchInput.value.trim().toLowerCase();
        var filtered = ANIMALS.filter(function (a) {
          return a.id.indexOf(query) >= 0 || a.tag.toLowerCase().indexOf(query) >= 0 || a.pen.toLowerCase().indexOf(query) >= 0;
        });
        var container = app.querySelector(".herd-items-container");
        container.innerHTML = renderHerdRows(filtered);
        M.hydrateIcons(container);
      });
    }

    /* Batch Selection Toggle */
    var selectToggle = app.querySelector(".herd-select-toggle");
    if (selectToggle) {
      selectToggle.addEventListener("click", function () {
        var bar = app.querySelector(".herd-action-bar");
        var checks = app.querySelectorAll(".herd-check");
        var on = bar.style.display === "none";
        bar.style.display = on ? "flex" : "none";
        checks.forEach(function (c) { c.style.display = on ? "inline-block" : "none"; });
        selectToggle.classList.toggle("btn-primary", on);
        selectToggle.classList.toggle("btn-secondary", !on);
      });
    }

    app.addEventListener("change", function (e) {
      if (e.target.classList.contains("herd-check")) {
        var n = app.querySelectorAll(".herd-check:checked").length;
        app.querySelector(".herd-selected-count").textContent = "Выбрано: " + n;
      }
    });

    app.addEventListener("keydown", function (e) {
      var menu = app.querySelector(".menu");
      if (e.key === "Escape") {
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

  document.addEventListener("langchange", function () {
    document.querySelectorAll(".app").forEach(function (app) { if (app.refresh) { app.refresh(); } });
  });
  window.addEventListener("resize", function () {
    document.querySelectorAll(".app").forEach(function (app) { if (app.refresh) { app.refresh(); } });
  });

  window.MAPAPP = { build: build, topbarHTML: topbarHTML, railHTML: railHTML, bottomnavHTML: bottomnavHTML, STATES: STATES, ANIMALS: ANIMALS };
})();
