// Signal Radar dashboard. No network: every byte shown comes from data.js,
// which main.ts wrote from the same board as board.json. The page recomputes
// nothing behind the numbers — it renders the row's own figures, and the
// detail view shows the multiplication that produced the implied value.

const D = window.RADAR_DATA;
const $ = (id) => document.getElementById(id);

function fmtUsd(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}
function fmtPct(x) {
  if (x === null || x === undefined) return '—';
  return (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const state = { q: '', cat: '', sort: 'value', watch: false, high: false, sel: null };

function visibleRows() {
  let rows = D.rows.slice();
  if (state.watch) rows = rows.filter((r) => r.on_watchlist);
  if (state.high) rows = rows.filter((r) => r.confidence === 'high');
  if (state.cat) rows = rows.filter((r) => (r.category || 'Uncategorised') === state.cat);
  if (state.q) {
    const q = state.q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.includes(q));
  }
  const key = state.sort;
  rows.sort((a, b) =>
    key === 'tvl' ? b.tvl_usd - a.tvl_usd
    : key === 'growth' ? (b.change_7d ?? -99) - (a.change_7d ?? -99)
    : key === 'name' ? a.name.localeCompare(b.name)
    : b.implied_value_usd - a.implied_value_usd);
  return rows;
}

function renderTable() {
  const rows = visibleRows();
  $('rows').innerHTML = rows.map((r) => {
    const chg = r.change_7d === null ? '<td class="num">—</td>'
      : `<td class="num ${r.change_7d >= 0 ? 'up' : 'down'}">${r.change_7d >= 0 ? '+' : ''}${r.change_7d.toFixed(1)}%</td>`;
    return `<tr data-slug="${esc(r.slug)}" class="${state.sel === r.slug ? 'sel' : ''}">`
      + `<td class="num">${r.rank}</td>`
      + `<td><b>${esc(r.name)}</b> ${r.on_watchlist ? '<span class="watch">● watchlist</span>' : ''}<br><span style="color:var(--muted);font-size:12px">${esc(r.slug)}</span></td>`
      + `<td>${esc(r.category || '—')}</td>`
      + `<td>${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ' +' + (r.chains.length - 3) : ''}</td>`
      + `<td class="num">${fmtUsd(r.tvl_usd)}</td>`
      + chg
      + `<td class="num mult">${r.multiple.toFixed(2)}×</td>`
      + `<td class="num val">${fmtUsd(r.implied_value_usd)}</td>`
      + `<td><span class="pill ${r.confidence}">${r.confidence}</span></td></tr>`;
  }).join('');
  $('count').textContent = `Showing ${rows.length} of ${D.rows.length} ranked protocols. Click a row for its detail view.`;
  document.querySelectorAll('#rows tr').forEach((tr) => {
    tr.addEventListener('click', () => { state.sel = tr.dataset.slug; renderTable(); renderDetail(); });
  });
}

function renderDetail() {
  const box = $('detail');
  const row = D.rows.find((r) => r.slug === state.sel);
  if (!row) {
    box.innerHTML = '<p class="hint">Click a row to open its detail view: the value math and its farm plan.</p>';
    return;
  }
  const steps = D.board.find((b) => b.slug === row.slug);
  const math = `${fmtUsd(row.tvl_usd)} TVL × ${row.multiple.toFixed(3)} peer multiple`
    + ` × ${row.growth_factor.toFixed(3)} growth × ${row.maturity_factor.toFixed(3)} maturity`
    + ` × ${row.breadth_factor.toFixed(3)} breadth = ${fmtUsd(row.implied_value_usd)}`;
  box.innerHTML = `<h2>${esc(row.name)}</h2>`
    + `<p style="color:var(--muted);margin-top:0">${esc(row.slug)} · ${esc(row.category || 'Uncategorised')} · ${esc(row.chains.join(', '))}`
    + (row.on_watchlist ? ' · <span class="watch">● on the watchlist</span>' : '')
    + ` · confidence: <span class="pill ${row.confidence}">${row.confidence}</span></p>`
    + `<div class="grid"><span>Rank <b>#${row.rank}</b></span>`
    + `<span>TVL <b>${fmtUsd(row.tvl_usd)}</b></span>`
    + `<span>7-day change <b>${fmtPct(row.change_7d)}</b></span>`
    + `<span>Listed <b>${esc(row.listed_at || 'unknown date')}</b> (${row.age_days === null ? 'age unknown' : row.age_days + ' days'})</span></div>`
    + `<h3>How the implied value is made</h3><p class="math">${esc(math)}</p>`
    + `<p>The multiple is the median market-cap-to-TVL of token protocols in the ${esc(row.category || 'same')} peer set, shrunk toward the global median. Growth, maturity and chain breadth adjust it; nothing here uses a hardcoded name.</p>`
    + `<h3>How to farm it</h3><ol>${(steps ? steps.farm_steps : []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
    + `<p class="hint">This protocol records no token in the snapshot — that is the snapshot's record, not a promise that a token will be issued. Never send funds to anyone offering to farm for you.</p>`;
}

function renderMeta() {
  $('meta').innerHTML = `Snapshot <b>${esc(D.as_of)}</b><br>Source: DefiLlama protocols<br>Model <b>${esc(D.model_version)}</b> · median peer multiple <b>${D.median_multiple.toFixed(2)}×</b>`;
  const watch = D.rows.filter((r) => r.on_watchlist).length;
  const high = D.rows.filter((r) => r.confidence === 'high').length;
  $('stats').innerHTML = [
    [D.rows.length, 'ranked protocols'],
    [watch, 'on the watchlist'],
    [high, 'high-confidence rows'],
    [fmtUsd(D.rows[0].implied_value_usd), 'top implied value'],
  ].map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  const cats = [...new Set(D.rows.map((r) => r.category || 'Uncategorised'))].sort();
  $('cat').innerHTML = '<option value="">All categories</option>'
    + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('method').textContent = 'Peer multiples: each token protocol’s market cap divided by its TVL, winsorised at the 90th percentile; the category median is shrunk toward the global median with a prior of 8 peers. Implied value = TVL × multiple × growth (7-day change, weight 0.5) × maturity (0.70–1.00 over 730 days listed) × chain breadth (up to 1.20). The board covers the whole 40-protocol watchlist plus the strongest plausible pre-token protocols below the floor, by TVL.';
}

function applyHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('detail')) state.sel = h.get('detail');
  if (h.get('cat')) { state.cat = h.get('cat'); $('cat').value = state.cat; }
  if (h.get('q')) { state.q = h.get('q'); $('q').value = state.q; }
  if (h.get('sort')) { state.sort = h.get('sort'); $('sort').value = state.sort; }
  if (h.get('watch')) { state.watch = true; $('watch').checked = true; }
  if (h.get('detail')) {
    setTimeout(() => document.getElementById('detail').scrollIntoView(), 50);
  }
}

$('q').addEventListener('input', (e) => { state.q = e.target.value; renderTable(); });
$('cat').addEventListener('change', (e) => { state.cat = e.target.value; renderTable(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderTable(); });
$('watch').addEventListener('change', (e) => { state.watch = e.target.checked; renderTable(); });
$('high').addEventListener('change', (e) => { state.high = e.target.checked; renderTable(); });
window.addEventListener('hashchange', () => { applyHash(); renderTable(); renderDetail(); });

renderMeta();
applyHash();
renderTable();
renderDetail();
