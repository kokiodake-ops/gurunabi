require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shops (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      address TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      walk_min INTEGER,
      price_range TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)`);
}
init();

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
}));
app.use(express.static("public"));

// ログイン必須にするための関門
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "ログインしてください" });
  }
  next();
}

// ---- 認証 ----

app.post("/api/register", async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) {
      return res.status(400).json({ error: "名前とパスワードを入力してください" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "パスワードは8文字以上にしてください" });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name, password_hash) VALUES ($1, $2) RETURNING id, name",
      [name, hash]
    );
    req.session.userId = result.rows[0].id;
    req.session.userName = result.rows[0].name;
    res.json({ name: result.rows[0].name });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(400).json({ error: "その名前は既に使われています" });
    }
    console.error(e);
    res.status(500).json({ error: "登録に失敗しました" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { name, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE name = $1", [name]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "名前かパスワードが違います" });
    }

    req.session.userId = user.id;
    req.session.userName = user.name;
    res.json({ name: user.name });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "ログインに失敗しました" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json(req.session.userId ? { name: req.session.userName } : null);
});

// ---- 店 ----

app.get("/api/shops", async (req, res) => {
  try {
    const q = req.query.q || "";
    const result = await pool.query(
      `SELECT s.*, u.name AS created_by_name
       FROM shops s LEFT JOIN users u ON s.created_by = u.id
       WHERE s.name ILIKE $1 OR s.category ILIKE $1
       ORDER BY s.created_at DESC`,
      ["%" + q + "%"]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

app.post("/api/shops", requireLogin, async (req, res) => {
  try {
    const { name, category, address, walk_min, price_range } = req.body;
    if (!name) return res.status(400).json({ error: "店名は必須です" });
    await pool.query(
      `INSERT INTO shops (name, category, address, walk_min, price_range, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [name, category, address, walk_min || null, price_range, req.session.userId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "登録に失敗しました" });
  }
});

app.delete("/api/shops/:id", requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM shops WHERE id = $1 AND created_by = $2",
      [req.params.id, req.session.userId]
    );
    if (result.rowCount === 0) {
      return res.status(403).json({ error: "自分が登録した店だけ削除できます" });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "削除に失敗しました" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("running on port " + port));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("running on port " + port));