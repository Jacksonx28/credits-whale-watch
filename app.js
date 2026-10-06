'use strict';
const $ = id => document.getElementById(id);
const number = n => Number(n).toLocaleString('en-US');
const short = a => a.slice(0, 6) + '…' + a.slice(-4);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const link = (url, text, cls) => { const n = el('a', cls, text); n.href = url; n.target = '_blank'; n.rel = 'noopener noreferrer'; return n; };
const wallet = a => { const n = link('https://etherscan.io/address/' + a, short(a), 'wallet'); n.title = a; return n; };
const date = seconds => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(seconds * 1000));
let data = null, filter = 'all', limit = 25, expanded = false, busy = false, lastFailure = false;
let saved = new Set();
try { const stored = JSON.parse(localStorage.getItem('credits-watchlist') || '[]'); if (Array.isArray(stored)) saved = new Set(stored.filter(a => /^0x[0-9a-f]{40}$/.test(a))); } catch {}
const eventWallets = e => [e.from, e.to, e.wallet].filter(Boolean);
function windowEvents() {
  if (!data) return [];
  const cutoff = Date.parse(data.blockTimestamp) / 1000 - Number($('window').value) * 3600;
  return data.activity.filter(e => e.timestamp >= cutoff);
}
function freshness() {
  if (!data) return;
  const age = Math.max(0, Math.floor((Date.now() - Date.parse(data.blockTimestamp)) / 60000));
  const stale = age > 90;
  $('status').className = 'status ' + (stale || lastFailure ? 'stale' : 'fresh');
  $('status').textContent = lastFailure ? 'Refresh failed · last snapshot retained' : stale ? 'Snapshot is stale' : 'Snapshot is fresh';
  $('updated').textContent = (age < 1 ? 'Less than a minute old' : age < 60 ? age + ' minutes old' : Math.floor(age / 60) + 'h ' + (age % 60) + 'm old') + ' · updates scheduled hourly';
  $('notice').hidden = !(stale || lastFailure);
  $('notice').textContent = lastFailure ? 'Could not retrieve a new snapshot. The previous data remains visible; use Refresh to try again.' : 'The collector has not published a fresh snapshot yet. These figures are from ' + date(Date.parse(data.blockTimestamp) / 1000) + '. They are not current activity.';
}
function collectors() { return data ? data.holders.filter(h => !h.isContract && h.balance >= 80) : []; }
function positionChange(h) { return Number($('window').value) === 24 ? h.net24h : h.net48h; }
function renderBrief(events) {
  const assemblies = events.filter(e => e.type === 'assembly');
  const building = events.filter(e => e.type === 'building');
  const reductions = events.filter(e => e.type === 'reduction');
  const held = collectors().filter(h => h.retained48h);
  const growing = collectors().filter(h => positionChange(h) >= 8);
  const hours = Number($('window').value);
  $('moves').textContent = number(events.length);
  $('moves-sub').textContent = number(building.length) + ' additions · ' + number(reductions.length) + ' reductions · ' + hours + 'h';
  const fragment = document.createDocumentFragment();
  const line = el('p');
  const assembled = assemblies.reduce((n, e) => n + e.amount / 80, 0);
  line.append(el('strong', '', number(assembled) + ' Statements assembled by collector wallets'), document.createTextNode(' in this ' + hours + '-hour window, burning ' + number(assembled * 80) + ' Credits.'));
  fragment.append(line);
  const holding = el('p');
  holding.append(el('strong', '', number(held.length) + ' monitored wallets kept 80+ Credits throughout 48h'), document.createTextNode('. ' + number(growing.length) + ' current collector positions grew by at least eight Credits over ' + hours + 'h.'));
  fragment.append(holding);
  const strongest = [...growing].sort((a, b) => positionChange(b) - positionChange(a))[0];
  if (strongest) {
    const growth = el('p');
    growth.append(document.createTextNode('Largest net increase among current collectors: '), wallet(strongest.address), el('strong', '', ' +' + number(positionChange(strongest)) + ' Credits'), document.createTextNode(' → ' + number(Math.floor(strongest.balance / 80)) + ' whole Statement bundles now.'));
    fragment.append(growth);
  }
  fragment.append(el('p', 'subtle', 'Holding and adding are capacity signals. A verified burn is a composition decision; onchain balances cannot prove intent or artistic curation.'));
  $('brief').replaceChildren(fragment);
  const bars = document.createDocumentFragment();
  const end = Date.parse(data.blockTimestamp) / 1000;
  const counts = Array.from({ length: hours }, (_, i) => events.filter(e => e.timestamp > end - (hours - i) * 3600 && e.timestamp <= end - (hours - i - 1) * 3600).length);
  const max = Math.max(1, ...counts);
  for (const [i, count] of counts.entries()) {
    const bar = el('i'); bar.style.height = Math.max(3, count / max * 100) + '%';
    bar.title = date(end - (hours - i) * 3600) + ' · ' + count + ' collector signals'; bars.append(bar);
  }
  $('bars').replaceChildren(bars);
  $('bars').setAttribute('aria-label', hours + ' hourly collector signal counts: ' + counts.join(', '));
}
function eventNode(e) {
  const article = el('article', 'event');
  const symbols = { building: '+', reduction: '−', assembly: '−80' };
  article.append(el('div', 'event-mark ' + (e.type === 'building' ? 'movement' : e.type), symbols[e.type]));
  const body = el('div');
  const titles = { building: number(e.amount) + ' Credits added to a collector position', reduction: number(e.amount) + ' Credits removed from a collector position', assembly: number(e.amount / 80) + ' Statement' + (e.amount === 80 ? '' : 's') + ' assembled · ' + number(e.amount) + ' Credits burned' };
  const h = el('h3', '', titles[e.type]);
  if (e.type !== 'assembly' && e.crossed) h.append(el('span', 'tag', e.type === 'building' ? 'Bundle completed' : 'Bundle capacity fell'));
  body.append(h);
  const detail = el('p'); detail.append(wallet(e.wallet));
  if (e.type === 'assembly') detail.append(document.createTextNode(' surrendered ' + number(e.amount) + ' Credits in a verified assembly transaction.'));
  else detail.append(document.createTextNode(' · ' + number(e.before) + ' → ' + number(e.after) + ' Credits · ' + number(Math.floor(e.before / 80)) + ' → ' + number(Math.floor(e.after / 80)) + ' whole bundles.'));
  body.append(detail);
  if (e.type === 'assembly') {
    const works = el('p');
    for (const [i, id] of e.statements.entries()) { if (i) works.append(document.createTextNode(' · ')); works.append(link('https://jack.art/credits/statement/' + id, 'Statement #' + id + ' ↗')); }
    body.append(works);
  }
  const meta = el('div', 'event-meta');
  const time = el('time', '', date(e.timestamp)); time.dateTime = new Date(e.timestamp * 1000).toISOString(); time.title = new Date(e.timestamp * 1000).toUTCString();
  meta.append(time, link('https://etherscan.io/tx/' + e.tx, 'Transaction ↗'));
  article.append(body, meta); return article;
}

