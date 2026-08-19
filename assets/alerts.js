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
    }

    const storeOps = opsRows.filter(r => r.store === store.display_name);
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
