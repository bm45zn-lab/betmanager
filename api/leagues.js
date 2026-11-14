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

  // Primeiras divisões europeias: nomes oficiais usados pela API-Football.
  const firstDivisions = {
    Brazil: ["Serie A"],
    Albania: ["Kategoria Superiore"],
    Armenia: ["Premier League"],
    Austria: ["Bundesliga"],
    Azerbaijan: ["Premier League"],
    Belarus: ["Premier League"],
    Belgium: ["Jupiler Pro League", "First Division A"],
    "Bosnia and Herzegovina": ["Premijer Liga"],
    Bulgaria: ["First League"],
    Croatia: ["HNL", "1. HNL"],
    Cyprus: ["1. Division"],
    "Czech-Republic": ["Czech Liga", "First League"],
    Denmark: ["Superliga"],
    England: ["Premier League"],
    Finland: ["Veikkausliiga"],
    France: ["Ligue 1"],
    Georgia: ["Erovnuli Liga"],
    Germany: ["Bundesliga"],
    Greece: ["Super League 1"],
    Hungary: ["NB I"],
    Iceland: ["Úrvalsdeild"],
    Ireland: ["Premier Division"],
    Israel: ["Ligat Ha'al", "Ligat HaAl"],
    Moldova: ["Super Liga", "Divizia Națională"],
    Montenegro: ["First League"],
    Netherlands: ["Eredivisie"],
    "North Macedonia": ["First League"],
    "Northern-Ireland": ["Premiership"],
    Norway: ["Eliteserien"],
    Poland: ["Ekstraklasa"],
    Portugal: ["Primeira Liga", "Liga Portugal"],
    Romania: ["Liga I", "SuperLiga"],
    Russia: ["Premier League"],
    Scotland: ["Premiership"],
    Serbia: ["Super Liga"],
    Slovakia: ["Super Liga"],
    Slovenia: ["PrvaLiga"],
    Spain: ["La Liga", "Primera División"],
    Sweden: ["Allsvenskan"],
    Switzerland: ["Super League"],
    Turkey: ["Süper Lig"],
    Ukraine: ["Premier League"],
    Wales: ["Premier League"]
  };

  const normalize = value => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const internationalCompetition = /\b(world cup|club world cup|champions league|europa league|european championship|euro qualification|euro qualifiers|nations league|copa america|africa cup of nations|afcon|asian cup|olympic football|olympics|copa do mundo|campeonato europeu|qualificacao mundial|world cup qualifiers)\b/i;
  const excludedConfederationCompetition = /\b(concacaf|gold cup)\b/i;

  try {
    const url = new URL("https://v3.football.api-sports.io/leagues");
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

    const leagues = (data.response || []).filter(item => {
      const name = item.league?.name || "";
      const country = item.country?.name || "";
      const type = item.league?.type || "";
      const normalizedCountry = normalize(country);
      const normalizedName = normalize(name);

      // Competições de seleções, em qualquer confederação.
      // As competições continentais podem surgir com "World", "Europe" ou
      // outro país/região no campo country. O nome oficial é o identificador
      // mais fiável para estas quatro provas.
      const isInternational = internationalCompetition.test(name) &&
        !excludedConfederationCompetition.test(name);

      // Só a primeira divisão de cada país europeu.
      const countryKey = country.replace(/\s+/g, "-");
      const allowedNames = firstDivisions[country] || firstDivisions[countryKey];
      const isEuropeanFirstDivision = Boolean(allowedNames) &&
        normalize(type) === "league" &&
        allowedNames.some(allowed => {
          const target = normalize(allowed);
          return normalizedName === target || normalizedName.startsWith(target + " ");
        });

      return isInternational || isEuropeanFirstDivision;
    }).map(item => ({
      id: item.league.id,
      name: item.league.name,
      country: item.country.name,
      logo: item.league.logo,
      season: item.seasons?.find(s => s.year == season)?.year || season
    }));

    leagues.sort((a, b) => {
      const aInternational = internationalCompetition.test(a.name);
      const bInternational = internationalCompetition.test(b.name);
      if (aInternational !== bInternational) return aInternational ? 1 : -1;
      return a.country.localeCompare(b.country, "pt-PT") ||
        a.name.localeCompare(b.name, "pt-PT");
    });

    return res.status(200).json({ results: leagues });
  } catch (error) {
    return res.status(502).json({
      error: "Falha de comunicação com API-Football"
    });
  }
}
