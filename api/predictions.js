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
  let mostLikelyScore = { home: 0, away: 0, probability: -1 };

  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const probability = poisson(expectedHome, h) * poisson(expectedAway, a);
      if (probability > mostLikelyScore.probability) {
        mostLikelyScore = { home: h, away: a, probability };
      }
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
      goals: { home: String(mostLikelyScore.home), away: String(mostLikelyScore.away) },
      advice: "Resultado provável estimado a partir das médias de golos casa/fora. É uma estimativa estatística, não uma certeza.",
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

function bettingSuggestion(predictions) {
  const percent = predictions?.percent || {};
  const read = value => {
    const parsed = Number(String(value ?? "").replace("%", "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const home = read(percent.home), draw = read(percent.draw), away = read(percent.away);
  if ([home, draw, away].some(value => value === null)) {
    return { market: "Sem aposta recomendada", reason: "Não há probabilidades completas para avaliar uma aposta." };
  }
  const best = Math.max(home, draw, away);
  if (home >= 55 && home > draw && home > away) {
    return { market: "Vitória da equipa da casa (1)", probability: home, reason: "É o resultado individual com maior probabilidade estimada." };
  }
  if (away >= 55 && away > home && away > draw) {
    return { market: "Vitória da equipa visitante (2)", probability: away, reason: "É o resultado individual com maior probabilidade estimada." };
  }
  if (home + draw >= 75 && home >= away) {
    return { market: "Dupla hipótese 1X", probability: Math.round(home + draw), reason: "A estimativa conjunta favorece vitória da equipa da casa ou empate." };
  }
  if (away + draw >= 75 && away > home) {
    return { market: "Dupla hipótese X2", probability: Math.round(away + draw), reason: "A estimativa conjunta favorece empate ou vitória da equipa visitante." };
  }
  return { market: "Sem aposta recomendada", probability: best, reason: "A previsão não apresenta uma vantagem suficientemente clara." };
}


function statNumber(statistics, type) {
  const row = (statistics || []).find(item => item.type === type);
  return numberOrNull(row?.value);
}

async function recentMarketAnalysis(match, key) {
  const homeId = match.teams?.home?.id;
  const awayId = match.teams?.away?.id;
  if (!homeId || !awayId) return null;

  // Quatro jogos recentes por equipa: amostra curta, mas contextualizada
  // sem multiplicar chamadas desnecessariamente.
  const [homeFixtures, awayFixtures] = await Promise.all([
    apiGet("https://v3.football.api-sports.io/fixtures?team=" + homeId + "&last=4&status=FT", key),
    apiGet("https://v3.football.api-sports.io/fixtures?team=" + awayId + "&last=4&status=FT", key)
  ]);
  const fixtures = new Map();
  [...(homeFixtures || []), ...(awayFixtures || [])].forEach(item => {
    if (item.fixture?.id) fixtures.set(Number(item.fixture.id), item);
  });
  const recent = [...fixtures.values()].slice(0, 8);
  if (recent.length < 4) return null;

  const samples = await Promise.all(recent.map(async item => {
    try {
      const data = await apiGet(
        "https://v3.football.api-sports.io/fixtures/statistics?fixture=" + item.fixture.id,
        key
      );
      const home = (data || []).find(row => Number(row.team?.id) === Number(item.teams?.home?.id));
      const away = (data || []).find(row => Number(row.team?.id) === Number(item.teams?.away?.id));
      const h = home?.statistics || [];
      const a = away?.statistics || [];
      const htHome = numberOrNull(item.score?.halftime?.home);
      const htAway = numberOrNull(item.score?.halftime?.away);
      return {
        corners: [statNumber(h, "Corner Kicks"), statNumber(a, "Corner Kicks")],
        cards: [statNumber(h, "Yellow Cards"), statNumber(a, "Yellow Cards")],
        shots: [statNumber(h, "Total Shots"), statNumber(a, "Total Shots")],
        onTarget: [statNumber(h, "Shots on Goal"), statNumber(a, "Shots on Goal")],
        halfTime: htHome !== null && htAway !== null ? (htHome > htAway ? "1" : htHome < htAway ? "2" : "X") : null
      };
    } catch {
      return null;
    }
  }));

  const valid = samples.filter(Boolean);
  const markets = [];
  const addLine = (label, values, threshold, direction, minSample = 5) => {
    const observed = values.filter(value => value !== null && value !== undefined);
    if (observed.length < minSample) return;
    const hits = observed.filter(value => direction === "over" ? value > threshold : value < threshold).length;
    const rate = Math.round(hits / observed.length * 100);
    markets.push({ market: label, probability: rate, sample: observed.length, hits });
  };
  const totals = key => valid.map(row => row[key].every(v => v !== null) ? row[key][0] + row[key][1] : null);
  addLine("Total de cantos: mais de 7,5", totals("corners"), 7.5, "over");
  addLine("Total de cantos: mais de 6,5", totals("corners"), 6.5, "over");
  addLine("Total de cartões amarelos: mais de 2,5", totals("cards"), 2.5, "over");
  addLine("Total de cartões amarelos: menos de 5,5", totals("cards"), 5.5, "under");
  addLine("Total de remates: mais de 19,5", totals("shots"), 19.5, "over");
  addLine("Total de remates: menos de 31,5", totals("shots"), 31.5, "under");
  addLine("Total de remates à baliza: mais de 6,5", totals("onTarget"), 6.5, "over");
  addLine("Total de remates à baliza: menos de 12,5", totals("onTarget"), 12.5, "under");

  const halfTimes = valid.map(row => row.halfTime).filter(Boolean);
  if (halfTimes.length >= 5) {
    ["1", "X", "2"].forEach(code => {
      const hits = halfTimes.filter(value => value === code).length;
      markets.push({
        market: "Resultado ao intervalo: " + (code === "1" ? "equipa da casa" : code === "2" ? "equipa visitante" : "empate"),
        probability: Math.round(hits / halfTimes.length * 100),
        sample: halfTimes.length,
        hits
      });
    });
  }

  // Só considerar uma aposta quando a frequência histórica é elevada.
  // Frequência observada não equivale a valor esperado: faltam odds do bookmaker.
  markets.sort((a, b) => b.probability - a.probability || b.sample - a.sample);
  const best = markets.find(item => item.probability >= 80 && item.sample >= 5);
  return {
    sampleMatches: valid.length,
    evaluatedMarkets: markets,
    recommendation: best ? {
      ...best,
      market: best.market,
      reason: "Atingiu " + best.probability + "% nos últimos " + best.sample + " jogos analisados. Frequência histórica, não garantia nem prova de valor face às odds."
    } : {
      market: "Sem aposta segura — não apostar",
      probability: null,
      reason: "Nenhum mercado atingiu o mínimo de 80% numa amostra de pelo menos cinco observações."
    },
    excludedMarkets: [
      { market: "Resultado exato", reason: "Variância demasiado elevada para ser tratado como aposta segura." },
      { market: "Marcador do golo", reason: "Só deve ser avaliado com onze inicial confirmado e dados individuais suficientes; não é recomendado como mercado seguro." },
      { market: "Primeiro pontapé de baliza", reason: "A API não disponibiliza histórico fiável deste evento." }
    ]
  };
}

export default async function handler(req, res) {
  const key = process.env.API_FOOTBALL_KEY;
  const fixture = req.query.fixture;

  if (!key || !fixture || !/^\d+$/.test(String(fixture))) {
    return res.status(400).json({ error: "Fixture inválido ou API não configurada" });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    // Confirmar primeiro a data e o estado do encontro para não sugerir
    // apostas em jogos que já começaram ou terminaram.
    const fixtureData = await apiGet(
      "https://v3.football.api-sports.io/fixtures?id=" + encodeURIComponent(fixture),
      key
    );
    const match = Array.isArray(fixtureData) ? fixtureData[0] : null;
    if (!match) {
      return res.status(200).json({
        results: [],
        requestedFixture: Number(fixture),
        message: "Não foi possível confirmar os dados deste jogo."
      });
    }

    const status = match.fixture?.status?.short || "TBD";
    if (status !== "NS" && status !== "TBD") {
      const message = ["FT", "AET", "PEN"].includes(status)
        ? "Este jogo já terminou. Não há uma aposta a recomendar."
        : "Este jogo já começou ou está com o estado '" + status + "'. Não uses uma previsão pré-jogo para apostar agora.";
      return res.status(200).json({
        results: [],
        requestedFixture: Number(fixture),
        message,
        fixtureStatus: status,
        fixtureDate: match.fixture?.date || null
      });
    }

    const predictionData = await apiGet(
      "https://v3.football.api-sports.io/predictions?fixture=" + encodeURIComponent(fixture),
      key
    );
    const received = Array.isArray(predictionData) ? predictionData : [];
    const validPredictions = received.filter(item =>
      Number(item.fixture?.id) === Number(fixture)
    );

    const marketAnalysis = await recentMarketAnalysis(match, key);

    if (validPredictions.length) {
      const results = validPredictions.map(item => ({
        ...item,
        marketAnalysis,
        betManagerSuggestion: marketAnalysis?.recommendation || bettingSuggestion(item.predictions)
      }));
      return res.status(200).json({
        results,
        requestedFixture: Number(fixture),
        fixtureDate: match.fixture?.date || null,
        source: "API-Football"
      });
    }

    if (!match.league?.id || !match.league?.season ||
        !match.teams?.home?.id || !match.teams?.away?.id) {
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
    estimate.marketAnalysis = marketAnalysis;
    estimate.betManagerSuggestion = marketAnalysis?.recommendation || bettingSuggestion(estimate.predictions);
    return res.status(200).json({
      results: [estimate],
      requestedFixture: Number(fixture),
      fixtureDate: match.fixture?.date || null,
      source: "BetManager"
    });
  } catch (error) {
    return res.status(502).json({
      error: error.message || "Falha de comunicação",
      requestedFixture: Number(fixture)
    });
  }
}
