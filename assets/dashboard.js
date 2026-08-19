// assets/dashboard.js
'use strict';

const CSV_URL = 'ops_metrics.csv';

const THRESHOLDS = {
  availability_pct: 90,
  serviceability_pct: 90,
  cancellation_pct: 5,
  rating_min: 4.0,
  stale_days: 3,
};

const ALERT_SEVERITY = {
  zero_revenue: 'crit',
  availability: 'crit',
  serviceability: 'crit',
  cancellation: 'crit',
  rating: 'warn',
  stale: 'warn',
};

// ---------- CSV parsing ----------

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { current += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      values.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  values.push(current);
  return values;
}

function parseOpsCsv(text) {
  const lines = text.trim().split('\n').filter(l => l.length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = values[i] !== undefined ? values[i].trim() : ''; });
    return {
      date: row['Date'],
      store: row['Store'],
      platform: row['Platform'],
      availability: row['Availability%'] === '' ? null : parseFloat(row['Availability%']),
      serviceability: row['Serviceability%'] === '' ? null : parseFloat(row['Serviceability%']),
      kpt: row['KPT'] === '' ? null : row['KPT'],
      cancellation: row['Cancellation%'] === '' ? null : parseFloat(row['Cancellation%']),
      rating: row['Rating'] === '' ? null : parseFloat(row['Rating']),
    };
  });
}

function latestOpsByStorePlatform(opsRows) {
  const latest = {};
  for (const row of opsRows) {
    const key = row.store + '|' + row.platform;
    if (!latest[key] || row.date > latest[key].date) latest[key] = row;
  }
  return Object.values(latest);
}

// ---------- formatting helpers ----------

