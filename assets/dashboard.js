// assets/dashboard.js
'use strict';

const OPS_CSV_URL = 'ops_metrics.csv';
const HOURS_CSV_URL = 'store_hours.csv';

const THRESHOLDS = {
  availability_pct: 90,
  serviceability_pct: 90,
  cancellation_pct: 1,
  rating_min: 4.0,
  stale_days: 3,
};

// "Good" bars for the detail/health tables, per explicit business call:
const GOOD = {
  revPerDay: 20000,   // >= ₹20k/day
  ordersPerDay: 100,  // >= 100 orders/day
  rating: 4.5,         // >= 4.5★ across Swiggy/Zomato/Google
  cancellationPct: 1, // < 1% is good, above is "high"
  kptP80Minutes: 10,   // P80 KPT under 10 min is good
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

function parseCsvRows(text) {
  const lines = text.trim().split('\n').filter(l => l.length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = values[i] !== undefined ? values[i].trim() : ''; });
    return row;
  });
}

function parseOpsCsv(text) {
  return parseCsvRows(text).map(row => ({
    date: row['Date'],
    store: row['Store'],
    platform: row['Platform'],
    availability: row['Availability%'] === '' ? null : parseFloat(row['Availability%']),
    serviceability: row['Serviceability%'] === '' ? null : parseFloat(row['Serviceability%']),
    kpt: row['KPT'] === '' ? null : row['KPT'],
    cancellation: row['Cancellation%'] === '' ? null : parseFloat(row['Cancellation%']),
    rating: row['Rating'] === '' ? null : parseFloat(row['Rating']),
    reviewCount: row['Review Count'] === '' ? null : parseInt(row['Review Count'], 10),
  }));
}

function parseStoreHoursCsv(text) {
  const map = {};
  for (const row of parseCsvRows(text)) {
    map[row['Store']] = { opens: row['Opens'] || '', closes: row['Closes'] || '' };
  }
  return map;
}

function latestOpsByStorePlatform(opsRows) {
  const latest = {};
  for (const row of opsRows) {
    const key = row.store + '|' + row.platform;
    if (!latest[key] || row.date > latest[key].date) latest[key] = row;
  }
  return Object.values(latest);
}

// ---------- date helpers ----------

function shiftDateStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function allDatesAcross(stores) {
  const set = new Set();
  for (const s of stores) for (const d of s.revenue.daily) set.add(d.date);
  return Array.from(set).sort();
}

function parseClockTime(text) {
  // "11:00 AM" / "1:00 PM" -> minutes since midnight, or null if blank/unparseable.
  if (!text) return null;
  const m = text.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') hour += 12;
  return hour * 60 + parseInt(m[2], 10);
}

function nowMinutesIst() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return hour * 60 + minute;
}

function isStoreOpenNow(hours) {
  if (!hours) return null;
  const opens = parseClockTime(hours.opens);
  const closes = parseClockTime(hours.closes);
  if (opens === null || closes === null) return null;
  const now = nowMinutesIst();
  return now >= opens && now < closes;
}

function latestCompleteDate(stores) {
  const dates = allDatesAcross(stores);
  return dates.length ? dates[dates.length - 1] : null;
}

// ---------- formatting ----------

