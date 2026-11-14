
export default async function handler(req, res) {
  const key = process.env.API_FOOTBALL_KEY;
  const season = req.query.season || "2026";

  if (!key) return res.status(500).json({ error: "API não configurada" });

  try {
    const response = await fetch(
      `https://v3.football.api-sports.io/leagues?season=${encodeURIComponent(season)}`,
      { headers: { "x-apisports-key": key } }
    );

    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: "Erro na API" });

    return res.status(200).json({ results: data.response });
  } catch {
    return res.status(502).json({ error: "Falha de comunicação" });
  }
}
