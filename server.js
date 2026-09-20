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
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS for_lunch BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS for_dining BOOLEAN DEFAULT false`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      paid_price INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (shop_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL REFERENCES users(id),
      shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, shop_id)
    )
  `);
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

app.get("/api/shops", requireLogin, async (req, res) => {
  try {
    const q = req.query.q || "";
    const me = req.session.userId;
    const purpose = req.query.purpose || "";
    const cond =
      purpose === "lunch" ? "AND s.for_lunch = true" :
      purpose === "dining" ? "AND s.for_dining = true" : "";
    const maxWalk = Number(req.query.walk) || 0;
    const walkCond = maxWalk ? `AND s.walk_min <= ${maxWalk}` : "";

    const result = await pool.query(
      `SELECT s.*,
              u.name AS created_by_name,
              COALESCE(AVG(r.rating), 0)::numeric(3,1) AS avg_rating,
              COUNT(DISTINCT r.id) AS review_count,
              AVG(r.paid_price)::int AS avg_price,
              COUNT(DISTINCT f.user_id) AS fav_count,
              BOOL_OR(f.user_id = $2) AS faved_by_me,
              STRING_AGG(DISTINCT fu.name, ', ') AS fav_users
       FROM shops s
       LEFT JOIN users u ON s.created_by = u.id
       LEFT JOIN reviews r ON r.shop_id = s.id
       LEFT JOIN favorites f ON f.shop_id = s.id
       LEFT JOIN users fu ON fu.id = f.user_id
       WHERE (s.name ILIKE $1 OR s.category ILIKE $1) ${cond} ${walkCond}
       GROUP BY s.id, u.name
       ORDER BY s.created_at DESC`,
      ["%" + q + "%", me]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

app.post("/api/shops", requireLogin, async (req, res) => {
  try {
    const { name, category, address, price_range, for_lunch, for_dining, lat, lng } = req.body;
    if (!name) return res.status(400).json({ error: "店名は必須です" });

    // オフィスからの直線距離で徒歩分を概算
    const OFFICE = { lat: 35.656555248889305, lng: 139.6951968036949 };
    let walk_min = null;
    if (lat && lng) {
      const R = 6371000;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat - OFFICE.lat);
      const dLng = toRad(lng - OFFICE.lng);
      const a = Math.sin(dLat/2)**2 +
                Math.cos(toRad(OFFICE.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng/2)**2;
      const dist = 2 * R * Math.asin(Math.sqrt(a));
      walk_min = Math.max(1, Math.round(dist * 1.3 / 80));
    }

    await pool.query(
      `INSERT INTO shops (name, category, address, price_range, created_by, for_lunch, for_dining, lat, lng, walk_min)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [name, category, address, price_range, req.session.userId,
       for_lunch !== false, for_dining === true, lat || null, lng || null, walk_min]
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

// ---- 口コミ ----

app.get("/api/shops/:id/reviews", requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.name AS user_name
       FROM reviews r JOIN users u ON r.user_id = u.id
       WHERE r.shop_id = $1 ORDER BY r.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

app.post("/api/shops/:id/reviews", requireLogin, async (req, res) => {
  try {
    const { rating, comment, paid_price } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "評価は1〜5で選んでください" });
    }
    await pool.query(
      `INSERT INTO reviews (shop_id, user_id, rating, comment, paid_price)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (shop_id, user_id)
       DO UPDATE SET rating = $3, comment = $4, paid_price = $5, created_at = NOW()`,
      [req.params.id, req.session.userId, rating, comment, paid_price || null]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "投稿に失敗しました" });
  }
});

// ---- お気に入り ----

app.post("/api/shops/:id/favorite", requireLogin, async (req, res) => {
  try {
    const del = await pool.query(
      "DELETE FROM favorites WHERE user_id = $1 AND shop_id = $2",
      [req.session.userId, req.params.id]
    );
    if (del.rowCount === 0) {
      await pool.query(
        "INSERT INTO favorites (user_id, shop_id) VALUES ($1, $2)",
        [req.session.userId, req.params.id]
      );
      return res.json({ faved: true });
    }
    res.json({ faved: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "操作に失敗しました" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("running on port " + port));