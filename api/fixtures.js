
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { from, to, league, season } = req.query;
  const key = process.env.API_FOOTBALL_KEY;

  if (!key) {
    return res.status(500).json({
      error: "Chave API não configurada na Vercel"
    });
  }

  if (!from || !to || from > to) {
    return res.status(400).json({
      error: "Datas inválidas"
    });
  }

  const params = new URLSearchParams({
    from,
    to,
    timezone: "Europe/Lisbon"
  });

  if (league) params.set("league", league);
  if (season) params.set("season", season);

  try {
    const response = await fetch(
      `https://v3.football.api-sports.io/fixtures?${params}`,
      { headers: { "x-apisports-key": key } }
    );

    const data = await response.json();

    if (!response.ok || Object.keys(data.errors || {}).length) {
      return res.status(502).json({
        error: "API-Football recusou o pedido",
        details: data.errors
      });
    }

    return res.status(200).json({
      results: data.response || [],
      count: data.results || 0
    });

  } catch (error) {
    return res.status(502).json({
      error: "Erro de comunicação com API-Football"
    });
  }
}
