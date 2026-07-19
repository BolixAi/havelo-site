// Havelo – live marknadssök (serverless).
// Hämtar annonser server-side från källor vi kan nå (boat24, Wayke)
// och returnerar strukturerad JSON till frontend.
// Anropas som: /.netlify/functions/search?category=Båt&q=brig
// Debug (se vad servern faktiskt får tillbaka): ?category=Båt&debug=1

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function json(obj, code = 200) {
  return {
    statusCode: code,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
    body: JSON.stringify(obj),
  };
}

function sourceFor(category, q) {
  if (category === "Bil")
    return { kalla: "Wayke", url: "https://www.wayke.se/sok?q=" + encodeURIComponent(q || "bil") };
  // default: båt
  return { kalla: "boat24", url: "https://www.boat24.com/se/gummibatar/ribbat/?typ=2103" };
}

// ---- robust parsning: JSON-LD först, annars heuristik ----
function parseJsonLd(html, category, kalla) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch (e) { continue; }
    collect(data, out, category, kalla);
  }
  return out;
}
function num(v) {
  if (v == null) return null;
  const n = parseInt(String(v).replace(/[^\d]/g, ""), 10);
  return isNaN(n) ? null : n;
}
function collect(node, out, category, kalla) {
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out, category, kalla)); return; }
  if (!node || typeof node !== "object") return;
  if (node.itemListElement) collect(node.itemListElement, out, category, kalla);
  if (node.item) collect(node.item, out, category, kalla);
  const type = String(node["@type"] || "");
  if (/Product|Vehicle|Car|Boat|Offer|IndividualProduct/i.test(type)) {
    const offer = node.offers && !Array.isArray(node.offers) ? node.offers : (Array.isArray(node.offers) ? node.offers[0] : {});
    const titel = node.name || node.model || node.title;
    const url = node.url || (offer && offer.url);
    const pris = num((offer && offer.price) || node.price);
    if (titel && (url || pris)) {
      out.push({
        titel: String(titel).slice(0, 90),
        kategori: category,
        pris,
        arsmodell: num(node.productionDate || node.modelDate || node.releaseDate) || null,
        plats: (offer && offer.availableAtOrFrom && offer.availableAtOrFrom.name) || null,
        url: url || null,
        kalla,
      });
    }
  }
}
// heuristik för boat24 om JSON-LD saknas: fånga detaljlänkar
function parseBoat24(html) {
  const out = [];
  const seen = new Set();
  const re = /href="(https:\/\/www\.boat24\.com\/se\/gummibatar\/[^"]*?\/detail\/\d+\/)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const parts = m[1].split("/").filter(Boolean);
    const slug = parts[parts.length - 2] || "";
    out.push({
      titel: decodeURIComponent(slug).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      kategori: "Båt",
      pris: null,
      arsmodell: null,
      plats: null,
      url: m[1],
      kalla: "boat24",
    });
  }
  return out;
}

exports.handler = async (event) => {
  const p = (event && event.queryStringParameters) || {};
  const category = p.category || "Båt";
  const q = (p.q || "").toLowerCase().trim();
  const debug = p.debug === "1";
  const { kalla, url } = sourceFor(category, q);

  let res, html;
  try {
    res = await fetch(url, { headers: HEADERS });
    html = await res.text();
  } catch (e) {
    return json({ ok: false, error: "fetch misslyckades: " + String(e), source: kalla, url }, 502);
  }

  if (debug) {
    return json({
      ok: true, source: kalla, url, httpStatus: res.status,
      htmlLength: html.length,
      hasJsonLd: /application\/ld\+json/.test(html),
      sample: html.slice(0, 2500),
    });
  }

  let items = parseJsonLd(html, category, kalla);
  if (!items.length && kalla === "boat24") items = parseBoat24(html);
  if (q) items = items.filter((i) => (i.titel + " " + (i.plats || "")).toLowerCase().includes(q));

  return json({
    ok: true, source: kalla, httpStatus: res.status,
    count: items.length,
    note: items.length ? undefined : "Inga poster tolkades. Kör ?debug=1 för att se vad källan returnerar.",
    items: items.slice(0, 40),
  });
};
