const BUILD = "fixtures-date-filter-2026-11-14";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido", build: BUILD });
  }

  const requestUrl = new URL(req.url || "/", "https://betmanager-zeta.vercel.app");
  const from = requestUrl.searchParams.get("from") || req.query?.from;
  const to = requestUrl.searchParams.get("to") || req.query?.to;
  const league = requestUrl.searchParams.get("league") || req.query?.league;
  const season = requestUrl.searchParams.get("season") || req.query?.season;
  const key = process.env.API_FOOTBALL_KEY;

  if (!key) {
    return res.status(500).json({ error: "Chave API não configurada na Vercel", build: BUILD });
  }

  if (!from || !to || String(from) > String(to)) {
    return res.status(400).json({
      error: "Datas inválidas ou em falta",
      received: { from: from || null, to: to || null },
      build: BUILD
    });
  }

  const start = new Date(String(from) + "T00:00:00Z");
  const end = new Date(String(to) + "T00:00:00Z");
  const dayCount = Math.floor((end - start) / 86400000) + 1;

  if (!Number.isFinite(dayCount) || dayCount < 1 || dayCount > 31) {
    return res.status(400).json({
      error: "O intervalo de pesquisa deve ter entre 1 e 31 dias",
      build: BUILD
    });
  }

  try {
    const allFixtures = [];
    for (let i = 0; i < dayCount; i++) {
      const day = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
      const upstreamUrl = new URL("https://v3.football.api-sports.io/fixtures");
      upstreamUrl.searchParams.set("date", day);
      upstreamUrl.searchParams.set("timezone", "Europe/Lisbon");
      if (league) upstreamUrl.searchParams.set("league", String(league));
      if (season) upstreamUrl.searchParams.set("season", String(season));

      const response = await fetch(upstreamUrl, {
        method: "GET",
        headers: { "x-apisports-key": key },
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
            requestedDate: day,
            sentQuery: upstreamUrl.searchParams.toString(),
            upstreamStatus: response.status
          }
        });
      }

      allFixtures.push(...(data.response || []));
    }

    return res.status(200).json({
      results: allFixtures,
      count: allFixtures.length,
      build: BUILD
    });
  } catch (error) {
    return res.status(502).json({
      error: "Erro de comunicação com API-Football",
      diagnostic: { build: BUILD }
    });
  }
}
