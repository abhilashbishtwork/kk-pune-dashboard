'use strict';

function isStale(lastUpdatedStr, todayStr, staleDays) {
  const last = new Date(lastUpdatedStr + 'T00:00:00Z');
  const today = new Date(todayStr + 'T00:00:00Z');
  const diffDays = Math.round((today - last) / (1000 * 60 * 60 * 24));
  return diffDays > staleDays;
}

function computeAlerts(stores, opsRows, thresholds, todayStr) {
  const alerts = [];

  for (const store of stores) {
    if (store.launch_date && store.launch_date <= todayStr) {
      const todayEntry = store.revenue.daily.find(d => d.date === todayStr);
      const hasAnyHistory = store.revenue.daily.some(d => d.date < todayStr);
      if (hasAnyHistory && (!todayEntry || todayEntry.total === 0)) {
        alerts.push({ store: store.display_name, type: 'zero_revenue', detail: `No revenue recorded for ${todayStr}` });
      }
      if (todayEntry && todayEntry.online_orders < thresholds.min_online_opd) {
        alerts.push({ store: store.display_name, type: 'low_online_opd', detail: `Only ${todayEntry.online_orders} online orders on ${todayStr} (< ${thresholds.min_online_opd})` });
      }
    }

    // Cancellation % and KPT P80 computed live from ClickHouse (see
    // build/aggregate.py) — flagged for the most recent day, aggregated
    // across platforms with orders that day.
    const opsComputedDaily = (store.ops_computed && store.ops_computed.daily) || [];
    const todaysComputed = opsComputedDaily.filter(d => d.date === todayStr);
    if (todaysComputed.length) {
      let orders = 0, cancelled = 0, kptWeightedSum = 0, kptWeight = 0;
      for (const d of todaysComputed) {
        orders += d.order_count;
        cancelled += d.cancelled_orders;
        if (d.kpt_p80_minutes !== null) { kptWeightedSum += d.kpt_p80_minutes * d.order_count; kptWeight += d.order_count; }
      }
      const cancellationPct = orders > 0 ? (cancelled / orders) * 100 : null;
      const kptP80 = kptWeight > 0 ? kptWeightedSum / kptWeight : null;
      if (cancellationPct !== null && cancellationPct > thresholds.cancellation_alert_pct) {
        alerts.push({ store: store.display_name, type: 'cancellation_high', detail: `Cancellation ${cancellationPct.toFixed(1)}% > ${thresholds.cancellation_alert_pct}%` });
      }
      if (kptP80 !== null && kptP80 > thresholds.kpt_p80_max_minutes) {
        alerts.push({ store: store.display_name, type: 'kpt_high', detail: `KPT P80 ${kptP80.toFixed(1)} min > ${thresholds.kpt_p80_max_minutes} min` });
      }
    }

    const storeOps = opsRows.filter(r => r.store === store.display_name);

    if (!storeOps.some(r => r.platform === 'Zomato')) {
      alerts.push({ store: store.display_name, type: 'missing_zomato_rating', detail: 'Zomato listing not live / no rating entered yet' });
    }

    for (const row of storeOps) {
      if (row.availability !== null && row.availability < thresholds.availability_pct) {
        alerts.push({ store: store.display_name, type: 'availability', detail: `${row.platform} availability ${row.availability}% < ${thresholds.availability_pct}%` });
      }
      if (row.serviceability !== null && row.serviceability < thresholds.serviceability_pct) {
        alerts.push({ store: store.display_name, type: 'serviceability', detail: `${row.platform} serviceability ${row.serviceability}% < ${thresholds.serviceability_pct}%` });
      }
      if (row.cancellation !== null && row.cancellation > thresholds.cancellation_pct) {
        alerts.push({ store: store.display_name, type: 'cancellation', detail: `${row.platform} cancellation ${row.cancellation}% > ${thresholds.cancellation_pct}%` });
      }
      if (row.rating !== null && row.rating < thresholds.rating_min) {
        alerts.push({ store: store.display_name, type: 'rating', detail: `${row.platform} rating ${row.rating} < ${thresholds.rating_min}` });
      }
      if (isStale(row.date, todayStr, thresholds.stale_days)) {
        alerts.push({ store: store.display_name, type: 'stale', detail: `${row.platform} data last updated ${row.date}` });
      }
    }
  }

  return alerts;
}

function filterByCategory(stores, category) {
  if (!category || category === 'All') return stores;
  return stores.filter(s => s.category === category);
}

const AlertsModule = { computeAlerts, isStale, filterByCategory };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AlertsModule;
}
if (typeof window !== 'undefined') {
  window.Alerts = AlertsModule;
}
