
export default async function handler(req, res) {
  const key = process.env.API_FOOTBALL_KEY;
  const fixture = req.query.fixture;

  if (!key || !fixture || !/^\d+$/.test(fixture)) {
    return res.status(400).json({ error: "Fixture inválido ou API não configurada" });
  }

  try {
    const response = await fetch(
      `https://v3.football.api-sports.io/predictions?fixture=${fixture}`,
      { headers: { "x-apisports-key": key } }
    );

    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: "Erro na API" });

    return res.status(200).json({ results: data.response });
  } catch {
    return res.status(502).json({ error: "Falha de comunicação" });
  }
}
