const BUILD = "challenge-betclic-propline-2026-11-14";

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
