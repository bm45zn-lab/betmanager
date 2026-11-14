
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const key = process.env.API_FOOTBALL_KEY;
  const season = req.query.season || "2026";

  if (!key) {
    return res.status(500).json({
      error: "API_FOOTBALL_KEY não está configurada na Vercel"
    });
  }

  try {
    const url = new URL(
      "https://v3.football.api-sports.io/leagues"
    );
    url.searchParams.set("season", season);

    const response = await fetch(url, {
      headers: { "x-apisports-key": key }
    });

    const data = await response.json();

    if (!response.ok || Object.keys(data.errors || {}).length) {
      return res.status(502).json({
        error: "Erro ao carregar competições",
        details: data.errors
      });
    }

    const leagues = (data.response || []).map(item => ({
      id: item.league.id,
      name: item.league.name,
      country: item.country.name,
      logo: item.league.logo,
      season: item.seasons?.find(s => s.year == season)?.year || season
    }));

    return res.status(200).json({ results: leagues });
  } catch (error) {
    return res.status(502).json({
      error: "Falha de comunicação com API-Football"
    });
  }
}
