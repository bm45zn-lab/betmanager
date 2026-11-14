const BUILD = "fixtures-query-debug-2026-11-14";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido", build: BUILD });
  }

  // Vercel fornece req.url com o caminho e a query string.
  const requestUrl = new URL(req.url || "/", "https://betmanager-zeta.vercel.app");
  const from = requestUrl.searchParams.get("from") || req.query?.from;
  const to = requestUrl.searchParams.get("to") || req.query?.to;
  const league = requestUrl.searchParams.get("league") || req.query?.league;
  const season = requestUrl.searchParams.get("season") || req.query?.season;
  const key = process.env.API_FOOTBALL_KEY;

  if (!key) {
    return res.status(500).json({
      error: "Chave API não configurada na Vercel",
      build: BUILD
    });
  }

  if (!from || !to || String(from) > String(to)) {
    return res.status(400).json({
      error: "Datas inválidas ou em falta",
      received: { from: from || null, to: to || null },
      build: BUILD
    });
  }

  // Construção explícita da query string para evitar ambiguidades no envio.
  const query = new URLSearchParams();
  query.append("from", String(from));
  query.append("to", String(to));
  query.append("timezone", "Europe/Lisbon");
  if (league) query.append("league", String(league));
  if (season) query.append("season", String(season));

  const upstreamUrl = "https://v3.football.api-sports.io/fixtures?" + query.toString();

  try {
    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        "x-apisports-key": key,
        "Accept": "application/json"
      },
      cache: "no-store"
    });

    const data = await response.json();
    const errors = data.errors || {};

    if (!response.ok || Object.keys(errors).length) {
      return res.status(502).json({
        error: "API-Football recusou o pedido",
        details: errors,
        diagnostic: {
          build: BUILD,
          receivedByBetManager: { from, to, timezone: "Europe/Lisbon" },
          sentQuery: query.toString(),
          upstreamStatus: response.status
        }
      });
    }

    return res.status(200).json({
      results: data.response || [],
      count: data.results || 0,
      build: BUILD
    });
  } catch (error) {
    return res.status(502).json({
      error: "Erro de comunicação com API-Football",
      diagnostic: { build: BUILD }
    });
  }
}
