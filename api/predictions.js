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

  const [homeFixtures, awayFixtures] = await Promise.all([
    apiGet("https://v3.football.api-sports.io/fixtures?team=" + homeId + "&last=5&status=FT", key).catch(() => []),
    apiGet("https://v3.football.api-sports.io/fixtures?team=" + awayId + "&last=5&status=FT", key).catch(() => [])
  ]);
  const fixtures = new Map();
  [...(homeFixtures || []), ...(awayFixtures || [])].forEach(item => {
    if (item.fixture?.id) fixtures.set(Number(item.fixture.id), item);
  });
  const recent = [...fixtures.values()]
    .sort((a, b) => new Date(b.fixture?.date || 0) - new Date(a.fixture?.date || 0))
    .slice(0, 10);
  if (!recent.length) return null;

  const samples = await Promise.all(recent.map(async item => {
    const fullHome = numberOrNull(item.score?.fulltime?.home);
    const fullAway = numberOrNull(item.score?.fulltime?.away);
    const halfHome = numberOrNull(item.score?.halftime?.home);
    const halfAway = numberOrNull(item.score?.halftime?.away);
    let stats = [];
    try {
      stats = await apiGet("https://v3.football.api-sports.io/fixtures/statistics?fixture=" + item.fixture.id, key);
    } catch {}
    const h = (stats || []).find(row => Number(row.team?.id) === Number(item.teams?.home?.id))?.statistics || [];
    const a = (stats || []).find(row => Number(row.team?.id) === Number(item.teams?.away?.id))?.statistics || [];
    const total = (type) => {
      const x = statNumber(h, type), y = statNumber(a, type);
      return x !== null && y !== null ? x + y : null;
    };
    return {
      goals: fullHome !== null && fullAway !== null ? [fullHome, fullAway] : null,
      halfTime: halfHome !== null && halfAway !== null ? (halfHome > halfAway ? "1" : halfHome < halfAway ? "2" : "X") : null,
      corners: total("Corner Kicks"),
      cards: total("Yellow Cards"),
      shots: total("Total Shots"),
      onTarget: total("Shots on Goal")
    };
  }));

  const valid = samples.filter(Boolean);
  const markets = [];
  const addBinary = (label, values, predicate) => {
    const observed = values.filter(value => value !== null && value !== undefined);
    if (!observed.length) return;
    const hits = observed.filter(predicate).length;
    markets.push({ market: label, probability: Math.round(hits / observed.length * 100), sample: observed.length, hits });
  };
  const addLine = (label, values, threshold, direction) =>
    addBinary(label, values, value => direction === "over" ? value > threshold : value < threshold);

  const goals = valid.map(row => row.goals).filter(Boolean);
  addBinary("Vitória da equipa da casa (1)", goals, score => score[0] > score[1]);
  addBinary("Empate (X)", goals, score => score[0] === score[1]);
  addBinary("Vitória da equipa visitante (2)", goals, score => score[0] < score[1]);
  addBinary("Dupla hipótese 1X", goals, score => score[0] >= score[1]);
  addBinary("Dupla hipótese X2", goals, score => score[1] >= score[0]);
  addLine("Total de golos: mais de 0,5", goals.map(x => x[0] + x[1]), 0.5, "over");
  addLine("Total de golos: mais de 1,5", goals.map(x => x[0] + x[1]), 1.5, "over");
  addLine("Total de golos: menos de 4,5", goals.map(x => x[0] + x[1]), 4.5, "under");
  addBinary("Ambas as equipas marcam: sim", goals, score => score[0] > 0 && score[1] > 0);
  addLine("Total de cantos: mais de 6,5", valid.map(x => x.corners), 6.5, "over");
  addLine("Total de cantos: mais de 7,5", valid.map(x => x.corners), 7.5, "over");
  addLine("Total de cartões amarelos: mais de 2,5", valid.map(x => x.cards), 2.5, "over");
  addLine("Total de cartões amarelos: menos de 5,5", valid.map(x => x.cards), 5.5, "under");
  addLine("Total de remates: mais de 19,5", valid.map(x => x.shots), 19.5, "over");
  addLine("Total de remates à baliza: mais de 6,5", valid.map(x => x.onTarget), 6.5, "over");

  const halfTimes = valid.map(row => row.halfTime).filter(Boolean);
  addBinary("Resultado ao intervalo: vitória da equipa da casa", halfTimes, value => value === "1");
  addBinary("Resultado ao intervalo: empate", halfTimes, value => value === "X");
  addBinary("Resultado ao intervalo: vitória da equipa visitante", halfTimes, value => value === "2");

  // A classificação privilegia taxa de acerto, mas desempata por amostra maior.
  markets.sort((a, b) => b.probability - a.probability || b.sample - a.sample);
  const best = markets.find(item => item.sample >= 5 && item.probability >= 50);
  return {
    sampleMatches: valid.length,
    evaluatedMarkets: markets,
    recommendation: best ? {
      ...best,
      reason: "Melhor frequência observada entre os mercados avaliados (" + best.hits + "/" + best.sample + "). É histórico, não garantia nem valor esperado."
    } : {
      market: "Sem aposta recomendada",
      probability: null,
      reason: "Não há amostra suficiente para distinguir um mercado com confiança."
    },
    excludedMarkets: [
      { market: "Resultado exato", reason: "Variância demasiado elevada." },
      { market: "Marcador do golo", reason: "Depende de titulares, minutos e dados individuais." },
      { market: "Primeiro pontapé de baliza", reason: "Não existe histórico fiável disponível." }
    ]
  };
}

