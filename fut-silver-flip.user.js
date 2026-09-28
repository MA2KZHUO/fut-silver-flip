// ==UserScript==
// @name         银卡捡漏台 (FUT.GG 实时)
// @namespace    silver-flip
// @version      1.0
// @description  在 fut.gg 上实时列出 FUT Gallery 中 S 门槛最低球队里的便宜银卡，并计算税后倒卖利润
// @match        https://www.fut.gg/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__silverFlip) return;
  window.__silverFlip = true;

  const GAME = 'fc27', G2 = '27';
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('sf_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sf_' + k, JSON.stringify(v)); } catch (e) {} },
  };
  const cfg = Object.assign({ nTeams: 15, maxP: 1500, steps: 2, tier: '', plat: 'ps5', auto: 3, sort: 'p', dir: 1 }, LS.get('cfg', {}));
  const defs = LS.get('defs', {});          // eaId -> [name, pos, nation, url]
  const setCache = {};                     // slug -> {t, data}
  let hub = null, rows = [], lastPrice = null, timer = null, busy = false, q = '', teamPick = null;

  // ---------- helpers ----------
  const step = p => p < 1000 ? 50 : p < 10000 ? 100 : p < 50000 ? 250 : p < 100000 ? 500 : 1000;
  const up = (p, k) => { for (let i = 0; i < k; i++) p += step(p); return p; };
  const be = p => { let s = Math.max(200, p); while (Math.floor(s * 0.95) < p) s += step(s); return s; };
  const fmt = n => n == null ? '—' : Number(n).toLocaleString('en-US');
  const POS = ['GK','SW','RWB','RB','RCB','CB','LCB','LB','LWB','RDM','CDM','LDM','RM','RCM','CM','LCM','LM','RAM','CAM','LAM','RF','CF','LF','RW','RS','ST','LS','LW'];
  const getJSON = async (u, o) => { const r = await fetch(u, o); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
  async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } })); }

  // ---------- data ----------
  async function loadPrices() {
    const m = await getJSON('https://r2.fut.gg/' + G2 + '/manifest.json', { cache: 'no-store' });
    const key = 'player-prices-' + cfg.plat + '-dyn';
    const [idx, pr] = await Promise.all([
      getJSON(`https://r2.fut.gg/${G2}/player-prices-index.v1.${m['player-prices-index']}.json`),
      getJSON(`https://r2.fut.gg/${G2}/${key}.v1.${m[key]}.json`),
    ]);
    const map = new Map(); let id = idx.id0; map.set(id, 0);
    idx.d.forEach((x, i) => { id += x; map.set(id, i + 1); });
    return { at: (m._published_at && m._published_at[key]) ? m._published_at[key] * 1000 : Date.now(), get: e => { const i = map.get(e); return i == null ? null : (pr.p[i] || null); } };
  }
  async function loadSet(s) {
    const c = setCache[s.slug];
    if (c && Date.now() - c.t < 20 * 60 * 1000) return c.data;
    const d = (await getJSON(`/api/fut/gallery/${GAME}/sets/${s.cat}/${s.slug}/`)).data;
    setCache[s.slug] = { t: Date.now(), data: d };
    return d;
  }
  async function loadDef(e) {
    try {
      const d = (await getJSON(`/api/fut/player-item-definitions/${G2}/${e}/`)).data;
      defs[e] = [d.commonName || [d.firstName, d.lastName].filter(Boolean).join(' '), POS[d.position] || '', (d.nation && d.nation.name) || '', d.url || ''];
    } catch (err) { defs[e] = ['#' + e, '', '', '']; }
  }

  async function refresh() {
    if (busy) return; busy = true; setStatus('正在读取…');
    try {
      if (!hub || Date.now() - hub.t > 20 * 60 * 1000) {
        const h = (await getJSON(`/api/fut/gallery/${GAME}/hub/`)).data;
        const stats = Object.fromEntries(h.sets.map(s => [s.setId, s]));
        const teams = h.categories.flatMap(c => c.sets.filter(s => s.clubEaId).map(s => ({
          id: s.id, n: s.name, slug: s.slug, cat: c.slug, lg: c.name.split(' / ')[0],
          S: s.grades.find(g => g.name === 'S').threshold, bg: stats[s.id] && stats[s.id].grade,
        }))).sort((a, b) => a.S - b.S || a.n.localeCompare(b.n));
        hub = { t: Date.now(), teams };
      }
      const teams = hub.teams.slice(0, cfg.nTeams);
      setStatus('读取球队阵容…');
      const found = new Map();
      await pool(teams, 4, async t => {
        const d = await loadSet(t);
        const tiers = (d.solution && d.solution.costTiers) || [];
        t.ok = tiers.length > 0; t.maxg = tiers.length ? tiers[tiers.length - 1].grade : null;
        const sil = new Set();
        tiers.forEach(tr => tr.items.forEach(x => {
          if (x.overall < 65 || x.overall > 74 || !(x.rarityEaId === 0 || x.rarityEaId === 1)) return;
          sil.add(x.eaId);
          const r = found.get(x.eaId) || { e: x.eaId, o: x.overall, team: t, snap: x.price, t: '' };
          if (!r.t.includes(tr.grade)) r.t += tr.grade;
          found.set(x.eaId, r);
        }));
        t.nsil = sil.size;
      });
      const need = [...found.keys()].filter(e => !defs[e]);
      if (need.length) {
        let done = 0;
        await pool(need, 6, async e => { await loadDef(e); done++; if (done % 20 === 0) setStatus(`首次读取球员名字 ${done}/${need.length}（之后会缓存）`); });
        LS.set('defs', defs);
      }
      setStatus('读取实时价格…');
      lastPrice = await loadPrices();
      rows = [...found.values()].map(r => {
        const live = lastPrice.get(r.e);
        const p = live || r.snap;
        const [n, pos, nat, url] = defs[r.e] || ['#' + r.e, '', '', ''];
        return { ...r, n, pos, nat, url, p, live: !!live, chg: live && r.snap ? live - r.snap : 0 };
      });
      hub.shown = teams;
      setStatus(`价格更新于 ${new Date(lastPrice.at).toLocaleTimeString()}`);
      render();
    } catch (err) {
      setStatus('读取失败：' + err.message + '。稍后点「刷新」重试。');
    } finally { busy = false; }
  }

  // ---------- UI ----------
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483000;inset:auto 18px 18px auto';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    :host{all:initial}
    [hidden]{display:none!important}
    *{box-sizing:border-box;font-family:Barlow,"Noto Sans SC",system-ui,-apple-system,sans-serif}
    .fab{background:linear-gradient(160deg,#c9ced6,#8e97a3);color:#15181c;border:0;border-radius:999px;padding:11px 18px;font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.35)}
    .panel{position:fixed;inset:24px;max-width:1200px;margin:auto;background:#15191e;color:#e8ebef;border:1px solid #2d333c;border-radius:12px;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden}
    .top{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:end;padding:14px 16px;border-bottom:1px solid #2d333c;background:#1b2027}
    h2{margin:0;font-size:22px;font-weight:700;margin-right:auto}
    h2 small{display:block;font-size:12px;color:#9aa3ae;font-weight:500}
    label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa3ae}
    input,select{background:#232931;color:#e8ebef;border:1px solid #37404b;border-radius:6px;padding:6px 8px;font-size:14px;width:120px}
    button.b{background:#232931;color:#e8ebef;border:1px solid #37404b;border-radius:6px;padding:7px 12px;font-size:14px;cursor:pointer}
    button.b.pri{background:#e3b341;color:#1a1405;border-color:#e3b341;font-weight:700}
    .status{padding:6px 16px;font-size:12px;color:#9aa3ae;border-bottom:1px solid #2d333c}
    .teams{display:flex;gap:6px;overflow-x:auto;padding:10px 16px;border-bottom:1px solid #2d333c}
    .tm{flex:0 0 auto;background:#1f242b;border:1px solid #2d333c;border-radius:8px;padding:6px 10px;color:#e8ebef;text-align:left;cursor:pointer;font-size:13px}
    .tm b{display:block}.tm span{color:#9aa3ae;font-size:12px}
    .tm.on{background:#e8ebef;color:#111418}.tm.on span{color:#444}
    .body{overflow:auto;flex:1}
    table{border-collapse:collapse;width:100%;min-width:900px;font-variant-numeric:tabular-nums;font-size:14px}
    th,td{padding:7px 10px;border-bottom:1px solid #262c34;text-align:left;white-space:nowrap}
    th{position:sticky;top:0;background:#1b2027;color:#9aa3ae;font-size:12px;cursor:pointer;user-select:none}
    .r{text-align:right}
    a{color:#e8ebef;font-weight:600;text-decoration:none}a:hover{text-decoration:underline}
    .ovr{display:inline-block;width:30px;text-align:center;border-radius:4px;background:linear-gradient(160deg,#c9ced6,#8e97a3);color:#15181c;font-weight:700;margin-right:8px}
    .sub{color:#9aa3ae;font-size:12px}
    .ti span{display:inline-block;width:18px;text-align:center;font-size:11px;font-weight:700;border-radius:3px;background:#262c34;color:#6b7480;margin-right:2px}
    .ti span.on{background:#e8ebef;color:#111418}.ti span.on.s{background:#e3b341}
    .pos{color:#5fd08d;font-weight:600}.neg{color:#f2837a;font-weight:600}
    .price{color:#e3b341;font-weight:700}
    .x{background:none;border:0;color:#9aa3ae;font-size:22px;cursor:pointer;padding:0 4px}
  </style>
  <button class="fab" id="fab">银卡捡漏</button>
  <div class="panel" id="panel" hidden>
    <div class="top">
      <h2>银卡捡漏台 <small>FUT Gallery · S 门槛最低球队里的银卡 · 实时价格</small></h2>
      <label>平台<select id="plat"><option value="ps5">主机</option><option value="pc">PC</option></select></label>
      <label>前几支球队<input id="nTeams" type="number" min="3" max="112"></label>
      <label>买入价上限<input id="maxP" type="number" min="0" step="50"></label>
      <label>挂牌加几档<select id="steps"><option>1</option><option>2</option><option>3</option><option>4</option></select></label>
      <label>阵容等级<select id="tier"><option value="">任意</option><option value="S">S 级阵容</option><option value="A">A 级及以上</option></select></label>
      <label>自动刷新<select id="auto"><option value="0">关</option><option value="1">每 1 分钟</option><option value="3">每 3 分钟</option><option value="5">每 5 分钟</option></select></label>
      <label>搜索<input id="q" type="text" placeholder="球员/球队"></label>
      <button class="b pri" id="go">刷新</button>
      <button class="x" id="close" title="关闭">×</button>
    </div>
    <div class="status" id="status">点「刷新」开始</div>
    <div class="teams" id="teams"></div>
    <div class="body"><table><thead><tr id="th"></tr></thead><tbody id="tb"></tbody></table></div>
  </div>`;
  const $ = s => root.getElementById(s);
  const setStatus = t => { $('status').textContent = t; };

  ['plat', 'nTeams', 'maxP', 'steps', 'tier', 'auto'].forEach(k => { $(k).value = cfg[k]; });
  const save = () => LS.set('cfg', cfg);
  $('fab').onclick = () => { $('panel').hidden = false; $('fab').hidden = true; if (!rows.length) refresh(); schedule(); };
  $('close').onclick = () => { $('panel').hidden = true; $('fab').hidden = false; clearInterval(timer); };
  $('go').onclick = () => refresh();
  $('plat').onchange = e => { cfg.plat = e.target.value; save(); refresh(); };
  $('nTeams').onchange = e => { cfg.nTeams = Math.max(3, +e.target.value || 15); save(); teamPick = null; refresh(); };
  $('maxP').oninput = e => { cfg.maxP = +e.target.value || 0; save(); render(); };
  $('steps').onchange = e => { cfg.steps = +e.target.value; save(); render(); };
  $('tier').onchange = e => { cfg.tier = e.target.value; save(); render(); };
  $('auto').onchange = e => { cfg.auto = +e.target.value; save(); schedule(); };
  $('q').oninput = e => { q = e.target.value.trim().toLowerCase(); render(); };
  function schedule() { clearInterval(timer); if (cfg.auto > 0) timer = setInterval(() => { if (!$('panel').hidden && !document.hidden) refresh(); }, cfg.auto * 60000); }

  const cols = [['n','球员'],['club','球队'],['S','S 门槛',1],['t','阵容等级'],['p','实时买入价',1],['chg','较阵容时',1],['be','保本挂牌',1],['sell','建议挂牌',1],['pr','每张利润',1],['roi','回报率',1]];
  $('th').onclick = e => { const th = e.target.closest('th'); if (!th) return; const k = th.dataset.k; if (cfg.sort === k) cfg.dir *= -1; else { cfg.sort = k; cfg.dir = ['pr','roi','chg'].includes(k) ? -1 : 1; } save(); render(); };
  $('teams').onclick = e => { const b = e.target.closest('.tm'); if (!b) return; const id = +b.dataset.id; teamPick = teamPick === id ? null : id; render(); };

  function render() {
    if (!hub || !hub.shown) return;
    $('teams').innerHTML = hub.shown.map(t => `<button class="tm ${teamPick === t.id ? 'on' : ''}" data-id="${t.id}"><b>${t.n} · S ${fmt(t.S)}</b><span>${t.ok ? `${t.nsil} 张银卡 · 最高 ${t.maxg}` : '卡不够，暂不能做'}</span></button>`).join('');
    let list = rows.map(r => {
      const sell = up(Math.max(r.p, 200), cfg.steps), net = Math.floor(sell * 0.95);
      return { ...r, club: r.team.n, S: r.team.S, be: be(r.p), sell, pr: net - r.p, roi: (net - r.p) / r.p };
    });
    if (teamPick != null) list = list.filter(r => r.team.id === teamPick);
    if (cfg.maxP > 0) list = list.filter(r => r.p <= cfg.maxP);
    if (cfg.tier === 'S') list = list.filter(r => r.t.includes('S'));
    if (cfg.tier === 'A') list = list.filter(r => /[AS]/.test(r.t));
    if (q) list = list.filter(r => (r.n + ' ' + r.club + ' ' + r.nat).toLowerCase().includes(q));
    const k = cfg.sort, d = cfg.dir;
    list.sort((a, b) => { const x = a[k], y = b[k]; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d || a.p - b.p; });
    $('th').innerHTML = cols.map(([key, l, num]) => `<th data-k="${key}" class="${num ? 'r' : ''}">${l}${cfg.sort === key ? (cfg.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    $('tb').innerHTML = list.length ? list.slice(0, 400).map(r => `<tr>
      <td><span class="ovr">${r.o}</span><a href="${r.url}" target="_blank">${r.n}</a> <span class="sub">${r.pos} · ${r.nat}</span></td>
      <td>${r.club} <span class="sub">${r.team.lg}</span></td>
      <td class="r">${fmt(r.S)}</td>
      <td class="ti">${['D','C','B','A','S'].map(g => `<span class="${r.t.includes(g) ? 'on' : ''}${g === 'S' ? ' s' : ''}">${g}</span>`).join('')}</td>
      <td class="r"><span class="price">${fmt(r.p)}</span>${r.live ? '' : ' <span class="sub">(旧)</span>'}</td>
      <td class="r ${r.chg > 0 ? 'pos' : r.chg < 0 ? 'neg' : 'sub'}">${r.chg ? (r.chg > 0 ? '+' : '') + fmt(r.chg) : '—'}</td>
      <td class="r">${fmt(r.be)}</td>
      <td class="r">${fmt(r.sell)}</td>
      <td class="r ${r.pr > 0 ? 'pos' : 'neg'}">${r.pr > 0 ? '+' : ''}${fmt(r.pr)}</td>
      <td class="r">${(r.roi * 100).toFixed(1)}%</td></tr>`).join('')
      : `<tr><td colspan="10" style="padding:24px;text-align:center;color:#9aa3ae">没有符合条件的银卡，调高买入价上限或多看几支球队试试。</td></tr>`;
  }
})();
