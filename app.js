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
function renderBrief(events) {
  const assemblies = events.filter(e => e.type === 'assembly');
  const prints = events.filter(e => e.type === 'overprint');
  const movements = events.filter(e => e.type === 'movement');
  const transfers = events.filter(e => e.type === 'statement-transfer');
  const hours = Number($('window').value);
  $('moves').textContent = number(movements.length);
  $('moves-sub').textContent = number(movements.reduce((n, e) => n + e.amount, 0)) + ' Credits moved · ' + hours + 'h';
  const fragment = document.createDocumentFragment();
  const line = el('p');
  line.append(el('strong', '', number(assemblies.length) + ' Statements assembled'), document.createTextNode(' in this ' + hours + '-hour window, removing ' + number(assemblies.length * 80) + ' Credits. ' + number(prints.length) + ' overprint' + (prints.length === 1 ? '' : 's') + ' reduced Statement circulation by ' + number(prints.length) + '.'));
  fragment.append(line);
  const biggest = [...movements].sort((a, b) => b.amount - a.amount)[0];
  const moveLine = el('p');
  if (biggest) {
    moveLine.append(document.createTextNode('Largest tracked move: '), el('strong', '', number(biggest.amount) + ' Credits'), document.createTextNode(' from '), wallet(biggest.from), document.createTextNode(' to '), wallet(biggest.to), document.createTextNode('. '), link('https://etherscan.io/tx/' + biggest.tx, 'See transaction ↗'));
  } else moveLine.textContent = 'No qualifying whale movements were found in this window.';
  fragment.append(moveLine, el('p', 'subtle', number(transfers.length) + ' Statement transfers observed. Movements show where ink went; they do not tell us why.'));
  $('brief').replaceChildren(fragment);
  const bars = document.createDocumentFragment();
  const end = Date.parse(data.blockTimestamp) / 1000;
  const counts = Array.from({ length: hours }, (_, i) => events.filter(e => e.timestamp > end - (hours - i) * 3600 && e.timestamp <= end - (hours - i - 1) * 3600).length);
  const max = Math.max(1, ...counts);
  for (const [i, count] of counts.entries()) {
    const bar = el('i'); bar.style.height = Math.max(3, count / max * 100) + '%';
    bar.title = date(end - (hours - i) * 3600) + ' · ' + count + ' events';
    bars.append(bar);
  }
  $('bars').replaceChildren(bars);
  $('bars').setAttribute('aria-label', hours + ' hourly activity counts: ' + counts.join(', '));
}
function eventNode(e) {
  const article = el('article', 'event');
  const symbols = { movement: '↗', assembly: '−80', overprint: '⊕', 'statement-transfer': '→' };
  article.append(el('div', 'event-mark ' + e.type, symbols[e.type]));
  const body = el('div');
  const titles = { movement: number(e.amount) + ' Credits moved', assembly: 'Statement #' + e.statement + ' assembled', overprint: 'Statement #' + e.top + ' overprinted into #' + e.base, 'statement-transfer': 'Statement #' + e.statement + ' transferred' };
  const h = el('h3', '', titles[e.type]);
  if (e.type === 'movement' && e.amount >= 80) h.append(el('span', 'tag', '80+ in one tx'));
  body.append(h);
  const p = el('p');
  if (e.type === 'movement' || e.type === 'statement-transfer') p.append(wallet(e.from), document.createTextNode(' → '), wallet(e.to));
  else if (e.type === 'assembly') p.append(wallet(e.wallet), document.createTextNode(' received a new page; 80 Credits were burned in this transaction.'));
  else p.append(wallet(e.wallet), document.createTextNode(' combined two pages; the top Statement was burned.'));
  body.append(p);
  if (e.statement) { const l = el('p'); l.append(link('https://jack.art/credits/statement/' + e.statement, 'View Statement ↗')); body.append(l); }
  const meta = el('div', 'event-meta');
  const time = el('time', '', date(e.timestamp)); time.dateTime = new Date(e.timestamp * 1000).toISOString(); time.title = new Date(e.timestamp * 1000).toUTCString();
  meta.append(time, link('https://etherscan.io/tx/' + e.tx, 'Transaction ↗'));
  article.append(body, meta);
  return article;
}
function renderFeed() {
  if (!data) return;
  const query = $('search').value.trim().toLowerCase().replace(/^#/, '');
  const events = windowEvents().filter(e => (filter === 'all' || filter === 'watchlist' && eventWallets(e).some(a => saved.has(a)) || e.type === filter) && (!query || [e.tx, e.from, e.to, e.wallet, e.statement, e.base, e.top].filter(v => v !== undefined).some(v => String(v).toLowerCase().includes(query))));
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
  const changes = new Map();
  for (const e of windowEvents().filter(e => e.type === 'movement')) {
    changes.set(e.from, (changes.get(e.from) || 0) - e.amount);
    changes.set(e.to, (changes.get(e.to) || 0) + e.amount);
  }
  const rows = data.holders.slice(0, expanded ? data.holders.length : 15).map((holder, i) => {
    const row = el('tr');
    const saveCell = el('td'); const save = el('button', 'save', saved.has(holder.address) ? '★' : '☆');
    save.type = 'button'; save.setAttribute('aria-label', (saved.has(holder.address) ? 'Remove ' : 'Watch ') + holder.address); save.setAttribute('aria-pressed', String(saved.has(holder.address))); save.addEventListener('click', () => toggleSaved(holder.address)); saveCell.append(save);
    const addressCell = el('td'); addressCell.append(wallet(holder.address));
    if (holder.isContract) { const c = el('span', 'contract', 'Contract'); c.title = holder.name || 'Contract address'; addressCell.append(c); }
    const net = changes.get(holder.address) || 0;
    row.append(saveCell, el('td', '', i + 1), addressCell, el('td', '', number(holder.balance)), el('td', '', number(Math.floor(holder.balance / 80))), el('td', net > 0 ? 'positive' : net < 0 ? 'negative' : '', (net > 0 ? '+' : '') + number(net)));
    return row;
  });
  $('holder-rows').replaceChildren(...rows);
  $('expand-holders').textContent = expanded ? 'Show top 15' : 'Show all ' + data.holders.length;
  $('holder-caption').textContent = data.holders.length + ' indexed candidate addresses checked at block ' + number(data.block) + '. Ranking is within this monitored cohort. Net movement excludes burns and reflects qualifying wallet-to-wallet transfers only. Contracts and custody pools are included.';
}
function render() {
  $('burned').textContent = number(data.totals.creditsBurnedIntoStatements);
  $('composed').textContent = number(data.totals.statementsComposed);
  $('circulating').textContent = number(data.totals.statementsCirculating);
  $('circulating-sub').textContent = number(data.totals.statementHolders) + ' owner addresses · ' + number(data.totals.overprints) + ' overprints';
  document.querySelectorAll('.window-label').forEach(n => n.textContent = '/ ' + $('window').value + 'h');
  $('block-link').hidden = false; $('block-link').href = 'https://etherscan.io/block/' + data.block; $('block-link').textContent = 'Block ' + number(data.block) + ' ↗';
  $('saved-count').textContent = saved.size;
  renderBrief(windowEvents()); renderFeed(); renderHolders(); freshness();
}
function valid(d) {
  const address = a => /^0x[0-9a-f]{40}$/.test(a), integer = n => Number.isSafeInteger(n) && n >= 0;
  const types = ['movement', 'assembly', 'overprint', 'statement-transfer'];
  return d?.version === 1 && integer(d.block) && Number.isFinite(Date.parse(d.blockTimestamp)) && Number.isFinite(Date.parse(d.generatedAt)) && Number.isFinite(Date.parse(d.windowStart)) && Array.isArray(d.activity) && Array.isArray(d.holders) && d.totals && ['creditsBurnedIntoStatements', 'statementsComposed', 'statementsCirculating', 'statementHolders', 'overprints'].every(k => integer(d.totals[k])) && d.totals.creditsBurnedIntoStatements === d.totals.statementsComposed * 80 && d.holders.every(h => address(h.address) && integer(h.balance)) && d.activity.every(e => types.includes(e.type) && /^0x[0-9a-f]{64}$/.test(e.tx) && integer(e.block) && integer(e.timestamp) && integer(e.amount) && eventWallets(e).every(address) && (e.type === 'movement' || e.type === 'statement-transfer' ? address(e.from) && address(e.to) : address(e.wallet)) && (e.type === 'assembly' || e.type === 'statement-transfer' ? integer(e.statement) : e.type === 'overprint' ? integer(e.base) && integer(e.top) : true));
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
      const row = el('tr'), cell = el('td', 'empty', 'Holder data is unavailable.'); cell.colSpan = 6; row.append(cell); $('holder-rows').replaceChildren(row);
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