function fmtMoney(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function fmtMoneyCompact(n) {
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 100000) return sign + '₹' + (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return sign + '₹' + (n / 1000).toFixed(1) + 'k';
  return sign + '₹' + Math.round(n);
}

function fmtPct(n, decimals) {
  return n.toFixed(decimals === undefined ? 1 : decimals) + '%';
}

function wowLabel(curr, prior) {
  if (!prior || prior <= 0) return curr > 0 ? 'new vs last week' : null;
  const pct = ((curr - prior) / prior) * 100;
  const arrow = pct >= 0 ? '▲' : '▼';
  return { text: `${arrow} ${Math.abs(pct).toFixed(0)}% vs last week`, dir: pct >= 0 ? 'up' : 'down' };
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
  if (kind === 'maxCancel') return value <= GOOD.cancellationPct ? 'good' : value <= 3 ? 'warn' : 'crit';
  if (kind === 'rating') return value >= THRESHOLDS.rating_min ? 'good' : value >= 3.5 ? 'warn' : 'crit';
  if (kind === 'ratingGood') return value >= GOOD.rating ? 'good' : value >= THRESHOLDS.rating_min ? 'warn' : 'crit';
  if (kind === 'minRevPerDay') return value >= GOOD.revPerDay ? 'good' : 'na';
  if (kind === 'minOrdersPerDay') return value >= GOOD.ordersPerDay ? 'good' : 'na';
  if (kind === 'maxKpt') return value <= GOOD.kptP80Minutes ? 'good' : value <= 15 ? 'warn' : 'crit';
  return 'na';
}

function metricChip(label, value, kind, suffix) {
  const span = document.createElement('span');
  span.className = 'metric-chip ' + metricChipClass(value, kind);
  span.textContent = value === null || value === undefined ? `${label} —` : `${label} ${value}${suffix || ''}`;
  return span;
}

// Like metricChip, but classifies on a raw value that differs in scale from
// the displayed text (e.g. Rev/day is shown in thousands but the "good"
// threshold is a raw rupee figure) — classifying on the display string
// itself would silently compare the wrong scale.
function scaledChip(displayText, rawValue, kind) {
  const span = document.createElement('span');
  span.className = 'metric-chip ' + metricChipClass(rawValue, kind);
  span.textContent = displayText;
  return span;
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

// ---------- header ----------

function renderHeader(dashboard) {
  document.getElementById('generated-at').textContent = 'Data as of ' + dashboard.generated_at_ist;
}

// ---------- store picker (per-manager focused view — the "go deep" link) ----------

function getSelectedStore(stores) {
  const raw = new URLSearchParams(location.search).get('store');
  if (!raw) return null;
  const decoded = decodeURIComponent(raw).trim().toLowerCase();
  return stores.find(s => s.display_name.toLowerCase() === decoded) || null;
}

function renderStorePicker(stores, selected) {
  const el = document.getElementById('store-picker-row');
  el.innerHTML = '';

  const label = document.createElement('label');
  label.textContent = selected ? 'Viewing:' : 'Store managers: find your store here →';
  label.setAttribute('for', 'store-picker');
  el.appendChild(label);

  const select = document.createElement('select');
  select.id = 'store-picker';
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All 13 stores';
  select.appendChild(allOpt);
  for (const s of stores) {
    const opt = document.createElement('option');
    opt.value = s.display_name;
    opt.textContent = s.display_name;
    if (selected && selected.display_name === s.display_name) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    location.href = select.value ? '?store=' + encodeURIComponent(select.value) : location.pathname;
  });
  el.appendChild(select);

  if (selected) {
    const back = document.createElement('a');
    back.className = 'back-link';
    back.href = location.pathname;
    back.textContent = '← All stores';
    el.appendChild(back);
    document.getElementById('page-title').textContent = selected.display_name;
  }
}

// ---------- KPIs (fixed: yesterday + MTD — not affected by the date-range filter below) ----------

function sumAtDate(stores, dateStr) {
  let online = 0, dine_in = 0;
  for (const s of stores) {
    const entry = s.revenue.daily.find(d => d.date === dateStr);
    if (entry) { online += Object.values(entry.online).reduce((a, b) => a + b, 0); dine_in += entry.dine_in; }
  }
  return { online, dine_in, total: online + dine_in };
}

function sumMtd(stores) {
  let online = 0, dine_in = 0, onlineOrders = 0, dineInOrders = 0;
  for (const s of stores) {
    online += s.revenue.mtd.online;
    dine_in += s.revenue.mtd.dine_in;
    onlineOrders += s.revenue.mtd.online_orders;
    dineInOrders += s.revenue.mtd.dine_in_orders;
  }
  return { online, dine_in, onlineOrders, dineInOrders };
}

function latestGoogleReviewTotal(opsRows) {
  const googleRows = opsRows.filter(r => r.platform === 'Google' && r.reviewCount !== null);
  if (googleRows.length === 0) return null;
  const latestDate = googleRows.reduce((max, r) => (r.date > max ? r.date : max), googleRows[0].date);
  return googleRows.filter(r => r.date === latestDate).reduce((sum, r) => sum + r.reviewCount, 0);
}

function computeFixedKpis(stores, opsRows, alerts) {
  const yesterday = latestCompleteDate(stores);
  const priorWeek = yesterday ? shiftDateStr(yesterday, -7) : null;
  const yToday = yesterday ? sumAtDate(stores, yesterday) : { online: 0, dine_in: 0, total: 0 };
  const yPrior = priorWeek ? sumAtDate(stores, priorWeek) : { online: 0, dine_in: 0, total: 0 };
  const mtd = sumMtd(stores);
  const aovOnline = mtd.onlineOrders > 0 ? mtd.online / mtd.onlineOrders : null;
  const aovOffline = mtd.dineInOrders > 0 ? mtd.dine_in / mtd.dineInOrders : null;
  const googleReviews = latestGoogleReviewTotal(opsRows);

  return {
    yesterday, yToday, yPrior,
    mtdOnline: mtd.online, mtdOffline: mtd.dine_in,
    aovOnline, aovOffline,
    alertCount: alerts.length,
    googleReviews,
  };
}

function kpiCard() {
  const div = document.createElement('div');
  div.className = 'kpi';
  return div;
}

function addKpiText(div, className, text) {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  div.appendChild(el);
  return el;
}

function renderKpis(k) {
  const el = document.getElementById('kpis');
  el.innerHTML = '';

  // 1. Yesterday's revenue
  const c1 = kpiCard();
  addKpiText(c1, 'label', "Yesterday's revenue");
  addKpiText(c1, 'value', fmtMoneyCompact(k.yToday.total));
  const wow1 = wowLabel(k.yToday.total, k.yPrior.total);
  if (wow1) addKpiText(c1, 'sub' + (wow1.dir ? ' ' + wow1.dir : ''), wow1.text || wow1);
  el.appendChild(c1);

  // 2. Online revenue (yesterday)
  const c2 = kpiCard();
  addKpiText(c2, 'label', 'Online revenue');
  addKpiText(c2, 'value', fmtMoneyCompact(k.yToday.online));
  const wow2 = wowLabel(k.yToday.online, k.yPrior.online);
  if (wow2) addKpiText(c2, 'sub' + (wow2.dir ? ' ' + wow2.dir : ''), wow2.text || wow2);
  el.appendChild(c2);

  // 3. Offline (dine-in) revenue (yesterday)
  const c3 = kpiCard();
  addKpiText(c3, 'label', 'Offline revenue');
  addKpiText(c3, 'value', fmtMoneyCompact(k.yToday.dine_in));
  const wow3 = wowLabel(k.yToday.dine_in, k.yPrior.dine_in);
  if (wow3) addKpiText(c3, 'sub' + (wow3.dir ? ' ' + wow3.dir : ''), wow3.text || wow3);
  el.appendChild(c3);

  // 4. MTD online/offline split
  const c4 = kpiCard();
  addKpiText(c4, 'label', 'Month to date');
  const split4 = document.createElement('div'); split4.className = 'split-row';
  split4.innerHTML = '';
  const p1 = document.createElement('div'); p1.className = 'part';
  const p1t = document.createElement('div'); p1t.className = 'tag'; p1t.textContent = 'Online';
  const p1v = document.createElement('div'); p1v.className = 'val'; p1v.textContent = fmtMoneyCompact(k.mtdOnline);
  p1.appendChild(p1t); p1.appendChild(p1v);
  const p2 = document.createElement('div'); p2.className = 'part';
  const p2t = document.createElement('div'); p2t.className = 'tag'; p2t.textContent = 'Offline';
  const p2v = document.createElement('div'); p2v.className = 'val'; p2v.textContent = fmtMoneyCompact(k.mtdOffline);
  p2.appendChild(p2t); p2.appendChild(p2v);
  split4.appendChild(p1); split4.appendChild(p2);
  c4.appendChild(split4);
  el.appendChild(c4);

  // 5. AOV online/offline split
  const c5 = kpiCard();
  addKpiText(c5, 'label', 'AOV (MTD)');
  const split5 = document.createElement('div'); split5.className = 'split-row';
  const q1 = document.createElement('div'); q1.className = 'part';
  const q1t = document.createElement('div'); q1t.className = 'tag'; q1t.textContent = 'Online';
  const q1v = document.createElement('div'); q1v.className = 'val'; q1v.textContent = k.aovOnline !== null ? fmtMoney(k.aovOnline) : '—';
  q1.appendChild(q1t); q1.appendChild(q1v);
  const q2 = document.createElement('div'); q2.className = 'part';
  const q2t = document.createElement('div'); q2t.className = 'tag'; q2t.textContent = 'Offline';
  const q2v = document.createElement('div'); q2v.className = 'val'; q2v.textContent = k.aovOffline !== null ? fmtMoney(k.aovOffline) : '—';
  q2.appendChild(q2t); q2.appendChild(q2v);
  split5.appendChild(q1); split5.appendChild(q2);
  c5.appendChild(split5);
  el.appendChild(c5);

  // 6. Open issues
  const c6 = kpiCard();
  if (k.alertCount > 0) c6.classList.add('alertcount');
  addKpiText(c6, 'label', 'Open issues');
  addKpiText(c6, 'value', String(k.alertCount));
  el.appendChild(c6);

  // 7. Google reviews (called out separately per request — total as of latest entry)
  const c7 = kpiCard();
  addKpiText(c7, 'label', 'Google reviews');
  addKpiText(c7, 'value', k.googleReviews !== null ? String(k.googleReviews) : '—');
  addKpiText(c7, 'sub', k.googleReviews !== null ? 'latest total, all stores' : 'no Google rows in ops_metrics.csv yet');
  el.appendChild(c7);
}

// ---------- alerts ----------

function renderAlerts(alerts) {
  const el = document.getElementById('alerts-list');
  el.innerHTML = '';
  if (alerts.length === 0) {
    const li = document.createElement('li');
    li.className = 'alert-card ok';
    li.textContent = '✓ Nothing flagged in this view.';
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

// ---------- store cards ----------

function dailyInRange(daily, start, end) {
  return daily.filter(d => d.date >= start && d.date <= end);
}

function channelValue(day, channel) {
  if (channel === 'online') return Object.values(day.online).reduce((a, b) => a + b, 0);
  if (channel === 'offline') return day.dine_in;
  return day.total;
}

const CHANNEL_LABELS = { total: 'Total', online: 'Online', offline: 'Offline' };

function renderCardChannelToggle(current, onChange) {
  const el = document.getElementById('card-channel-toggle');
  el.innerHTML = '';
  const label = document.createElement('span'); label.className = 'toggle-label'; label.textContent = 'Graphs show:';
  el.appendChild(label);
  for (const key of ['total', 'online', 'offline']) {
    const btn = document.createElement('button');
    btn.textContent = CHANNEL_LABELS[key];
    if (key === current) btn.classList.add('active');
    btn.addEventListener('click', () => onChange(key));
    el.appendChild(btn);
  }
}

function renderStoreCards(stores, severityMap, storeHours, range, channel) {
  const el = document.getElementById('store-grid');
  el.innerHTML = '';
  if (stores.length === 0) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No stores in this filter.';
    el.appendChild(note);
    return;
  }
  for (const s of stores) {
    // Full history since launch by default (the daily array only ever
    // starts at launch), narrowed to whatever range the date filter above
    // — the same one driving the two tables — currently has selected.
    const daysInRange = range ? dailyInRange(s.revenue.daily, range.start, range.end) : s.revenue.daily;
    const last = daysInRange.length ? daysInRange[daysInRange.length - 1] : null;
    const isPrelaunch = !s.launch_date;
    const hours = (storeHours || {})[s.display_name];
    const openNow = isStoreOpenNow(hours);
    const card = document.createElement('div');
    card.className = 'store-card' + (isPrelaunch ? ' prelaunch' : '') + (openNow === false ? ' closed-now' : '');

    const dot = document.createElement('div');
    const sev = severityMap[s.display_name];
    dot.className = 'status-dot' + (sev === 'crit' ? ' crit' : sev === 'warn' ? ' warn' : '');
    card.appendChild(dot);

    const name = document.createElement('div'); name.className = 'name'; name.textContent = s.display_name;
    card.appendChild(name);

    const cat = document.createElement('span'); cat.className = 'cat'; cat.textContent = s.category;
    card.appendChild(cat);

    if (openNow === false) {
      const closedBadge = document.createElement('span'); closedBadge.className = 'closed-badge';
      closedBadge.textContent = `Closed now (opens ${hours.opens})`;
      card.appendChild(closedBadge);
    }

    const revLabel = document.createElement('div'); revLabel.className = 'revenue-label';
    revLabel.textContent = `Latest day (${CHANNEL_LABELS[channel || 'total']})`;
    card.appendChild(revLabel);
    const rev = document.createElement('div'); rev.className = 'revenue';
    rev.textContent = last ? fmtMoney(channelValue(last, channel || 'total')) : (isPrelaunch ? 'Pre-launch' : '—');
    card.appendChild(rev);

    const sparkWrap = document.createElement('div');
    const values = daysInRange.map(d => channelValue(d, channel || 'total'));
    if (values.length >= 2) renderSparkline(sparkWrap, values);
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

// ---------- date range row (drives the two detail tables below) ----------

function getDefaultRange(availableDates) {
  if (availableDates.length === 0) return { start: null, end: null };
  const end = availableDates[availableDates.length - 1];
  const startIdx = Math.max(0, availableDates.length - 7);
  return { start: availableDates[startIdx], end };
}

function getRangeFromUrl(availableDates) {
  const params = new URLSearchParams(location.search);
  const start = params.get('start');
  const end = params.get('end');
  if (start && end) return { start, end };
  return getDefaultRange(availableDates);
}

function renderDateRangeRow(availableDates, range, onChange) {
  const el = document.getElementById('date-range-row');
  el.innerHTML = '';
  if (availableDates.length === 0) return;
  const min = availableDates[0];
  const max = availableDates[availableDates.length - 1];

  const startLabel = document.createElement('label');
  startLabel.textContent = 'From';
  const startInput = document.createElement('input');
  startInput.type = 'date'; startInput.min = min; startInput.max = max; startInput.value = range.start;
  startLabel.appendChild(startInput);

  const endLabel = document.createElement('label');
  endLabel.textContent = 'To';
  const endInput = document.createElement('input');
  endInput.type = 'date'; endInput.min = min; endInput.max = max; endInput.value = range.end;
  endLabel.appendChild(endInput);

  const apply = () => {
    if (startInput.value && endInput.value && startInput.value <= endInput.value) {
      const params = new URLSearchParams(location.search);
      params.set('start', startInput.value);
      params.set('end', endInput.value);
      history.replaceState(null, '', '?' + params.toString());
      onChange({ start: startInput.value, end: endInput.value });
    }
  };
  startInput.addEventListener('change', apply);
  endInput.addEventListener('change', apply);

  const presets = document.createElement('div');
  presets.className = 'presets';
  const presetDefs = [
    { label: 'Yesterday', yesterday: true },
    { label: '7 Days', days: 7 },
    { label: '30 Days', days: 30 },
    { label: 'MTD', mtd: true },
    { label: 'Since Launch', all: true },
  ];
  for (const p of presetDefs) {
    const btn = document.createElement('button');
    btn.textContent = p.label;
    btn.addEventListener('click', () => {
      let start;
      if (p.yesterday) start = max;
      else if (p.all) start = min;
      else if (p.mtd) start = max.slice(0, 8) + '01';
      else start = availableDates[Math.max(0, availableDates.length - p.days)];
      startInput.value = start < min ? min : start;
      endInput.value = max;
      apply();
    });
    presets.appendChild(btn);
  }

  el.appendChild(startLabel);
  el.appendChild(endLabel);
  el.appendChild(presets);
  const note = document.createElement('span');
  note.className = 'range-note';
  note.textContent = 'drives the two tables below';
  el.appendChild(note);
}

// ---------- generic sortable table ----------

function renderSortableTable(tableId, columns, rows, sortState) {
  const table = document.getElementById(tableId);
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = ''; tbody.innerHTML = '';

  const headRow = document.createElement('tr');
  columns.forEach((col, i) => {
    const el = document.createElement('th');
    el.style.cursor = 'pointer';
    el.textContent = col.label + (sortState.col === i ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '');
    el.addEventListener('click', () => {
      if (sortState.col === i) sortState.dir *= -1;
      else { sortState.col = i; sortState.dir = 1; }
      renderSortableTable(tableId, columns, rows, sortState);
    });
    headRow.appendChild(el);
  });
  thead.appendChild(headRow);

  let sortedRows = rows;
  if (sortState.col !== null) {
    const col = columns[sortState.col];
    sortedRows = [...rows].sort((a, b) => {
      const av = col.value(a), bv = col.value(b);
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1; // nulls always sort last, regardless of direction
      if (bNull) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * sortState.dir;
      return (av - bv) * sortState.dir;
    });
  }

  for (const row of sortedRows) {
    const tr = document.createElement('tr');
    for (const col of columns) {
      const cell = document.createElement('td');
      if (col.numeric) cell.classList.add('num');
      if (col.storeCell) cell.classList.add('store-cell');
      if (col.render) col.render(cell, row);
      else cell.textContent = col.display(row);
      tr.appendChild(cell);
    }
    tbody.appendChild(tr);
  }
}

// ---------- Table 1: revenue / orders / ratings detail (per-day averages over the selected range) ----------

function sumDailyInRange(daily, start, end) {
  let onlineRev = 0, dineInRev = 0, onlineOrders = 0, dineInOrders = 0, days = 0;
  for (const d of daily) {
    if (d.date >= start && d.date <= end) {
      onlineRev += Object.values(d.online).reduce((a, b) => a + b, 0);
      dineInRev += d.dine_in;
      onlineOrders += d.online_orders;
      dineInOrders += d.dine_in_orders;
      days++;
    }
  }
  return { onlineRev, dineInRev, onlineOrders, dineInOrders, days };
}

function latestRating(opsRows, storeName, platform) {
  const rows = opsRows.filter(r => r.store === storeName && r.platform === platform && r.rating !== null);
  if (rows.length === 0) return null;
  const latest = rows.reduce((a, b) => (b.date > a.date ? b : a));
  return { rating: latest.rating, reviewCount: latest.reviewCount };
}

function fmtThousands(n) {
  return (n / 1000).toFixed(1);
}

function buildDetailRow(s, opsRows, range) {
  const sums = sumDailyInRange(s.revenue.daily, range.start, range.end);
  const hasOffline = s.category === 'Offline';
  const days = sums.days;
  const totalRev = sums.onlineRev + sums.dineInRev;
  const totalOrders = sums.onlineOrders + sums.dineInOrders;
  const swiggy = latestRating(opsRows, s.display_name, 'Swiggy');
  const zomato = latestRating(opsRows, s.display_name, 'Zomato');
  const google = latestRating(opsRows, s.display_name, 'Google');
  return {
    type: s.category,
    store: s.display_name,
    prelaunch: !s.launch_date,
    hasOffline,
    revPerDay: days > 0 ? totalRev / days : null,
    opd: days > 0 ? totalOrders / days : null,
    onRpd: days > 0 ? sums.onlineRev / days : null,
    ofRpd: days > 0 && hasOffline ? sums.dineInRev / days : null,
    onOpd: days > 0 ? sums.onlineOrders / days : null,
    ofOpd: days > 0 && hasOffline ? sums.dineInOrders / days : null,
    swiggyRating: swiggy ? swiggy.rating : null,
    swiggyReviews: swiggy ? swiggy.reviewCount : null,
    zomatoRating: zomato ? zomato.rating : null,
    zomatoReviews: zomato ? zomato.reviewCount : null,
    googleRating: google ? google.rating : null,
    googleReviews: google ? google.reviewCount : null,
  };
}

function ratingChipCell(cell, rating, reviewCount) {
  if (rating === null) { cell.textContent = '—'; return; }
  const text = rating.toFixed(1) + '★' + (reviewCount !== null ? ` (${reviewCount})` : '');
  cell.appendChild(scaledChip(text, rating, 'ratingGood'));
}

const DETAIL_COLUMNS = [
  { label: 'Type', value: r => r.type, display: r => r.type },
  { label: 'Store', value: r => r.store, display: r => r.store, storeCell: true },
  {
    label: 'OPD', value: r => r.opd, numeric: true,
    render: (cell, r) => {
      if (r.opd === null) { cell.textContent = '—'; return; }
      cell.appendChild(scaledChip(r.opd.toFixed(1), r.opd, 'minOrdersPerDay'));
    },
  },
  { label: 'On-OPD', value: r => r.onOpd, numeric: true, display: r => r.onOpd === null ? '—' : r.onOpd.toFixed(1) },
  { label: 'Of-OPD', value: r => r.hasOffline ? r.ofOpd : null, numeric: true, display: r => !r.hasOffline ? '-' : (r.ofOpd === null ? '—' : r.ofOpd.toFixed(1)) },
  {
    label: 'Rev/day (k)', value: r => r.revPerDay, numeric: true,
    render: (cell, r) => {
      if (r.revPerDay === null) { cell.textContent = r.prelaunch ? 'Pre-launch' : '—'; return; }
      cell.appendChild(scaledChip(fmtThousands(r.revPerDay), r.revPerDay, 'minRevPerDay'));
    },
  },
  { label: 'On-Rev/day (k)', value: r => r.onRpd, numeric: true, display: r => r.onRpd === null ? '—' : fmtThousands(r.onRpd) },
  { label: 'Of-Rev/day (k)', value: r => r.hasOffline ? r.ofRpd : null, numeric: true, display: r => !r.hasOffline ? '-' : (r.ofRpd === null ? '—' : fmtThousands(r.ofRpd)) },
  { label: 'Swiggy', value: r => r.swiggyRating, numeric: true, render: (cell, r) => ratingChipCell(cell, r.swiggyRating, r.swiggyReviews) },
  { label: 'Zomato', value: r => r.zomatoRating, numeric: true, render: (cell, r) => ratingChipCell(cell, r.zomatoRating, r.zomatoReviews) },
  { label: 'Google', value: r => r.googleRating, numeric: true, render: (cell, r) => ratingChipCell(cell, r.googleRating, r.googleReviews) },
];

const detailSortState = { col: null, dir: 1 };

function renderDetailTable(stores, opsRows, range) {
  const rows = stores.map(s => buildDetailRow(s, opsRows, range));
  renderSortableTable('detail-table', DETAIL_COLUMNS, rows, detailSortState);
}

// ---------- Table 2: cancellation / KPT / availability / serviceability ----------

function opsComputedInRange(opsComputedDaily, start, end) {
  let orders = 0, cancelled = 0, kptWeightedSum = 0, kptWeight = 0;
  for (const d of opsComputedDaily) {
    if (d.date >= start && d.date <= end) {
      orders += d.order_count;
      cancelled += d.cancelled_orders;
      if (d.kpt_p80_minutes !== null) { kptWeightedSum += d.kpt_p80_minutes * d.order_count; kptWeight += d.order_count; }
    }
  }
  return {
    cancellationPct: orders > 0 ? (cancelled / orders) * 100 : null,
    // Order-count-weighted mean of daily P80s — an approximation of a true
    // range-level P80 (percentiles don't combine by averaging), but the
    // cheapest honest proxy available without shipping per-order data.
    kptP80Minutes: kptWeight > 0 ? kptWeightedSum / kptWeight : null,
  };
}

function manualAvgInRange(opsRows, storeName, field, start, end) {
  const values = opsRows.filter(r => r.store === storeName && r.date >= start && r.date <= end && r[field] !== null).map(r => r[field]);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function buildHealthRow(s, opsRows, range) {
  const computed = opsComputedInRange(s.ops_computed.daily, range.start, range.end);
  return {
    type: s.category,
    store: s.display_name,
    cancellationPct: computed.cancellationPct,
    kptP80Minutes: computed.kptP80Minutes,
    availability: manualAvgInRange(opsRows, s.display_name, 'availability', range.start, range.end),
    serviceability: manualAvgInRange(opsRows, s.display_name, 'serviceability', range.start, range.end),
  };
}

const HEALTH_COLUMNS = [
  { label: 'Type', value: r => r.type, display: r => r.type },
  { label: 'Store', value: r => r.store, display: r => r.store, storeCell: true },
  {
    label: 'Cancellation %', value: r => r.cancellationPct, numeric: true,
    render: (cell, r) => cell.appendChild(metricChip('', r.cancellationPct !== null ? r.cancellationPct.toFixed(1) : null, 'maxCancel', r.cancellationPct !== null ? '%' : '')),
  },
  {
    label: 'KPT P80 (min)', value: r => r.kptP80Minutes, numeric: true,
    render: (cell, r) => cell.appendChild(metricChip('', r.kptP80Minutes !== null ? r.kptP80Minutes.toFixed(1) : null, 'maxKpt')),
  },
  {
    label: 'Availability %', value: r => r.availability, numeric: true,
    render: (cell, r) => cell.appendChild(metricChip('', r.availability !== null ? r.availability.toFixed(0) : null, 'min90', r.availability !== null ? '%' : '')),
  },
  {
    label: 'Serviceability %', value: r => r.serviceability, numeric: true,
    render: (cell, r) => cell.appendChild(metricChip('', r.serviceability !== null ? r.serviceability.toFixed(0) : null, 'min90', r.serviceability !== null ? '%' : '')),
  },
];

const healthSortState = { col: null, dir: 1 };

function renderHealthTable(stores, opsRows, range) {
  const rows = stores.map(s => buildHealthRow(s, opsRows, range));
  renderSortableTable('health-table', HEALTH_COLUMNS, rows, healthSortState);
}

// ---------- boot ----------

async function loadData() {
  const [dashboard, opsCsvText, hoursCsvText] = await Promise.all([
    fetch('data.json').then(r => r.json()),
    fetch(OPS_CSV_URL).then(r => r.text()).catch(() => ''),
    fetch(HOURS_CSV_URL).then(r => r.text()).catch(() => ''),
  ]);
  const opsRows = opsCsvText ? parseOpsCsv(opsCsvText) : [];
  const storeHours = hoursCsvText ? parseStoreHoursCsv(hoursCsvText) : {};
  return { dashboard, opsRows, storeHours };
}

function renderAll({ dashboard, opsRows, storeHours }) {
  const selected = getSelectedStore(dashboard.stores);
  const baseStores = selected ? [selected] : dashboard.stores;
  const today = latestCompleteDate(dashboard.stores) || dashboard.generated_at_ist.slice(0, 10);
  const latestOps = latestOpsByStorePlatform(opsRows);
  const allAlerts = window.Alerts.computeAlerts(dashboard.stores, latestOps, THRESHOLDS, today);
  const severityMap = severityByStore(allAlerts);
  const scopedAlerts = selected ? allAlerts.filter(a => a.store === selected.display_name) : allAlerts;

  renderHeader(dashboard);
  renderStorePicker(dashboard.stores, selected);
  renderKpis(computeFixedKpis(baseStores, selected ? opsRows.filter(r => r.store === selected.display_name) : opsRows, scopedAlerts));
  renderAlerts(scopedAlerts);

  const categoryRow = document.getElementById('category-filter-row');
  categoryRow.style.display = selected ? 'none' : '';

  const availableDates = allDatesAcross(dashboard.stores);

  // Single source of truth for everything below the sticky date-range row —
  // the tables AND the card graphs all read from these same three knobs, so
  // they can never drift out of sync with each other.
  let currentRange = getRangeFromUrl(availableDates);
  if (!currentRange.start) currentRange = getDefaultRange(availableDates);
  let activeCategory = 'All';
  let cardChannel = 'total';

  const applyFilters = () => {
    const filtered = window.Alerts.filterByCategory(baseStores, activeCategory);
    renderStoreCards(filtered, severityMap, storeHours, currentRange, cardChannel);
    renderDetailTable(filtered, opsRows, currentRange);
    renderHealthTable(filtered, opsRows, currentRange);
  };

  document.querySelectorAll('.category-filter button').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.category;
      document.querySelectorAll('.category-filter button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
  });

  const handleChannelChange = (channel) => {
    cardChannel = channel;
    renderCardChannelToggle(cardChannel, handleChannelChange);
    applyFilters();
  };
  renderCardChannelToggle(cardChannel, handleChannelChange);

  renderDateRangeRow(availableDates, currentRange, (range) => {
    currentRange = range;
    applyFilters();
  });

  applyFilters();
}

loadData().then(renderAll).catch(err => {
  const el = document.getElementById('alerts-list');
  el.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'alert-card';
  li.textContent = `Failed to load dashboard data: ${err.message}`;
  el.appendChild(li);
});
