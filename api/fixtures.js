export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  // Lê os parâmetros diretamente do URL e usa req.query como fallback.
  // Isto evita perder from/to quando o runtime não preenche req.query como esperado.
  const requestUrl = new URL(req.url, "https://betmanager.vercel.app");
  const getParam = name => {
    const fromUrl = requestUrl.searchParams.get(name);
    const fromQuery = req.query?.[name];
    const value = fromUrl || fromQuery;
    return Array.isArray(value) ? value[0] : value;
  };

  const from = getParam("from");
  const to = getParam("to");
  const league = getParam("league");
  const season = getParam("season");
  const key = process.env.API_FOOTBALL_KEY;

  if (!key) {
    return res.status(500).json({
      error: "Chave API não configurada na Vercel"
    });
  }

  if (!from || !to || from > to) {
    return res.status(400).json({
      error: "Datas inválidas ou em falta",
      received: { from: from || null, to: to || null }
    });
  }

  const apiUrl = new URL("https://v3.football.api-sports.io/fixtures");
  apiUrl.searchParams.set("from", from);
  apiUrl.searchParams.set("to", to);
  apiUrl.searchParams.set("timezone", "Europe/Lisbon");

  if (league) apiUrl.searchParams.set("league", String(league));
  if (season) apiUrl.searchParams.set("season", String(season));

  try {
    const response = await fetch(apiUrl.toString(), {
      headers: { "x-apisports-key": key }
    });

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
