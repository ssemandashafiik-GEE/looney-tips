// server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// Load .env but DO NOT override existing environment variables
dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || "change_this_in_production";

// Connect to MongoDB
if (!MONGO_URI) {
  console.error("MONGO_URI not set. Exiting.");
  process.exit(1);
}
mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });

// Models
const Prediction = mongoose.model("Prediction", new mongoose.Schema({
  league: String, home: String, away: String, date: String,
  tip: String, confidence: Number, created: { type: Date, default: Date.now }
}));

const User = mongoose.model("User", new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  role: String
}));

// Simple auth helpers
async function createUserIfMissing(username, password, role = "admin"){
  const exists = await User.findOne({ username });
  if (exists) return;
  const hash = await bcrypt.hash(password, 12);
  await User.create({ username, password: hash, role });
}

// (optional) create default admin from env vars for first deploy (only if provided)
if (process.env.INIT_ADMIN_USERNAME && process.env.INIT_ADMIN_PASSWORD) {
  createUserIfMissing(process.env.INIT_ADMIN_USERNAME, process.env.INIT_ADMIN_PASSWORD, "admin")
    .then(()=>console.log("Init admin check complete"))
    .catch(e=>console.error(e));
}

// Auth middleware
function extractToken(req){
  const header = req.headers["authorization"] || "";
  if (!header) return null;
  if (header.startsWith("Bearer ")) return header.split(" ")[1];
  return header;
}
function auth(req, res, next){
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Routes: register/login/me/admin/stats/predictions
app.post("/api/register", async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  try {
    const hash = await bcrypt.hash(password, 12);
    await User.create({ username, password: hash, role: role || "user" });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "User exists or invalid" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, role: user.role });
});

app.get("/api/me", auth, async (req, res) => {
  const u = await User.findById(req.user.id).select("-password");
  res.json(u || null);
});

app.get("/api/admin/stats", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Not allowed" });
  const totalPredictions = await Prediction.countDocuments();
  const users = await User.countDocuments();
  res.json({ totalPredictions, users });
});

app.get("/api/predictions", async (req, res) => {
  const { league, search } = req.query;
  const q = {};
  if (league) q.league = league;
  if (search) q.$or = [{ home: new RegExp(search, "i") }, { away: new RegExp(search, "i") }];
  const data = await Prediction.find(q).sort({ created: -1 }).limit(500);
  res.json(data);
});

// serve frontend
app.get("/", (req, res) => res.sendFile(__dirname + "/public/index.html"));
app.get("/admin", (req, res) => res.sendFile(__dirname + "/public/admin.html"));

// Use the host-provided PORT (Render sets process.env.PORT). Do NOT force a different port.
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
