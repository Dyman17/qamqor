/* Page script for index.html: device-size switcher that renders a mockup in an iframe of the chosen size. */
(function () {
  "use strict";
  var M = window.MOCK;
  var form = document.getElementById("stage-panel");
  var holder = document.getElementById("holder");
  var frame = document.getElementById("frame");
  var box = document.getElementById("stage-box");
  var link = document.getElementById("open-link");
  var lastSrc = "";

  function render() {
    var page = form.elements.page.value;
    var size = form.elements.size.value.split("x");
    var w = parseInt(size[0], 10), h = parseInt(size[1], 10);
    var fit = form.elements.fit.checked;
    var avail = Math.max(240, box.clientWidth - 34);
    var k = fit ? Math.min(1, avail / w) : 1;
    holder.style.width = Math.round(w * k) + "px";
    holder.style.height = Math.round(h * k) + "px";
    frame.style.width = w + "px";
    frame.style.height = h + "px";
    frame.style.transform = "scale(" + k + ")";
    var src = page + "?embed=1&lang=" + M.getLang();
    if (src !== lastSrc) { frame.src = src; lastSrc = src; }
    frame.title = page + " " + w + "x" + h;
    link.href = page + "?lang=" + M.getLang();
  }

  form.addEventListener("change", render);
  window.addEventListener("resize", render);
  document.addEventListener("langchange", render);
  M.hydrateIcons(document);
  M.init();
  render();
})();
