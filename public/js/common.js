// ===== 全画面で共通の部品 =====

const OFFICE = { lat: 35.656555248889305, lng: 139.6951968036949 };
const MAPS_KEY = "AIzaSyBqTEJ15xCXIJMGG5iRyfTJ9mWnmf79Xik";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const stars = n => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
const param = key => new URLSearchParams(location.search).get(key);

// API 呼び出し。ログイン切れならログイン画面へ、エラーなら例外を投げる
async function api(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  // ログイン切れ（ログイン画面自体の「パスワード違い」は除く）
  if (res.status === 401 && !location.pathname.startsWith("/login")) {
    goLogin(); return new Promise(() => {});   // 画面遷移するまで待つ
  }
  if (!res.ok) throw new Error(data?.error || "エラーが発生しました");
  return data;
}

function goLogin() {
  location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
}

// ログインしていなければログイン画面へ。していればユーザー情報を返す
async function requireMe() {
  const me = await api("/api/me");
  if (!me) { goLogin(); return new Promise(() => {}); }
  return me;
}

async function logout() {
  await api("/api/logout", { method: "POST" });
  location.href = "/login";
}

// ヘッダーとパンくずを描画する
// crumbs: [{ label, href }, ...]  最後の要素が今いる画面
function renderHeader(me, crumbs = []) {
  const header = document.createElement("header");
  header.className = "topbar";
  header.innerHTML = `
    <div class="topbar-in">
      <a href="/" class="brand">サクヤぐるなび</a>
      ${me ? `<div class="who">${esc(me.name)} さん <button class="link" onclick="logout()">ログアウト</button></div>` : ""}
    </div>`;
  document.body.prepend(header);

  if (!crumbs.length) return;

  // 直前の画面が親と同じページなら、絞り込み条件などの付いた URL に戻す
  const ref = document.referrer ? new URL(document.referrer) : null;
  crumbs.forEach(c => {
    if (c.href && ref && ref.origin === location.origin &&
        ref.pathname === new URL(c.href, location.origin).pathname) {
      c.href = ref.pathname + ref.search;
    }
  });
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
  const nav = document.createElement("nav");
  nav.className = "crumbs";
  nav.innerHTML =
    (parent ? `<a class="back" href="${parent.href}">‹ 戻る</a>` : "") +
    crumbs.map((c, i) => i === crumbs.length - 1
      ? `<span class="here">${esc(c.label)}</span>`
      : `<a href="${c.href}">${esc(c.label)}</a><span class="sep">›</span>`
    ).join("");
  document.querySelector(".wrap").prepend(nav);
  document.title = crumbs[crumbs.length - 1].label + " | サクヤぐるなび";
}

// Google Maps を読み込む（地図を使う画面だけで呼ぶ）
let mapsPromise = null;
function loadMaps() {
  if (!mapsPromise) {
    mapsPromise = new Promise(resolve => {
      window.__mapsReady = resolve;
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&callback=__mapsReady`;
      s.async = true;
      document.head.appendChild(s);
    });
  }
  return mapsPromise;
}

function makeMap(el, center = OFFICE, zoom = 16) {
  const map = new google.maps.Map(el, { center, zoom, mapTypeControl: false, streetViewControl: false });
  new google.maps.Marker({ position: OFFICE, map, label: "社", title: "オフィス" });
  return map;
}

// ===== 区分と詳細項目（選択肢は server.js の OPTIONS と揃えること） =====
const PURPOSES = [
  { key: "for_lunch",  label: "昼飯",   cls: "" },
  { key: "for_dinner", label: "晩飯",   cls: "dinner" },
  { key: "for_dining", label: "会食",   cls: "dining" },
  { key: "for_drinks", label: "飲み屋", cls: "drinks" },
];
const MEAL = ["for_lunch", "for_dinner"];
const ATTRS = [
  { key: "invoice",     label: "インボイス領収書", type: "bool",  opts: ["可", "不可"], show: ["for_dining"] },
  { key: "group_sizes", label: "推奨人数",   type: "multi", opts: ["1人", "2〜4人", "5〜10人", "11人以上"], show: [...MEAL, "for_drinks"] },
  { key: "smoking",     label: "喫煙",       type: "one",   opts: ["禁煙", "電子のみ可", "紙も可"], show: ["for_drinks"] },
  { key: "nomihodai",   label: "飲み放題",   type: "bool",  opts: ["あり", "なし"], show: ["for_drinks"] },
  { key: "drink_price", label: "1杯あたりの値段", type: "num", unit: "円", show: ["for_drinks"] },
  { key: "garlic",      label: "にんにく",   type: "bool",  opts: ["あり", "なし"], show: MEAL },
  { key: "health",      label: "健康度合い", type: "one",   opts: ["ヘルシー", "普通", "ガッツリ"], show: MEAL },
  { key: "speed",       label: "提供スピード", type: "one", opts: ["すぐ出る", "普通", "時間かかる"], show: MEAL },
  { key: "payments",    label: "決済手段",   type: "multi", opts: ["現金", "PayPay", "クレカ"], show: null },
];

const PRICE_RANGES = ["〜500円", "500〜800円", "800〜1200円", "1200〜2000円", "2000〜5000円", "5000円〜"];

const purposeTags = s =>
  PURPOSES.filter(p => s[p.key]).map(p => `<span class="tag ${p.cls}">${p.label}</span>`).join("");

// 詳細項目の値を表示用の文字にする（未入力なら null）
function attrText(a, s) {
  const v = s[a.key];
  if (v == null || (Array.isArray(v) && !v.length)) return null;
  if (a.type === "bool") return v ? a.opts[0] : a.opts[1];
  if (a.type === "multi") return v.join("・");
  if (a.type === "num") return v + (a.unit || "");
  return v;
}

// 一覧用の短いタグ
function attrTags(s) {
  const t = [];
  if (s.invoice != null) t.push("インボイス" + (s.invoice ? "可" : "不可"));
  if (s.group_sizes?.length) t.push("推奨 " + s.group_sizes.join("・"));
  if (s.smoking) t.push(s.smoking === "禁煙" ? "禁煙" : "喫煙 " + s.smoking);
  if (s.nomihodai != null) t.push("飲み放題" + (s.nomihodai ? "あり" : "なし"));
  if (s.drink_price) t.push("1杯 " + s.drink_price + "円");
  if (s.garlic != null) t.push("にんにく" + (s.garlic ? "あり" : "なし"));
  if (s.health) t.push(s.health);
  if (s.speed) t.push("提供 " + s.speed);
  if (s.payments?.length) t.push(s.payments.join("・"));
  return t.length ? "<div>" + t.map(x => `<span class="attr">${esc(x)}</span>`).join("") + "</div>" : "";
}
