function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function poisson(lambda, goals) {
  let probability = Math.exp(-lambda);
  for (let i = 1; i <= goals; i++) probability *= lambda / i;
  return probability;
}

function estimateFromTeamStats(homeStats, awayStats, homeName, awayName) {
  const homeScored = numberOrNull(homeStats?.goals?.for?.average?.home);
  const awayConceded = numberOrNull(awayStats?.goals?.against?.average?.away);
  const awayScored = numberOrNull(awayStats?.goals?.for?.average?.away);
  const homeConceded = numberOrNull(homeStats?.goals?.against?.average?.home);

  if ([homeScored, awayConceded, awayScored, homeConceded].some(v => v === null)) {
    return null;
  }

  const expectedHome = Math.max(0.15, Math.min(4, (homeScored + awayConceded) / 2));
  const expectedAway = Math.max(0.15, Math.min(4, (awayScored + homeConceded) / 2));
  let homeWin = 0, draw = 0, awayWin = 0;

  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const probability = poisson(expectedHome, h) * poisson(expectedAway, a);
      if (h > a) homeWin += probability;
      else if (h === a) draw += probability;
      else awayWin += probability;
    }
  }

  const total = homeWin + draw + awayWin;
  const raw = [homeWin / total * 100, draw / total * 100, awayWin / total * 100];
  const rounded = raw.map(Math.floor);
  let remainder = 100 - rounded.reduce((sum, value) => sum + value, 0);
  raw.map((value, index) => ({ index, fraction: value - rounded[index] }))
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, remainder)
    .forEach(item => rounded[item.index]++);

  const names = [homeName, "Empate", awayName];
  const best = rounded.indexOf(Math.max(...rounded));
  const percent = {
    home: rounded[0] + "%",
    draw: rounded[1] + "%",
    away: rounded[2] + "%"
  };

  return {
    fixture: { id: null },
    teams: { home: { name: homeName }, away: { name: awayName } },
    predictions: {
      winner: { name: best === 1 ? "Sem favorito claro" : names[best] },
      advice: "Estimativa BetManager baseada nas médias de golos casa/fora e distribuição de Poisson. Não é uma previsão oficial da API.",
      percent
    },
    comparison: {
      expected_goals: {
        home: expectedHome.toFixed(2),
        away: expectedAway.toFixed(2)
      }
    },
    source: "BetManager"
  };
}

async function apiGet(url, key) {
  const response = await fetch(url, {
    headers: { "x-apisports-key": key },
    cache: "no-store"
  });
  const data = await response.json();
  if (!response.ok || (data.errors && Object.keys(data.errors).length)) {
    throw new Error("A API-Football não disponibilizou os dados estatísticos necessários.");
  }
  return data.response;
}

export default async function handler(req, res) {
  const key = process.env.API_FOOTBALL_KEY;
  const fixture = req.query.fixture;

  if (!key || !fixture || !/^\\d+$/.test(String(fixture))) {
    return res.status(400).json({ error: "Fixture inválido ou API não configurada" });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    const predictionData = await apiGet(
      "https://v3.football.api-sports.io/predictions?fixture=" + encodeURIComponent(fixture),
      key
    );
    const received = Array.isArray(predictionData) ? predictionData : [];
    const validPredictions = received.filter(item =>
      Number(item.fixture?.id) === Number(fixture)
    );

    if (validPredictions.length) {
      return res.status(200).json({
        results: validPredictions,
        requestedFixture: Number(fixture),
        source: "API-Football"
      });
    }

    // Se o fornecedor não tiver uma previsão para este jogo, calcula uma
    // estimativa própria a partir das médias casa/fora das duas equipas.
    const fixtureData = await apiGet(
      "https://v3.football.api-sports.io/fixtures?id=" + encodeURIComponent(fixture),
      key
    );
    const match = Array.isArray(fixtureData) ? fixtureData[0] : null;
    if (!match?.league?.id || !match?.league?.season ||
        !match?.teams?.home?.id || !match?.teams?.away?.id) {
      return res.status(200).json({
        results: [],
        requestedFixture: Number(fixture),
        message: "Não existem dados suficientes para estimar este jogo."
      });
    }

    const league = match.league.id;
    const season = match.league.season;
    const homeId = match.teams.home.id;
    const awayId = match.teams.away.id;
    const base = "https://v3.football.api-sports.io/teams/statistics";
    const [homeStats, awayStats] = await Promise.all([
      apiGet(base + "?league=" + league + "&season=" + season + "&team=" + homeId, key),
      apiGet(base + "?league=" + league + "&season=" + season + "&team=" + awayId, key)
    ]);

    const estimate = estimateFromTeamStats(
      homeStats, awayStats,
      match.teams.home.name || "Equipa da casa",
      match.teams.away.name || "Equipa visitante"
    );

    if (!estimate) {
      return res.status(200).json({
        results: [],
        requestedFixture: Number(fixture),
        message: "Ainda não existem médias casa/fora suficientes para estimar este jogo."
      });
    }

    estimate.fixture.id = Number(fixture);
    return res.status(200).json({
      results: [estimate],
      requestedFixture: Number(fixture),
      source: "BetManager"
    });
  } catch (error) {
    return res.status(502).json({
      error: error.message || "Falha de comunicação",
      requestedFixture: Number(fixture)
    });
  }
}