// ===== 登録・編集で共通のフォーム =====
// mode: "new"（登録）または "edit"（編集）

const PRICE_RANGES = ["〜500円", "500〜800円", "800〜1200円", "1200〜2000円", "2000〜5000円", "5000円〜"];

async function initShopForm(mode) {
  const me = await requireMe();
  const id = param("id");
  let shop = { for_lunch: true };

  if (mode === "edit") {
    try { shop = await api("/api/shops/" + id); }
    catch (e) { alert(e.message); location.href = "/"; return; }
    renderHeader(me, [
      { label: "店一覧", href: "/" },
      { label: shop.name, href: "/shop?id=" + id },
      { label: "編集" },
    ]);
  } else {
    renderHeader(me, [{ label: "店一覧", href: "/" }, { label: "店を登録" }]);
  }
  const backUrl = mode === "edit" ? "/shop?id=" + id : "/";

  $("form").innerHTML = `
    <div class="field"><label>店名 <span style="color:var(--accent)">*</span></label>
      <input id="name" placeholder="例：日高屋 渋谷店"></div>
    <div id="attrForm"></div>
    <div class="grid">
      <div class="field"><label>ジャンル</label><input id="category" placeholder="ラーメン、和食など"></div>
      <div class="field"><label>価格帯</label>
        <select id="price_range"><option value="">選択</option>
          ${PRICE_RANGES.map(p => `<option>${p}</option>`).join("")}</select>
      </div>
    </div>
    <div class="field"><label>住所・場所</label><input id="address" placeholder="ビル名や目印でも可"></div>
    <div class="field">
      <label>場所を地図で指定</label>
      <div class="map" id="map"></div>
      <div class="hint" id="mapHint"></div>
    </div>
    <div class="err hide" id="err"></div>
    <button id="saveBtn">${mode === "edit" ? "保存する" : "登録する"}</button>
    <a class="link" href="${backUrl}">キャンセル</a>`;

  $("name").value = shop.name || "";
  $("category").value = shop.category || "";
  $("price_range").value = shop.price_range || "";
  $("address").value = shop.address || "";
  buildForm($("attrForm"));
  fillForm($("attrForm"), shop);

  // 地図：既存の位置があればピンを置いておく
  let picked = shop.lat && shop.lng ? { lat: shop.lat, lng: shop.lng } : null;
  $("mapHint").textContent = picked
    ? "現在の位置です。変えたい場合は地図をクリックしてください"
    : "地図をクリックしてピンを置いてください（徒歩時間が自動計算されます）";
  loadMaps().then(() => {
    const map = makeMap($("map"), picked || OFFICE, picked ? 17 : 16);
    let marker = picked ? new google.maps.Marker({ position: picked, map }) : null;
    map.addListener("click", e => {
      picked = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      if (marker) marker.setMap(null);
      marker = new google.maps.Marker({ position: e.latLng, map });
      $("mapHint").textContent = "ピンを置きました（クリックし直すと変更できます）";
    });
  });

  $("saveBtn").onclick = async () => {
    if (!$("name").value.trim()) { showErr("店名を入力してください"); return; }
    const body = {
      name: $("name").value.trim(),
      category: $("category").value,
      price_range: $("price_range").value,
      address: $("address").value,
      ...readForm($("attrForm")),
      lat: picked ? picked.lat : null,
      lng: picked ? picked.lng : null,
    };
    $("saveBtn").disabled = true;
    try {
      const r = mode === "edit"
        ? await api("/api/shops/" + id, { method: "PUT", body })
        : await api("/api/shops", { method: "POST", body });
      location.href = "/shop?id=" + (mode === "edit" ? id : r.id);
    } catch (e) {
      showErr(e.message);
      $("saveBtn").disabled = false;
    }
  };
}

function showErr(msg) {
  $("err").textContent = msg;
  $("err").classList.remove("hide");
}

// 区分ボタン＋詳細項目を組み立てる
function buildForm(root) {
  const chip = (v, text) => `<button type="button" class="chip" data-v="${esc(v)}">${esc(text)}</button>`;
  let html = `<div class="field"><label>区分（複数選択可）</label>
    <div class="chips" data-t="purpose">${PURPOSES.map(p => chip(p.key, p.label)).join("")}</div></div>
    <div class="attrs">`;
  ATTRS.forEach(a => {
    let body;
    if (a.type === "num") body = `<input type="number" min="0" data-num="${a.key}" placeholder="500" style="max-width:200px">`;
    else if (a.type === "bool") body = `<div class="chips" data-t="bool" data-k="${a.key}">${chip("true", a.opts[0])}${chip("false", a.opts[1])}</div>`;
    else body = `<div class="chips" data-t="${a.type}" data-k="${a.key}">${a.opts.map(o => chip(o, o)).join("")}</div>`;
    const label = a.label + (a.unit ? `（${a.unit}）` : "") + (a.type === "multi" ? "（複数選択可）" : "");
    html += `<div class="field" data-show="${a.show ? a.show.join(",") : ""}"><label>${esc(label)}</label>${body}</div>`;
  });
  root.innerHTML = html + "</div>";
  root.addEventListener("click", e => {
    const c = e.target.closest(".chip");
    if (!c) return;
    const g = c.parentElement, t = g.dataset.t;
    if (t === "purpose" || t === "multi") {
      c.classList.toggle("on");
    } else {
      const wasOn = c.classList.contains("on");
      g.querySelectorAll(".chip").forEach(x => x.classList.remove("on"));
      if (!wasOn) c.classList.add("on");   // もう一度押すと解除
    }
    if (t === "purpose") updateVisibility(root);
  });
}

// 選ばれている区分に応じて、関係する項目だけ表示する
function updateVisibility(root) {
  const active = [...root.querySelectorAll('[data-t="purpose"] .chip.on')].map(c => c.dataset.v);
  root.querySelectorAll(".field[data-show]").forEach(f => {
    const need = f.dataset.show;
    f.classList.toggle("hide", !!need && !need.split(",").some(k => active.includes(k)));
  });
}

function readForm(root) {
  const out = {};
  root.querySelectorAll(".chips").forEach(g => {
    const on = [...g.querySelectorAll(".chip.on")].map(c => c.dataset.v);
    const t = g.dataset.t, k = g.dataset.k;
    if (t === "purpose") PURPOSES.forEach(p => out[p.key] = on.includes(p.key));
    else if (t === "multi") out[k] = on;
    else if (t === "bool") out[k] = on.length ? on[0] === "true" : null;
    else out[k] = on[0] || null;
  });
  root.querySelectorAll("[data-num]").forEach(i => out[i.dataset.num] = i.value ? Number(i.value) : null);
  return out;
}

function fillForm(root, s) {
  root.querySelectorAll(".chips").forEach(g => {
    const t = g.dataset.t, k = g.dataset.k;
    g.querySelectorAll(".chip").forEach(c => {
      const v = c.dataset.v;
      let on;
      if (t === "purpose") on = !!s[v];
      else if (t === "multi") on = (s[k] || []).includes(v);
      else if (t === "bool") on = s[k] != null && String(s[k]) === v;
      else on = s[k] === v;
      c.classList.toggle("on", on);
    });
  });
  root.querySelectorAll("[data-num]").forEach(i => i.value = s[i.dataset.num] ?? "");
  updateVisibility(root);
}
