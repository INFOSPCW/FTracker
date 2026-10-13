const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BudgetCSV = require('../js/budget-csv.js');
const Store = require('../js/store.js');

const sample = fs.readFileSync(path.join(__dirname, 'sample-budget.csv'), 'utf8');

test('parseAmount handles spreadsheet number formats', () => {
  assert.equal(BudgetCSV.parseAmount('4,500.00'), 4500);
  assert.equal(BudgetCSV.parseAmount('(2,060.19)'), -2060.19);
  assert.equal(BudgetCSV.parseAmount(' -   '), 0);
  assert.equal(BudgetCSV.parseAmount(''), 0);
  assert.equal(BudgetCSV.parseAmount('60.00 '), 60);
});

test('parseCSV handles quoted commas and escaped quotes', () => {
  assert.deepEqual(BudgetCSV.parseCSV('a,"b,c","d ""e"""\r\n1,2,3'), [['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
});

test('importVertex42 reads both column blocks and skips the summary', () => {
  const r = BudgetCSV.importVertex42(sample);
  assert.deepEqual(r.income, [{ name: 'Salary', budget: 3000, actual: 3100 }]);
  assert.deepEqual(r.categories.map((c) => c.name), ['Home Expenses', 'Daily Living']);
  assert.deepEqual(r.categories[0].items.map((i) => i.name), ['Rent', 'Electricity']);
  assert.deepEqual(r.categories[1].items[1], { name: 'Dining, Eating Out', budget: 0, actual: 0 });
});

test('importVertex42 rejects unrelated CSVs', () => {
  assert.throws(() => BudgetCSV.importVertex42('a,b,c\n1,2,3'), /No budget sections/);
});

test('imported month summary matches the spreadsheet totals', () => {
  const month = Store.monthFromImport(BudgetCSV.importVertex42(sample), '2026-04', true);
  const s = Store.summarize(month);
  assert.deepEqual(s.income, { budget: 3000, actual: 3100, difference: 100 });
  assert.deepEqual(s.expenses, { budget: 1250.5, actual: 900, difference: 350.5 });
  assert.deepEqual(s.net, { budget: 1749.5, actual: 2200, difference: 450.5 });
  assert.ok(month.transactions.every((t) => t.date === '2026-04-01'));
});

test('importing without actuals creates no transactions', () => {
  const month = Store.monthFromImport(BudgetCSV.importVertex42(sample), '2026-04', false);
  assert.equal(month.transactions.length, 0);
  assert.equal(Store.summarize(month).expenses.actual, 0);
});

test('copyPlan keeps budgets but drops transactions', () => {
  const month = Store.monthFromImport(BudgetCSV.importVertex42(sample), '2026-04', true);
  const copy = Store.copyPlan(month);
  assert.equal(copy.transactions.length, 0);
  assert.equal(Store.summarize(copy).expenses.budget, 1250.5);
  copy.categories[0].items[0].budget = 1;
  assert.equal(month.categories[0].items[0].budget, 1000, 'copy must not share item objects');
});

test('month helpers', () => {
  assert.equal(Store.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(Store.shiftMonth('2026-12', 1), '2027-01');
  const state = Store.emptyState();
  state.months['2026-02'] = Store.monthFromTemplate();
  state.months['2026-05'] = Store.monthFromTemplate();
  assert.equal(Store.previousMonthWithPlan(state, '2026-04'), '2026-02');
  assert.equal(Store.previousMonthWithPlan(state, '2026-01'), null);
});

test('normalize rejects non-backup data and repairs fields', () => {
  assert.throws(() => Store.normalize({ foo: 1 }), /Not an FTracker backup/);
  const s = Store.normalize({ months: { '2026-04': { income: [{ name: 'X', budget: '12.345' }] }, bad: {} } });
  assert.deepEqual(Object.keys(s.months), ['2026-04']);
  assert.equal(s.months['2026-04'].income[0].budget, 12.35);
});
