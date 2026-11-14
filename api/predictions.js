
export default async function handler(req, res) {
  const key = process.env.API_FOOTBALL_KEY;
  const fixture = req.query.fixture;

  if (!key || !fixture || !/^\d+$/.test(fixture)) {
    return res.status(400).json({ error: "Fixture inválido ou API não configurada" });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    const response = await fetch(
      `https://v3.football.api-sports.io/predictions?fixture=${fixture}`,
      { headers: { "x-apisports-key": key }, cache: "no-store" }
    );

    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: "Erro na API" });
    if (data.errors && Object.keys(data.errors).length) {
      return res.status(502).json({ error: "A API-Football devolveu um erro", details: data.errors });
    }

    const results = Array.isArray(data.response) ? data.response : [];
    const mismatched = results.some(item => Number(item.fixture?.id) !== Number(fixture));
    if (mismatched) {
      return res.status(502).json({ error: "A API devolveu previsões de outro jogo." });
    }

    return res.status(200).json({ results, requestedFixture: Number(fixture) });
  } catch {
    return res.status(502).json({ error: "Falha de comunicação" });
  }
}
