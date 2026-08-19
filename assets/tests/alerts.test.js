const test = require('node:test');
const assert = require('node:assert');
const { computeAlerts, isStale, filterByCategory } = require('../alerts');

const THRESHOLDS = {
  availability_pct: 90, serviceability_pct: 90, cancellation_pct: 5, rating_min: 4.0, stale_days: 3,
  cancellation_alert_pct: 2, kpt_p80_max_minutes: 10, min_online_opd: 10,
};

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

test('computeAlerts flags a store with no Zomato rating entered at all', () => {
  const stores = [{ display_name: 'PNQ Ravet', category: 'Cfi', launch_date: '2025-03-01', revenue: { daily: [] } }];
  const opsRows = [{ store: 'PNQ Ravet', platform: 'Swiggy', date: '2026-08-19', availability: null, serviceability: null, cancellation: null, rating: 4.6 }];
  const alerts = computeAlerts(stores, opsRows, THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'rating' && a.platform === 'Zomato' && a.value === 'not live'));
});

test('computeAlerts flags missing Zomato rating even when a blank-rating row exists for it', () => {
  // Real-world case: the sheet has a row for this store+platform (Date,
  // Store, Zomato, ...) but with every metric left blank because the
  // listing has no reviews yet — that row's mere presence must not be
  // mistaken for "rating entered".
  const stores = [{ display_name: 'PNQ Ravet', category: 'Cfi', launch_date: '2025-03-01', revenue: { daily: [] } }];
  const opsRows = [{ store: 'PNQ Ravet', platform: 'Zomato', date: '2026-08-18', availability: null, serviceability: null, cancellation: null, rating: null }];
  const alerts = computeAlerts(stores, opsRows, THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'rating' && a.platform === 'Zomato' && a.value === 'not live'));
});

test('computeAlerts does not flag missing Zomato rating when one exists', () => {
  const stores = [{ display_name: 'PNQ Pimpri', category: 'Cfi', launch_date: '2025-03-01', revenue: { daily: [] } }];
  const opsRows = [{ store: 'PNQ Pimpri', platform: 'Zomato', date: '2026-08-19', availability: null, serviceability: null, cancellation: null, rating: 4.0 }];
  const alerts = computeAlerts(stores, opsRows, THRESHOLDS, '2026-08-19');
  assert.strictEqual(alerts.some(a => a.type === 'rating' && a.value === 'not live'), false);
});

test('computeAlerts flags low online OPD for the most recent day', () => {
  const stores = [{
    display_name: 'PNQ Kothrud', category: 'Cfi', launch_date: '2025-03-01',
    revenue: { daily: [{ date: '2026-08-19', online: { swiggy: 100, zomato: 0, ownly: 0 }, dine_in: 0, total: 100, online_orders: 5, dine_in_orders: 0 }] },
  }];
  const alerts = computeAlerts(stores, [], THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'low_online_opd'));
});

test('computeAlerts does not flag low online OPD at or above the threshold', () => {
  const stores = [{
    display_name: 'PNQ Kothrud', category: 'Cfi', launch_date: '2025-03-01',
    revenue: { daily: [{ date: '2026-08-19', online: { swiggy: 500, zomato: 0, ownly: 0 }, dine_in: 0, total: 500, online_orders: 10, dine_in_orders: 0 }] },
  }];
  const alerts = computeAlerts(stores, [], THRESHOLDS, '2026-08-19');
  assert.strictEqual(alerts.some(a => a.type === 'low_online_opd'), false);
});

test('computeAlerts flags high computed cancellation for the most recent day', () => {
  const stores = [{
    display_name: 'PNQ Wagholi', category: 'Cfi', launch_date: '2025-03-01', revenue: { daily: [] },
    ops_computed: { daily: [{ date: '2026-08-19', platform: 'Swiggy', order_count: 20, cancelled_orders: 1, kpt_p80_minutes: 3 }] },
  }];
  const alerts = computeAlerts(stores, [], THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'cancellation_high'));
});

test('computeAlerts flags high computed KPT P80 for the most recent day', () => {
  const stores = [{
    display_name: 'PNQ Wagholi', category: 'Cfi', launch_date: '2025-03-01', revenue: { daily: [] },
    ops_computed: { daily: [{ date: '2026-08-19', platform: 'Swiggy', order_count: 20, cancelled_orders: 0, kpt_p80_minutes: 12 }] },
  }];
  const alerts = computeAlerts(stores, [], THRESHOLDS, '2026-08-19');
  assert.ok(alerts.some(a => a.type === 'kpt_high'));
});

test('computeAlerts does not flag computed cancellation/KPT when within thresholds', () => {
  const stores = [{
    display_name: 'PNQ Wagholi', category: 'Cfi', launch_date: '2025-03-01', revenue: { daily: [] },
    ops_computed: { daily: [{ date: '2026-08-19', platform: 'Swiggy', order_count: 20, cancelled_orders: 0, kpt_p80_minutes: 3 }] },
  }];
  const alerts = computeAlerts(stores, [], THRESHOLDS, '2026-08-19');
  assert.strictEqual(alerts.some(a => a.type === 'cancellation_high'), false);
  assert.strictEqual(alerts.some(a => a.type === 'kpt_high'), false);
});

test('filterByCategory returns only matching stores', () => {
  const stores = [{ category: 'Cfi' }, { category: 'Rebel' }];
  assert.strictEqual(filterByCategory(stores, 'Rebel').length, 1);
});

test('filterByCategory returns all stores for "All"', () => {
  const stores = [{ category: 'Cfi' }, { category: 'Rebel' }];
  assert.strictEqual(filterByCategory(stores, 'All').length, 2);
});
