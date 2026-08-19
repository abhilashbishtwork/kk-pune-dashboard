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

function fmtMoney(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function latestCompleteDate(stores) {
  let max = null;
  for (const s of stores) {
    const last = s.revenue.daily.length ? s.revenue.daily[s.revenue.daily.length - 1].date : null;
    if (last && (!max || last > max)) max = last;
  }
  return max;
}

function renderHeader(dashboard) {
  document.getElementById('generated-at').textContent = 'Data as of ' + dashboard.generated_at_ist;
}

function renderAlerts(alerts) {
  const el = document.getElementById('alerts-list');
  el.innerHTML = '';
  if (alerts.length === 0) {
    el.innerHTML = '<li class="ok">No issues flagged.</li>';
    return;
  }
  for (const a of alerts) {
    const li = document.createElement('li');
    li.className = 'alert-' + a.type;
    li.textContent = `${a.store}: ${a.detail}`;
    el.appendChild(li);
  }
}

function addRow(tbody, values) {
  const tr = document.createElement('tr');
  for (const v of values) {
    const td = document.createElement('td');
    td.textContent = v;
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
}

function renderRevenue(stores) {
  const tbody = document.getElementById('revenue-body');
  tbody.innerHTML = '';
  for (const s of stores) {
    const last = s.revenue.daily.length ? s.revenue.daily[s.revenue.daily.length - 1] : null;
    addRow(tbody, [
      s.display_name,
      s.category,
      last ? fmtMoney(last.total) : '—',
      fmtMoney(s.revenue.wtd.total),
      fmtMoney(s.revenue.mtd.total),
      s.launch_date || '—',
    ]);
  }
}

function renderOpsGrid(latestOps) {
  const tbody = document.getElementById('ops-body');
  tbody.innerHTML = '';
  for (const row of latestOps) {
    addRow(tbody, [
      row.store,
      row.platform,
      row.availability ?? '—',
      row.serviceability ?? '—',
      row.kpt ?? '—',
      row.cancellation ?? '—',
      row.rating ?? '—',
      row.date,
    ]);
  }
}

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

  renderHeader(dashboard);
  renderAlerts(alerts);
  renderRevenue(dashboard.stores);
  renderOpsGrid(latestOps);

  document.querySelectorAll('.category-filter button').forEach(btn => {
    btn.addEventListener('click', () => {
      renderRevenue(window.Alerts.filterByCategory(dashboard.stores, btn.dataset.category));
      document.querySelectorAll('.category-filter button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

loadData().then(renderAll).catch(err => {
  const el = document.getElementById('alerts-list');
  el.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'alert-error';
  li.textContent = `Failed to load dashboard data: ${err.message}`;
  el.appendChild(li);
});