async function liveMatchAnalysis(match, key) {
  const fixtureId = match.fixture?.id;
  const [statistics, oddsData] = await Promise.all([
    apiGet("https://v3.football.api-sports.io/fixtures/statistics?fixture=" + fixtureId, key).catch(() => []),
    apiGet("https://v3.football.api-sports.io/odds/live?fixture=" + fixtureId, key).catch(() => [])
  ]);

  const teams = Array.isArray(statistics) ? statistics : [];
  const homeStats = teams.find(team => Number(team.team?.id) === Number(match.teams?.home?.id))?.statistics || [];
  const awayStats = teams.find(team => Number(team.team?.id) === Number(match.teams?.away?.id))?.statistics || [];
  const readStat = (rows, name) => statNumber(rows, name);
  const liveStats = {
    home: {
      shots: readStat(homeStats, "Total Shots"),
      shotsOnTarget: readStat(homeStats, "Shots on Goal"),
      corners: readStat(homeStats, "Corner Kicks"),
      yellowCards: readStat(homeStats, "Yellow Cards"),
      possession: readStat(homeStats, "Ball Possession")
    },
    away: {
      shots: readStat(awayStats, "Total Shots"),
      shotsOnTarget: readStat(awayStats, "Shots on Goal"),
      corners: readStat(awayStats, "Corner Kicks"),
      yellowCards: readStat(awayStats, "Yellow Cards"),
      possession: readStat(awayStats, "Ball Possession")
    }
  };

  const response = Array.isArray(oddsData) ? oddsData : [];
  const available = [];
  response.forEach(entry => {
    const providers = entry.bookmakers || entry.odds || [];
    providers.forEach(provider => {
      const bets = provider.bets || [];
      bets.forEach(bet => {
        (bet.values || []).forEach(value => {
          const odd = numberOrNull(value.odd);
          if (odd && odd > 1 && value.suspended !== true) {
            available.push({
              bookmaker: provider.name || "Operador não identificado",
              market: bet.name || "Mercado ao vivo",
              selection: value.value || "Seleção",
              odd,
              impliedProbability: Math.round(100 / odd),
              blocked: entry.status?.blocked === true || entry.status?.stopped === true || entry.status?.finished === true
            });
          }
        });
      });
    });
  });

  const eligible = available.filter(item => !item.blocked);
  eligible.sort((a, b) => a.odd - b.odd);
  const best = eligible.find(item => item.impliedProbability >= 75);
  const elapsed = match.fixture?.status?.elapsed ?? null;
  const liveStatus = match.fixture?.status?.short || "LIVE";
  return {
    mode: "live",
    status: liveStatus,
    minute: elapsed,
    score: {
      home: match.goals?.home ?? 0,
      away: match.goals?.away ?? 0
    },
    teams: {
      home: match.teams?.home?.name || "Casa",
      away: match.teams?.away?.name || "Fora"
    },
    statistics: liveStats,
    availableOdds: eligible.slice(0, 8),
    recommendation: best ? {
      market: best.market + " — " + best.selection,
      bookmaker: best.bookmaker,
      odd: best.odd,
      impliedProbability: best.impliedProbability,
      reason: "Odd disponível no mercado ao vivo. A probabilidade implícita é aproximada e não representa uma previsão independente nem garante valor."
    } : {
      market: "Sem aposta recomendada neste momento",
      reason: eligible.length
        ? "Nenhuma odd disponível atingiu o limiar conservador definido. Espera por mais dados ou não apostes."
        : "Não foram recebidas odds ao vivo disponíveis para este jogo. Não vou inventar uma aposta."
    },
    note: "Estatísticas em direto podem ter atraso e variar conforme a cobertura da competição. Confirma sempre o mercado e a odd na tua casa de apostas."
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
    const finishedStatuses = ["FT", "AET", "PEN", "CANC", "PST", "ABD", "AWD", "WO"];
    const liveStatuses = ["1H", "HT", "2H", "ET", "BT", "P", "LIVE"];
    if (liveStatuses.includes(status)) {
      const liveAnalysis = await liveMatchAnalysis(match, key);
      return res.status(200).json({
        results: [{
          fixture: { id: Number(fixture), status: match.fixture?.status, date: match.fixture?.date },
          teams: {
            home: { name: match.teams?.home?.name },
            away: { name: match.teams?.away?.name }
          },
          goals: match.goals,
          liveAnalysis,
          betManagerSuggestion: liveAnalysis.recommendation
        }],
        requestedFixture: Number(fixture),
        fixtureDate: match.fixture?.date || null,
        source: "API-Football Live"
      });
    }
    if (finishedStatuses.includes(status)) {
      return res.status(200).json({
        results: [],
        requestedFixture: Number(fixture),
        message: "Este jogo já terminou ou foi interrompido. Não há uma aposta ao vivo a recomendar.",
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

    const marketAnalysis = await recentMarketAnalysis(match, key).catch(() => null);

    if (validPredictions.length) {
      const results = validPredictions.map(item => ({
        ...item,
        marketAnalysis,
        betManagerSuggestion: marketAnalysis?.recommendation || { market: "Sem aposta segura — não apostar", reason: "Não foi possível obter uma amostra histórica suficiente para avaliar os mercados." }
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
    estimate.betManagerSuggestion = marketAnalysis?.recommendation || { market: "Sem aposta segura — não apostar", reason: "Não foi possível obter uma amostra histórica suficiente para avaliar os mercados." };
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