function renderFeed() {
  if (!data) return;
  const query = $('search').value.trim().toLowerCase().replace(/^#/, '');
  const events = windowEvents().filter(e => (filter === 'all' || filter === 'watchlist' && eventWallets(e).some(a => saved.has(a)) || e.type === filter) && (!query || [e.tx, e.from, e.to, e.wallet, e.statement, e.statements].filter(v => v !== undefined).some(v => String(v).toLowerCase().includes(query))));
  $('event-count').textContent = number(events.length) + ' update' + (events.length === 1 ? '' : 's');
  const nodes = events.slice(0, limit).map(eventNode);
  $('feed').replaceChildren(...(nodes.length ? nodes : [el('p', 'empty', filter === 'watchlist' && saved.size === 0 ? 'Save a holder with ★ to follow their recent activity here. Your watchlist stays in this browser.' : 'No matching activity in this snapshot. Try another filter, wallet or time window.')]));
  $('more').hidden = events.length <= limit;
  $('more').textContent = 'Show ' + Math.min(25, events.length - limit) + ' more updates ↓';
}
function toggleSaved(address) {
  if (saved.has(address)) saved.delete(address); else saved.add(address);
  try { localStorage.setItem('credits-watchlist', JSON.stringify([...saved])); } catch {}
  $('saved-count').textContent = saved.size;
  renderHolders(); renderFeed();
}
function renderHolders() {
  if (!data) return;
  const cohort = collectors();
  const rows = cohort.slice(0, expanded ? cohort.length : 15).map((holder, i) => {
    const row = el('tr');
    const saveCell = el('td'); const save = el('button', 'save', saved.has(holder.address) ? '★' : '☆');
    save.type = 'button'; save.setAttribute('aria-label', (saved.has(holder.address) ? 'Remove ' : 'Watch ') + holder.address); save.setAttribute('aria-pressed', String(saved.has(holder.address))); save.addEventListener('click', () => toggleSaved(holder.address)); saveCell.append(save);
    const addressCell = el('td'); addressCell.append(wallet(holder.address));
    const capacity = el('td', 'capacity-cell'); capacity.append(document.createTextNode(number(Math.floor(holder.balance / 80)) + ' ready'), el('small', '', number(80 - holder.balance % 80) + ' Credits to the next bundle'));
    const net = positionChange(holder);
    const holding = holder.retained48h ? 'Held 80+ throughout 48h' : holder.windowStartBalance < 80 ? 'Reached 80+ within 48h' : '80+ now · capacity varied';
    row.append(saveCell, el('td', '', i + 1), addressCell, el('td', '', number(holder.balance)), capacity, el('td', net > 0 ? 'positive' : net < 0 ? 'negative' : '', (net > 0 ? '+' : '') + number(net)), el('td', 'holding-signal', holding));
    return row;
  });
  if (!rows.length) { const row = el('tr'), cell = el('td', 'empty', 'No Statement-ready collector wallets in the monitored snapshot.'); cell.colSpan = 7; row.append(cell); rows.push(row); }
  $('holder-rows').replaceChildren(...rows);
  $('expand-holders').textContent = expanded ? 'Show top 15' : 'Show all ' + cohort.length;
  $('holder-caption').textContent = cohort.length + ' collector wallets holding 80+ Credits among ' + data.holders.length + ' indexed candidates, verified at block ' + number(data.block) + '. Position change includes burns and all transfers. Holding 80+ is capacity, not a promise to compose. Contract addresses are excluded; ranking is within this cohort.';
}

function render() {
  $('burned').textContent = number(data.totals.creditsBurnedIntoStatements);
  $('composed').textContent = number(data.totals.statementsComposed);
  $('circulating').textContent = number(collectors().length);
  $('circulating-sub').textContent = number(collectors().reduce((n, h) => n + Math.floor(h.balance / 80), 0)) + ' whole bundles available';
  document.querySelectorAll('.window-label').forEach(n => n.textContent = '/ ' + $('window').value + 'h');
  $('block-link').hidden = false; $('block-link').href = 'https://etherscan.io/block/' + data.block; $('block-link').textContent = 'Block ' + number(data.block) + ' ↗';
  $('saved-count').textContent = saved.size;
  renderBrief(windowEvents()); renderFeed(); renderHolders(); freshness();
}
function valid(d) {
  const address = a => /^0x[0-9a-f]{40}$/.test(a), integer = n => Number.isSafeInteger(n) && n >= 0;
  return d?.version === 2 && integer(d.block) && Number.isFinite(Date.parse(d.blockTimestamp)) && Number.isFinite(Date.parse(d.generatedAt)) && Number.isFinite(Date.parse(d.windowStart)) && Array.isArray(d.activity) && Array.isArray(d.holders) && d.totals && ['creditsBurnedIntoStatements', 'statementsComposed', 'statementsCirculating', 'statementHolders', 'overprints'].every(k => integer(d.totals[k])) && d.totals.creditsBurnedIntoStatements === d.totals.statementsComposed * 80 && d.holders.every(h => address(h.address) && integer(h.balance) && integer(h.windowStartBalance) && typeof h.isContract === 'boolean' && typeof h.retained48h === 'boolean' && Number.isSafeInteger(h.net24h) && Number.isSafeInteger(h.net48h)) && d.activity.every(e => ['building', 'reduction', 'assembly'].includes(e.type) && /^0x[0-9a-f]{64}$/.test(e.tx) && integer(e.block) && integer(e.timestamp) && integer(e.amount) && address(e.wallet) && (e.type === 'assembly' ? e.amount >= 80 && e.amount % 80 === 0 && Array.isArray(e.statements) && e.statements.every(integer) : integer(e.before) && integer(e.after) && typeof e.crossed === 'boolean'));
}

async function load() {
  if (busy) return;
  busy = true; $('refresh').disabled = true; $('refresh').textContent = 'Checking…';
  try {
    const response = await fetch('data/snapshot.json?t=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error('Unavailable snapshot');
    const next = await response.json(); if (!valid(next)) throw Error('Invalid snapshot');
    data = next; lastFailure = false; render();
  } catch {
    lastFailure = true;
    if (data) freshness();
    else {
      $('status').textContent = 'Snapshot unavailable'; $('updated').textContent = 'Use Refresh to try again.';
      $('notice').hidden = false; $('notice').textContent = 'Onchain data could not load. No live figures are being shown. You can check the linked contracts directly.';
      $('brief').replaceChildren(el('p', '', 'The activity brief will appear when verified data is available.'));
      $('feed').replaceChildren(el('p', 'empty', 'Could not load activity. Try Refresh.'));
      const row = el('tr'), cell = el('td', 'empty', 'Holder data is unavailable.'); cell.colSpan = 7; row.append(cell); $('holder-rows').replaceChildren(row);
    }
  } finally { busy = false; $('refresh').disabled = false; $('refresh').textContent = 'Refresh ↻'; }
}
$('refresh').addEventListener('click', load);
$('window').addEventListener('change', () => { limit = 25; if (data) render(); });
$('search').addEventListener('input', () => { limit = 25; renderFeed(); });
$('more').addEventListener('click', () => { limit += 25; renderFeed(); });
$('expand-holders').addEventListener('click', () => { expanded = !expanded; renderHolders(); });
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter; limit = 25;
  document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); renderFeed();
}));
setInterval(() => { freshness(); if (!document.hidden) load(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
load();

function updateBalanceDemo() {
  const share = Number($('balance-split').value), b = 32000 * share / 100, a = 32000 - b;
  $('balance-a').textContent = number(a); $('balance-b').textContent = number(b); $('split-output').textContent = share + '%';
  $('art-a').textContent = 'Artwork stays · displays ' + number(a); $('art-b').textContent = 'Artwork stays · displays ' + number(b);
  document.querySelectorAll('.balance-wallet').forEach((n, i) => n.classList.toggle('empty-balance', (i === 0 ? a : b) === 0));
  $('split-note').textContent = (a === 0 || b === 0) ? 'Even at zero, that wallet keeps its artwork. The other wallet holds the transferable quantity and its share of the mixed colors.' : 'Moving a share carries a share of the same mixed colors. Neither wallet’s artwork is transferred.';
}
$('balance-split').addEventListener('input', updateBalanceDemo); updateBalanceDemo();
