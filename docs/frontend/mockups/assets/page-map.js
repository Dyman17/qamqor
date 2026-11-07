/* Page script for screen-map.html: builds the device frames and wires the mockup control panel. */
(function () {
  "use strict";
  var M = window.MOCK;
  var q = new URLSearchParams(window.location.search);
  var embed = q.get("embed") === "1";
  var apps = [];

  var FRAMES = [
    { id: "p320", w: 320, h: 640, key: "mk.frame.phone320", phone: true },
    { id: "p375", w: 375, h: 812, key: "mk.frame.phone375", phone: true, safe: true },
    { id: "t1366", w: 1366, h: 1024, key: "mk.frame.tablet", phone: false }
  ];

  var state = q.get("state") || "normal";
  var sheet = q.get("sheet") || "peek";
  var role = q.get("role") || "owner";

  function frame(def, container) {
    var wrap = document.createElement("section");
    wrap.className = "mk-frame-wrap";
    wrap.setAttribute("data-frame", def.id);
    wrap.innerHTML = '<h2 data-i18n="' + def.key + '"></h2><div class="mk-scroll"></div>';
    var dev = document.createElement("div");
    dev.className = "device";
    dev.style.setProperty("--w", def.w + "px");
    dev.style.setProperty("--h", def.h + "px");
    if (def.safe) { dev.setAttribute("data-safe-b", ""); }
    dev.setAttribute("data-device", def.phone ? "phone" : "tablet");
    var app = MAPAPP.build({ state: state, sheet: sheet, role: role, name: def.id });
    dev.appendChild(app);
    wrap.querySelector(".mk-scroll").appendChild(dev);
    container.appendChild(wrap);
    app.refresh();   // modal semantics depend on layout, so evaluate once the frame is in the document
    apps.push({ app: app, phone: def.phone, wrap: wrap });
  }

  if (embed) {
    document.getElementById("chrome").remove();   // embed: the frame is the whole page (and its <main>)
    document.body.style.margin = "0";
    var skip = document.querySelector(".mk-skip");
    if (skip) { skip.remove(); }
    var dev = document.createElement("main");   // the one main landmark of the embedded page
    dev.className = "device is-embed";
    if (window.innerWidth < 768 && window.innerHeight >= 800) { dev.setAttribute("data-safe-b", ""); }
    var app = MAPAPP.build({ state: state, sheet: sheet, role: role, name: "embed" });
    dev.appendChild(app);
    document.body.appendChild(dev);
    app.refresh();
    apps.push({ app: app, phone: window.innerWidth < 768 });
  } else {
    var frames = document.getElementById("frames");
    var only = q.get("only");   // QA helper: ?only=p320|p375|t1366 shows a single frame at the page origin
    if (only) { document.body.classList.add("is-only"); }
    FRAMES.forEach(function (d) { if (!only || only === d.id) { frame(d, frames); } });

    document.getElementById("panel").addEventListener("change", function (e) {
      var n = e.target.name, v = e.target.value;
      apps.forEach(function (a) {
        if (n === "state") { a.app.setState(v); }
        else if (n === "sheet" && a.phone) { a.app.setSheet(v); }
        else if (n === "role") { a.app.setRole(v); }
        else if (n === "scale") { a.wrap.querySelector(".mk-scroll").style.zoom = v; }
      });
    });
    // apply URL-provided initial values to the radios
    ["state", "sheet", "role"].forEach(function (n) {
      var v = { state: state, sheet: sheet, role: role }[n];
      var r = document.querySelector('input[name="' + n + '"][value="' + v + '"]');
      if (r) { r.checked = true; }
    });
  }

  M.hydrateIcons(document);
  M.init();
})();
