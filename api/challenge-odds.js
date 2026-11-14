const BUILD = "challenge-market-quality-2026-11-15";
const CACHE_MS = 3 * 60 * 1000;
const MAX_EVENT_AGE_MS = 15 * 60 * 1000;
let bestCache = { at: 0, data: null };

function decimalOdds(outcome) {
  if (outcome?.price_decimal !== undefined && outcome.price_decimal !== null) {
    const value = Number(outcome.price_decimal);
    return Number.isFinite(value) && value > 1 ? value : null;
  }
  const price = Number(outcome?.price);
  if (!Number.isFinite(price) || price === 0) return null;
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

function getCollection(data, key) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.[key]) ? data[key] : [];
}

async function providerGet(url, key) {
  const response = await fetch(url, {
    method: "GET",
    headers: { "X-API-Key": key, "Accept": "application/json" },
    cache: "no-store"
  });
  const data = await response.json();
  if (!response.ok) throw new Error("PropLine HTTP " + response.status);
  return { data, headers: response.headers };
}

function marketCandidates(event, sport, now) {
  const kickoff = Date.parse(event?.commence_time || "");
  if (!Number.isFinite(kickoff) || kickoff <= now || kickoff > now + 24 * 60 * 60 * 1000) return [];

  const book = getCollection(event?.bookmakers, "bookmakers").find(item => item.key === "betclic_pt");
  if (!book) return [];

  const updatedAt = Date.parse(book.last_update || event.last_update || "");
  const stale = Number.isFinite(updatedAt) && now - updatedAt > MAX_EVENT_AGE_MS;
  if (stale) return [];

  const result = [];
  for (const market of getCollection(book.markets, "markets")) {
    const outcomes = getCollection(market.outcomes, "outcomes")
      .map(outcome => ({ outcome, odds: decimalOdds(outcome) }))
      .filter(item => item.odds && item.odds >= 1.75 && item.odds <= 2.00);

    const allOutcomes = getCollection(market.outcomes, "outcomes")
      .map(outcome => ({ outcome, odds: decimalOdds(outcome) }))
      .filter(item => item.odds && item.odds > 1);

    if (outcomes.length === 0 || allOutcomes.length < 2) continue;

    const overround = allOutcomes.reduce((sum, item) => sum + 1 / item.odds, 0);
    // Margem elevada torna a probabilidade normalizada menos informativa.
    if (!Number.isFinite(overround) || overround > 1.08 || overround < 1) continue;

    const fairTotal = allOutcomes.reduce((sum, item) => sum + 1 / item.odds, 0);
    for (const item of outcomes) {
      const probability = (1 / item.odds) / fairTotal;
      result.push({
        sport_key: sport.key,
        sport_title: sport.title || sport.key,
        event_id: event.id,
        home_team: event.home_team || "Casa",
        away_team: event.away_team || "Fora",
        commence_time: event.commence_time,
        market: market.description || market.key || "Mercado",
        selection: [item.outcome.name, item.outcome.description, item.outcome.point !== undefined ? String(item.outcome.point) : ""].filter(Boolean).join(" "),
        odds: Number(item.odds.toFixed(3)),
        market_probability: Number(probability.toFixed(4)),
        overround: Number(overround.toFixed(4)),
        updated_at: book.last_update || event.last_update || null,
        market_quality_label: overround <= 1.04 ? "Margem baixa" : "Margem moderada"
      });
    }
  }
  return result;
}

async function findBestPick(key) {
  if (bestCache.data && Date.now() - bestCache.at < CACHE_MS) return bestCache.data;

  const sportsResponse = await providerGet("https://api.prop-line.com/v1/sports", key);
  const sports = getCollection(sportsResponse.data, "sports")
    .filter(item => item.active !== false && /^soccer_[a-z0-9_]+$/.test(String(item.key || "")));

  const now = Date.now();
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
        const response = await providerGet(url, key);
        scanned++;
        const events = getCollection(response.data, "events");
        eventCount += events.length;
        for (const event of events) candidates.push(...marketCandidates(event, sport, now));
      } catch {
        // Uma competição indisponível não invalida as restantes.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, sports.length) }, () => worker()));

  // Ordena por maior probabilidade implícita sem margem; desempata pela menor margem.
  // Isto é consenso do mercado, não uma previsão independente nem uma vantagem matemática.
  candidates.sort((a, b) =>
    b.market_probability - a.market_probability ||
    a.overround - b.overround ||
    Math.abs(1.88 - a.odds) - Math.abs(1.88 - b.odds)
  );

  // Evita apresentar várias seleções do mesmo jogo como se fossem independentes.
  const distinct = [];
  const seenEvents = new Set();
  for (const candidate of candidates) {
    const key = String(candidate.event_id || candidate.home_team + "|" + candidate.away_team);
    if (seenEvents.has(key)) continue;
    seenEvents.add(key);
    distinct.push(candidate);
    if (distinct.length >= 4) break;
  }

  const data = {
    recommendation: distinct[0] || null,
    alternatives: distinct.slice(1),
    scanned,
    events: eventCount,
    candidates: candidates.length,
    generated_at: new Date().toISOString(),
    build: BUILD,
    methodology: "Probabilidade implícita normalizada pelas odds da Betclic; filtro de margem máxima de 8%; odds entre 1,75 e 2,00; uma seleção por jogo.",
    warning: "Não existe estimativa independente de probabilidade nem prova de valor esperado positivo. A classificação não garante resultados."
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
      error: "A chave PropLine não está configurada na Vercel.",
      build: BUILD
    });
  }

  const url = new URL(req.url || "/", "https://betmanager-zeta.vercel.app");
  const action = url.searchParams.get("action");
  const sport = url.searchParams.get("sport");

  if (action === "best") {
    try {
      return res.status(200).json(await findBestPick(key));
    } catch {
      return res.status(502).json({ error: "Não foi possível analisar as odds da Betclic PT.", build: BUILD });
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
    const response = await providerGet(endpoint, key);
    if (action === "sports") {
      return res.status(200).json({
        sports: getCollection(response.data, "sports").filter(item => String(item.key || "").startsWith("soccer_")),
        quota: {
          limit: response.headers.get("x-daily-limit"),
          used: response.headers.get("x-daily-used"),
          remaining: response.headers.get("x-daily-remaining")
        },
        build: BUILD
      });
    }

    const events = getCollection(response.data, "events");
    const betclicEvents = events.map(event => ({
      ...event,
      bookmakers: getCollection(event.bookmakers, "bookmakers").filter(book => book.key === "betclic_pt")
    })).filter(event => event.bookmakers.some(book => getCollection(book.markets, "markets").length));

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
  } catch {
    return res.status(502).json({ error: "Não foi possível contactar a API de odds. Tenta novamente mais tarde.", build: BUILD });
  }
}
