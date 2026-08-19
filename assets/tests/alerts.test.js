const test = require('node:test');
const assert = require('node:assert');
const { computeAlerts, isStale, filterByCategory } = require('../alerts');

const THRESHOLDS = { availability_pct: 90, serviceability_pct: 90, cancellation_pct: 5, rating_min: 4.0, stale_days: 3 };

test('isStale returns true when older than threshold', () => {
  assert.strictEqual(isStale('2026-08-10', '2026-08-19', 3), true);
});

test('isStale returns false when within threshold', () => {
  assert.strictEqual(isStale('2026-08-18', '2026-08-19', 3), false);
});

test('computeAlerts flags low availability', () => {
  const stores = [{ display_name: 'PNQ Pimpri', category: 'Cfi', launch_date: '2025-03-01', revenue: { daily: [] } }];
  const opsRows = [{ store: 'PNQ Pimpri', platform: 'Swiggy', date: '2026-08-19', availability: 80, serviceability: null, cancellation: null, rating: null }];
  const alerts = computeAlerts(stores, opsRows, THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'availability'));
});

test('computeAlerts flags low rating', () => {
  const stores = [{ display_name: 'PNQ Pimpri', category: 'Cfi', launch_date: '2025-03-01', revenue: { daily: [] } }];
  const opsRows = [{ store: 'PNQ Pimpri', platform: 'Google', date: '2026-08-19', availability: null, serviceability: null, cancellation: null, rating: 3.5 }];
  const alerts = computeAlerts(stores, opsRows, THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'rating'));
});

test('computeAlerts flags stale ops data', () => {
  const stores = [{ display_name: 'PNQ Pimpri', category: 'Cfi', launch_date: '2025-03-01', revenue: { daily: [] } }];
  const opsRows = [{ store: 'PNQ Pimpri', platform: 'Swiggy', date: '2026-08-10', availability: 95, serviceability: 95, cancellation: 2, rating: 4.5 }];
  const alerts = computeAlerts(stores, opsRows, THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'stale'));
});

test('computeAlerts suppresses zero-revenue alert before launch_date', () => {
  const stores = [{ display_name: 'PNQ Ravet', category: 'Cfi', launch_date: '2026-08-15', revenue: { daily: [] } }];
  const alerts = computeAlerts(stores, [], THRESHOLDS, '2026-08-12');
  assert.strictEqual(alerts.some(a => a.type === 'zero_revenue'), false);
});

test('computeAlerts flags zero revenue after launch when history exists but today is missing', () => {
  const stores = [{
    display_name: 'PNQ Pimpri', category: 'Cfi', launch_date: '2025-03-01',
    revenue: { daily: [{ date: '2026-08-18', online: { swiggy: 100, zomato: 0, ownly: 0 }, dine_in: 0, total: 100 }] },
  }];
  const alerts = computeAlerts(stores, [], THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'zero_revenue'));
});

test('filterByCategory returns only matching stores', () => {
  const stores = [{ category: 'Cfi' }, { category: 'Rebel' }];
  assert.strictEqual(filterByCategory(stores, 'Rebel').length, 1);
});

test('filterByCategory returns all stores for "All"', () => {
  const stores = [{ category: 'Cfi' }, { category: 'Rebel' }];
  assert.strictEqual(filterByCategory(stores, 'All').length, 2);
});
