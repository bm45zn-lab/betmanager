const BUILD = "challenge-betclic-propline-2026-11-14";

let bestCache = { at: 0, data: null };
const BEST_CACHE_MS = 5 * 60 * 1000;

function decimalOdds(outcome) {
  if (outcome.price_decimal !== undefined && outcome.price_decimal !== null) {
    const value = Number(outcome.price_decimal);
    return Number.isFinite(value) && value > 1 ? value : null;
  }
  const price = Number(outcome.price);
  if (!Number.isFinite(price) || price === 0) return null;
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

async function providerGet(url, key) {
  const response = await fetch(url, {
    method: "GET",
    headers: { "X-API-Key": key, "Accept": "application/json" }
  });
  const data = await response.json();
  if (!response.ok) throw new Error("PropLine HTTP " + response.status);
  return data;
}

async function findBestPick(key) {
  if (bestCache.data && Date.now() - bestCache.at < BEST_CACHE_MS) return bestCache.data;

  const sportsData = await providerGet("https://api.prop-line.com/v1/sports", key);
  const sports = (Array.isArray(sportsData) ? sportsData : (Array.isArray(sportsData.sports) ? sportsData.sports : []))
    .filter(item => item.active !== false && /^soccer_[a-z0-9_]+$/.test(String(item.key || "")));

  const now = Date.now();
  const cutoff = now + 24 * 60 * 60 * 1000;
  const candidates = [];
  let scanned = 0;
  let eventCount = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < sports.length) {
      const sport = sports[cursor++];
      try {
        const url = new URL("https://api.prop-line.com/v1/sports/" + encodeURIComponent(sport.key) + "/odds");
        url.searchParams.set("bookmakers", "betclic_pt");
        url.searchParams.set("markets", "h2h,totals,spreads");
        const data = await providerGet(url, key);
        scanned++;
        const events = Array.isArray(data) ? data : (Array.isArray(data.events) ? data.events : []);
        eventCount += events.length;
        for (const event of events) {
          const kickoff = Date.parse(event.commence_time || "");
          if (!Number.isFinite(kickoff) || kickoff < now || kickoff > cutoff) continue;
          const book = (event.bookmakers || []).find(item => item.key === "betclic_pt");
          for (const market of (book?.markets || [])) {
            const outcomes = (market.outcomes || []).map(outcome => ({outcome, odds: decimalOdds(outcome)})).filter(item => item.odds && item.odds > 1);
            if (outcomes.length < 2) continue;
            const impliedTotal = outcomes.reduce((sum, item) => sum + 1 / item.odds, 0);
            for (const item of outcomes) {
              if (item.odds < 1.75 || item.odds > 2.00) continue;
              const probability = (1 / item.odds) / impliedTotal;
              candidates.push({
                sport_key: sport.key,
                sport_title: sport.title || sport.key,
                event_id: event.id,
                home_team: event.home_team || "Casa",
                away_team: event.away_team || "Fora",
                commence_time: event.commence_time,
                market: market.description || market.key || "Mercado",
                selection: [item.outcome.name, item.outcome.description, item.outcome.point !== undefined ? String(item.outcome.point) : ""].filter(Boolean).join(" "),
                odds: Number(item.odds.toFixed(3)),
                market_probability: Number(probability.toFixed(4))
              });
            }
          }
        }
      } catch {
        // Uma competição indisponível não impede a análise das restantes.
      }
    }
  }

  await Promise.all(Array.from({length: Math.min(5, sports.length)}, () => worker()));
  candidates.sort((a, b) => b.market_probability - a.market_probability || Math.abs(1.9 - a.odds) - Math.abs(1.9 - b.odds));
  const data = {
    recommendation: candidates[0] || null,
    alternatives: candidates.slice(1, 4),
    scanned,
    events: eventCount,
    candidates: candidates.length,
    generated_at: new Date().toISOString(),
    build: BUILD
  };
  bestCache = { at: Date.now(), data };
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido", build: BUILD });
  }

  const key = process.env.PROPLINE_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: "A chave PropLine não está configurada na Vercel. Adiciona PROPLINE_API_KEY nas variáveis de ambiente.",
      build: BUILD
    });
  }

  const url = new URL(req.url || "/", "https://betmanager-zeta.vercel.app");
  const action = url.searchParams.get("action");
  const sport = url.searchParams.get("sport");

  if (action === "best") {
    try {
      const data = await findBestPick(key);
      return res.status(200).json(data);
    } catch {
      return res.status(502).json({ error: "Não foi possível analisar as odds da Betclic PT." , build: BUILD });
    }
  }

  let endpoint;
  if (action === "sports") {
    endpoint = "https://api.prop-line.com/v1/sports";
  } else {
    if (!sport || !/^soccer_[a-z0-9_]+$/.test(sport)) {
      return res.status(400).json({ error: "Competição de futebol inválida.", build: BUILD });
    }
    endpoint = new URL("https://api.prop-line.com/v1/sports/" + encodeURIComponent(sport) + "/odds");
    endpoint.searchParams.set("bookmakers", "betclic_pt");
    endpoint.searchParams.set("markets", "h2h,totals,spreads");
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { "X-API-Key": key, "Accept": "application/json" },
      cache: "no-store"
    });
    const data = await response.json();

    if (!response.ok) {
      const detail = data?.detail?.message || data?.message || "O fornecedor de odds recusou o pedido.";
      const status = response.status === 401 ? 502 : response.status;
      return res.status(status).json({
        error: detail,
        providerStatus: response.status,
        build: BUILD
      });
    }

    if (action === "sports") {
      const sports = Array.isArray(data) ? data : (Array.isArray(data.sports) ? data.sports : []);
      return res.status(200).json({
        sports: sports.filter(item => String(item.key || "").startsWith("soccer_")),
        quota: {
          limit: response.headers.get("x-daily-limit"),
          used: response.headers.get("x-daily-used"),
          remaining: response.headers.get("x-daily-remaining")
        },
        build: BUILD
      });
    }

    const events = Array.isArray(data) ? data : (Array.isArray(data.events) ? data.events : []);
    const betclicEvents = events.map(event => ({
      ...event,
      bookmakers: (event.bookmakers || []).filter(book => book.key === "betclic_pt")
    })).filter(event => event.bookmakers.some(book => (book.markets || []).length));

    return res.status(200).json({
      events: betclicEvents,
      count: betclicEvents.length,
      quota: {
        limit: response.headers.get("x-daily-limit"),
        used: response.headers.get("x-daily-used"),
        remaining: response.headers.get("x-daily-remaining")
      },
      build: BUILD
    });
  } catch (error) {
    return res.status(502).json({
      error: "Não foi possível contactar a API de odds. Tenta novamente mais tarde.",
      build: BUILD
    });
  }
}
