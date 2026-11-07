/* Strings parity check. Run from anywhere: node strings-parity.js   (exit 1 on a real error)
   - ru and en must have the same keys; kk must be a subset of ru
   - placeholders {x} must match between ru/en/kk for every key present
   - every key referenced from html/js must exist in ru
   - reports the kk gap (product keys that fall back to ru) */
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.resolve(__dirname, "..");
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "assets/strings.js"), "utf8"), ctx);
const S = ctx.window.STRINGS, ru = Object.keys(S.ru), en = Object.keys(S.en), kk = Object.keys(S.kk);
let errors = 0; const out = [];
const log = (m) => out.push(m), err = (m) => { errors++; out.push("ERROR " + m); };
ru.filter(k => !S.en[k]).forEach(k => err("key in ru but not in en: " + k));
en.filter(k => !S.ru[k]).forEach(k => err("key in en but not in ru: " + k));
kk.filter(k => !S.ru[k]).forEach(k => err("key in kk but not in ru: " + k));
const ph = s => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");
ru.forEach(k => { ["en", "kk"].forEach(l => { if (S[l][k] !== undefined && ph(S[l][k]) !== ph(S.ru[k])) err("placeholder mismatch " + l + " " + k + ": " + ph(S[l][k]) + " vs " + ph(S.ru[k])); }); });
// keys used in markup/scripts
const prefixes = new Set(ru.map(k => k.split(".")[0]));
const files = []; (function walk(d) { fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["fonts", "icons", "qa"].includes(e.name)) walk(p); } else if (/\.(html|js)$/.test(e.name) && e.name !== "strings.js" && e.name !== "icons.js") files.push(p); }); })(root);
const used = new Set();
files.forEach(f => { const t = fs.readFileSync(f, "utf8"); (t.match(/["'@:;|][a-zA-Z]+(?:\.[A-Za-z0-9]+)+(?=["';|])/g) || []).forEach(m => { const k = m.slice(1); if (prefixes.has(k.split(".")[0]) && !/\.(html|js|css|ttf|svg|png|txt)$/.test(k)) used.add(k); }); });
[...used].filter(k => !S.ru[k]).forEach(k => err("key used in code but missing in ru: " + k));
const unused = ru.filter(k => !used.has(k) && !k.startsWith("mk.st.") ); 
const product = ru.filter(k => !k.startsWith("mk."));
const gap = product.filter(k => S.kk[k] === undefined);
log("keys: ru " + ru.length + ", en " + en.length + ", kk " + kk.length);
log("product keys (non-mk): " + product.length + "; kk present: " + (product.length - gap.length) + "; kk falls back to ru: " + gap.length);
log("referenced keys found in code: " + used.size);
log("ru keys never referenced by a literal in code (may be dynamic): " + unused.join(", "));
log("kk missing product keys: " + gap.join(", "));
log(errors ? errors + " error(s)" : "no errors");
console.log(out.join("\n")); process.exit(errors ? 1 : 0);
