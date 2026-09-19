require("dotenv").config();

const express = require("express");
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
}
init();

app.use(express.json());
app.use(express.static("public"));

app.get("/api/shops", async (req, res) => {
  try {
    const q = req.query.q || "";
    const result = await pool.query(
      `SELECT * FROM shops
       WHERE name ILIKE $1 OR category ILIKE $1
       ORDER BY created_at DESC`,
      ["%" + q + "%"]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

app.post("/api/shops", async (req, res) => {
  try {
    const { name, category, address, walk_min, price_range } = req.body;
    if (!name) return res.status(400).json({ error: "店名は必須です" });
    await pool.query(
      `INSERT INTO shops (name, category, address, walk_min, price_range)
       VALUES ($1, $2, $3, $4, $5)`,
      [name, category, address, walk_min || null, price_range]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "登録に失敗しました" });
  }
});

app.delete("/api/shops/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM shops WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "削除に失敗しました" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("running on port " + port));