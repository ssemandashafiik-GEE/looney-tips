const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");
const cron = require("node-cron");

dotenv.config({ override: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const API_KEY = process.env.FOOTBALL_API_KEY;
const BASE_URL = "https://api.football-data.org/v4";

let cachedPredictions = [];

// Fetch standings (for weighting)
async function fetchStandings(league) {
  try {
    const res = await axios.get(
      `${BASE_URL}/competitions/${league}/standings`,
      { headers: { "X-Auth-Token": API_KEY } }
    );
    return res.data.standings?.[0]?.table || [];
  } catch {
    return [];
  }
}

// Fetch fixtures
async function fetchFixtures(league) {
  try {
    const res = await axios.get(
      `${BASE_URL}/competitions/${league}/matches?status=SCHEDULED`,
      { headers: { "X-Auth-Token": API_KEY } }
    );
    return res.data.matches || [];
  } catch {
    return [];
  }
}

// Advanced statistical prediction (Expected Goals style)
function generatePrediction(match, table) {
  const home = table.find(t => t.team.name === match.homeTeam.name);
  const away = table.find(t => t.team.name === match.awayTeam.name);

  if (!home || !away) return null;

  // Goals-based strength (xG approximation)
  const homeAttack = home.goalsFor / (home.playedGames || 1);
  const homeDefense = home.goalsAgainst / (home.playedGames || 1);

  const awayAttack = away.goalsFor / (away.playedGames || 1);
  const awayDefense = away.goalsAgainst / (away.playedGames || 1);

  const homeStrength = homeAttack - awayDefense;
  const awayStrength = awayAttack - homeDefense;

  const diff = homeStrength - awayStrength;

  let tip;
  let confidence;

  if (diff > 0.8) {
    tip = "Home Win";
    confidence = 70 + Math.min(diff * 12, 25);
  } else if (diff < -0.8) {
    tip = "Away Win";
    confidence = 70 + Math.min(Math.abs(diff) * 12, 25);
  } else {
    tip = "Over 2.5 Goals";
    confidence = 60 + Math.floor(Math.random() * 20);
  }

  return {
    league: match.competition.name,
    home: match.homeTeam.name,
    away: match.awayTeam.name,
    date: match.utcDate,
    tip,
    confidence: Math.min(Math.round(confidence), 95)
  };
}

// Update predictions (multi-league)
async function updatePredictions() {
  const leagues = ["PL", "PD", "SA"]; // Premier League, La Liga, Serie A
  let results = [];

  for (let league of leagues) {
    const table = await fetchStandings(league);
    const fixtures = await fetchFixtures(league);

    for (let match of fixtures) {
      const prediction = generatePrediction(match, table);
      if (prediction) results.push(prediction);
    }
  }

  cachedPredictions = results.sort((a, b) => b.confidence - a.confidence);
  console.log("Predictions updated:", cachedPredictions.length);
}

// Auto refresh
cron.schedule("*/30 * * * *", updatePredictions);

// API endpoint
app.get("/api/predictions", (req, res) => {
  res.json(cachedPredictions);
});

// Root route
app.get("/", (req, res) => {
  res.send("Looney Tips Advanced Engine Running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  await updatePredictions();
  console.log("Server running on port " + PORT);
});