function fmtMoney(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function fmtMoneyCompact(n) {
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'k';
  return '₹' + Math.round(n);
}

function latestCompleteDate(stores) {
  let max = null;
  for (const s of stores) {
    const last = s.revenue.daily.length ? s.revenue.daily[s.revenue.daily.length - 1].date : null;
    if (last && (!max || last > max)) max = last;
  }
  return max;
}

function severityByStore(alerts) {
  const map = {};
  for (const a of alerts) {
    const sev = ALERT_SEVERITY[a.type] || 'warn';
    if (!map[a.store] || (map[a.store] === 'warn' && sev === 'crit')) map[a.store] = sev;
  }
  return map;
}

function metricChipClass(value, kind) {
  if (value === null || value === undefined) return 'na';
  if (kind === 'min90') return value >= 90 ? 'good' : value >= 80 ? 'warn' : 'crit';
  if (kind === 'maxCancel') return value <= THRESHOLDS.cancellation_pct ? 'good' : value <= 8 ? 'warn' : 'crit';
  if (kind === 'rating') return value >= THRESHOLDS.rating_min ? 'good' : value >= 3.5 ? 'warn' : 'crit';
  return 'na';
}

// ---------- sparkline (inline SVG, built via DOM — no innerHTML) ----------

function renderSparkline(container, values) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 24');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '28');
  svg.setAttribute('preserveAspectRatio', 'none');
  if (values.length >= 2) {
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const stepX = 96 / (values.length - 1);
    const pts = values.map((v, i) => {
      const x = 2 + i * stepX;
      const y = 2 + 20 * (1 - (v - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', '#0a6b3f');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linecap', 'round');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);
  }
  container.appendChild(svg);
}

// ---------- render: header + KPIs ----------

function renderHeader(dashboard) {
  document.getElementById('generated-at').textContent = 'Data as of ' + dashboard.generated_at_ist;
}

function computeKpis(stores, opsRows, alerts) {
  let today = 0, wtd = 0, mtd = 0;
  for (const s of stores) {
    const last = s.revenue.daily.length ? s.revenue.daily[s.revenue.daily.length - 1] : null;
    if (last) today += last.total;
    wtd += s.revenue.wtd.total;
    mtd += s.revenue.mtd.total;
  }
  const ratings = opsRows.map(r => r.rating).filter(r => r !== null);
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  return { today, wtd, mtd, alertCount: alerts.length, avgRating };
}

function kpiCard({ label, value, sub, alert }) {
  const div = document.createElement('div');
  div.className = 'kpi' + (alert ? ' alertcount' : '');
  const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
  const v = document.createElement('div'); v.className = 'value'; v.textContent = value;
  div.appendChild(l);
  div.appendChild(v);
  if (sub) {
    const s = document.createElement('div'); s.className = 'sub'; s.textContent = sub;
    div.appendChild(s);
  }
  return div;
}

function renderKpis(kpis) {
  const el = document.getElementById('kpis');
  el.innerHTML = '';
  el.appendChild(kpiCard({ label: "Today's revenue", value: fmtMoneyCompact(kpis.today), sub: '13 Pune stores · online + dine-in' }));
  el.appendChild(kpiCard({ label: 'Week to date', value: fmtMoneyCompact(kpis.wtd) }));
  el.appendChild(kpiCard({ label: 'Month to date', value: fmtMoneyCompact(kpis.mtd) }));
  el.appendChild(kpiCard({
    label: 'Open issues',
    value: String(kpis.alertCount),
    sub: kpis.avgRating ? `avg rating ${kpis.avgRating.toFixed(1)}★` : null,
    alert: kpis.alertCount > 0,
  }));
}

// ---------- render: alerts ----------

function renderAlerts(alerts) {
  const el = document.getElementById('alerts-list');
  el.innerHTML = '';
  if (alerts.length === 0) {
    const li = document.createElement('li');
    li.className = 'alert-card ok';
    li.textContent = '✓ Nothing flagged — all 13 stores within thresholds.';
    el.appendChild(li);
    return;
  }
  for (const a of alerts) {
    const li = document.createElement('li');
    const sev = ALERT_SEVERITY[a.type] || 'warn';
    li.className = 'alert-card' + (sev === 'warn' ? ' sev-warn' : '');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = a.store + ':';
    li.appendChild(badge);
    li.appendChild(document.createTextNode(' ' + a.detail));
    el.appendChild(li);
  }
}

// ---------- render: store cards ----------

function renderStoreCards(stores, severityMap) {
  const el = document.getElementById('store-grid');
  el.innerHTML = '';
  if (stores.length === 0) {
    el.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No stores in this filter.';
    el.appendChild(note);
    return;
  }
  for (const s of stores) {
    const last = s.revenue.daily.length ? s.revenue.daily[s.revenue.daily.length - 1] : null;
    const isPrelaunch = !s.launch_date;
    const card = document.createElement('div');
    card.className = 'store-card' + (isPrelaunch ? ' prelaunch' : '');

    const dot = document.createElement('div');
    const sev = severityMap[s.display_name];
    dot.className = 'status-dot' + (sev === 'crit' ? ' crit' : sev === 'warn' ? ' warn' : '');
    card.appendChild(dot);

    const name = document.createElement('div'); name.className = 'name'; name.textContent = s.display_name;
    card.appendChild(name);

    const cat = document.createElement('span'); cat.className = 'cat'; cat.textContent = s.category;
    card.appendChild(cat);

    const revLabel = document.createElement('div'); revLabel.className = 'revenue-label'; revLabel.textContent = 'Latest day';
    card.appendChild(revLabel);
    const rev = document.createElement('div'); rev.className = 'revenue';
    rev.textContent = last ? fmtMoney(last.total) : (isPrelaunch ? 'Pre-launch' : '—');
    card.appendChild(rev);

    const sparkWrap = document.createElement('div');
    const recent = s.revenue.daily.slice(-14).map(d => d.total);
    if (recent.length >= 2) renderSparkline(sparkWrap, recent);
    card.appendChild(sparkWrap);

    const meta = document.createElement('div'); meta.className = 'meta-row';
    const wtdSpan = document.createElement('span'); wtdSpan.textContent = `WTD ${fmtMoneyCompact(s.revenue.wtd.total)}`;
    const mtdSpan = document.createElement('span'); mtdSpan.textContent = `MTD ${fmtMoneyCompact(s.revenue.mtd.total)}`;
    meta.appendChild(wtdSpan);
    meta.appendChild(mtdSpan);
    card.appendChild(meta);

    if (s.launch_date) {
      const launch = document.createElement('div'); launch.className = 'meta-row';
      launch.style.borderTop = 'none'; launch.style.paddingTop = '0';
      launch.textContent = `Live since ${s.launch_date}`;
      card.appendChild(launch);
    }

    el.appendChild(card);
  }
}

// ---------- render: ops cards ----------

function metricChip(label, value, kind, suffix) {
  const span = document.createElement('span');
  span.className = 'metric-chip ' + metricChipClass(value, kind);
  span.textContent = value === null || value === undefined ? `${label} —` : `${label} ${value}${suffix || ''}`;
  return span;
}

function renderOpsCards(latestOps) {
  const el = document.getElementById('ops-grid');
  el.innerHTML = '';
  if (latestOps.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No ops data entered yet — add rows to ops_metrics.csv.';
    el.appendChild(note);
    return;
  }
  const byStore = {};
  for (const row of latestOps) {
    (byStore[row.store] = byStore[row.store] || []).push(row);
  }
  for (const [store, rows] of Object.entries(byStore)) {
    const card = document.createElement('div');
    card.className = 'ops-card';
    const name = document.createElement('div'); name.className = 'store-name'; name.textContent = store;
    card.appendChild(name);
    for (const row of rows) {
      const line = document.createElement('div'); line.className = 'ops-row';
      const platform = document.createElement('span'); platform.className = 'platform'; platform.textContent = row.platform;
      line.appendChild(platform);
      const chips = document.createElement('span'); chips.className = 'metrics-inline';
      chips.appendChild(metricChip('Avail', row.availability, 'min90', '%'));
      chips.appendChild(metricChip('Serv', row.serviceability, 'min90', '%'));
      chips.appendChild(metricChip('Cxl', row.cancellation, 'maxCancel', '%'));
      chips.appendChild(metricChip('★', row.rating, 'rating', ''));
      line.appendChild(chips);
      card.appendChild(line);
    }
    el.appendChild(card);
  }
}

// ---------- boot ----------

async function loadData() {
  const [dashboard, csvText] = await Promise.all([
    fetch('data.json').then(r => r.json()),
    fetch(CSV_URL).then(r => r.text()).catch(() => ''),
  ]);
  const opsRows = csvText ? parseOpsCsv(csvText) : [];
  return { dashboard, opsRows };
}

function renderAll({ dashboard, opsRows }) {
  const today = latestCompleteDate(dashboard.stores) || dashboard.generated_at_ist.slice(0, 10);
  const latestOps = latestOpsByStorePlatform(opsRows);
  const alerts = window.Alerts.computeAlerts(dashboard.stores, latestOps, THRESHOLDS, today);
  const severityMap = severityByStore(alerts);

  renderHeader(dashboard);
  renderKpis(computeKpis(dashboard.stores, opsRows, alerts));
  renderAlerts(alerts);
  renderStoreCards(dashboard.stores, severityMap);
  renderOpsCards(latestOps);

  document.querySelectorAll('.category-filter button').forEach(btn => {
    btn.addEventListener('click', () => {
      renderStoreCards(window.Alerts.filterByCategory(dashboard.stores, btn.dataset.category), severityMap);
      document.querySelectorAll('.category-filter button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

loadData().then(renderAll).catch(err => {
  const el = document.getElementById('alerts-list');
  el.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'alert-card';
  li.textContent = `Failed to load dashboard data: ${err.message}`;
  el.appendChild(li);
});
