/*
 * Data model + persistence (localStorage) + budget calculations.
 *
 * state = {
 *   version, settings: { currency },
 *   months: { "YYYY-MM": {
 *     income: [{ id, name, budget }],
 *     categories: [{ id, name, items: [{ id, name, budget }] }],
 *     transactions: [{ id, date, itemId, amount, note }]
 *   } }
 * }
 * "Actual" amounts are always the sum of a line item's transactions.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'ftracker.v1';

  // Default plan, based on the sections of the Vertex42 Personal Monthly Budget template.
  const DEFAULT_TEMPLATE = {
    income: ['Salary', 'Other income'],
    categories: [
      ['Home Expenses', ['Mortgage', 'Rent', 'Electricity', 'Gas/Oil', 'Water/Sewer/Trash', 'Phone',
        'Cable/Satellite', 'Internet', 'Furnishings/Appliances', 'Maintenance/Supplies', 'Other']],
      ['Transportation', ['Fuel', 'Car Insurance', 'Repairs/Maintenance', 'Other']],
      ['Health', ['Health Insurance', 'Doctor/Dentist', 'Medicine/Drugs', 'Gym', 'Life Insurance', 'Other']],
      ['Charity/Gifts', ['Gifts to Family', 'Religious Donations', 'Other']],
      ['Daily Living', ['Groceries', 'Clothing', 'Personal Care', 'Dining/Eating Out', 'Other']],
      ['Entertainment', ['Streaming', 'Outdoor Recreation', 'Sports', 'Vacation/Travel', 'Other']],
      ['Savings', ['Personal Savings', 'Retirement Fund', 'Investments', 'Education Fund']],
      ['Obligations', ['Loans', 'Credit Card', 'Other']],
      ['Subscriptions', ['Newspaper', 'Magazines', 'Dues/Memberships', 'Other']],
      ['Miscellaneous', ['Other']],
    ],
  };

  let counter = 0;
  function uid() {
    counter = (counter + 1) % 1e6;
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + counter.toString(36);
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function emptyState() { return { version: 1, settings: { currency: '' }, months: {} }; }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      return normalize(JSON.parse(raw));
    } catch (e) {
      console.error('Could not load saved data', e);
      return emptyState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('Could not save data', e);
      return false;
    }
  }

  /** Validate/repair a state object (used for both loading and restoring backups). */
  function normalize(data) {
    if (!data || typeof data !== 'object' || typeof data.months !== 'object') {
      throw new Error('Not an FTracker backup file.');
    }
    const state = emptyState();
    state.settings.currency = String((data.settings && data.settings.currency) || '');
    Object.keys(data.months).forEach((key) => {
      if (!/^\d{4}-\d{2}$/.test(key)) return;
      const m = data.months[key] || {};
      const item = (i) => ({ id: String(i.id || uid()), name: String(i.name || 'Unnamed'), budget: round2(+i.budget || 0) });
      state.months[key] = {
        income: (m.income || []).map(item),
        categories: (m.categories || []).map((c) => ({
          id: String(c.id || uid()), name: String(c.name || 'Category'), items: (c.items || []).map(item),
        })),
        transactions: (m.transactions || []).map((t) => ({
          id: String(t.id || uid()), date: String(t.date || key + '-01'), itemId: String(t.itemId || ''),
          amount: round2(+t.amount || 0), note: String(t.note || ''),
        })),
      };
    });
    return state;
  }

  function monthFromTemplate() {
    return {
      income: DEFAULT_TEMPLATE.income.map((name) => ({ id: uid(), name, budget: 0 })),
      categories: DEFAULT_TEMPLATE.categories.map(([name, items]) => ({
        id: uid(), name, items: items.map((n) => ({ id: uid(), name: n, budget: 0 })),
      })),
      transactions: [],
    };
  }

  /** Copy the plan (income + categories + budgets) of a month, without its transactions. */
  function copyPlan(month) {
    return {
      income: month.income.map((i) => ({ ...i })),
      categories: month.categories.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i })) })),
      transactions: [],
    };
  }

  /** Build a month from an importVertex42() result. */
  function monthFromImport(parsed, monthKey, withActuals) {
    const month = { income: [], categories: [], transactions: [] };
    const date = monthKey + '-01';
    const addItem = (list, src) => {
      const item = { id: uid(), name: src.name, budget: round2(src.budget) };
      list.push(item);
      if (withActuals && src.actual) {
        month.transactions.push({ id: uid(), date, itemId: item.id, amount: round2(src.actual), note: 'Imported actual' });
      }
    };
    parsed.income.forEach((i) => addItem(month.income, i));
    parsed.categories.forEach((c) => {
      const cat = { id: uid(), name: c.name, items: [] };
      c.items.forEach((i) => addItem(cat.items, i));
      month.categories.push(cat);
    });
    return month;
  }

  /** Lookup of itemId -> { item, kind: 'income'|'expense', category } */
  function itemIndex(month) {
    const index = {};
    month.income.forEach((item) => { index[item.id] = { item, kind: 'income', category: null }; });
    month.categories.forEach((category) => category.items.forEach((item) => {
      index[item.id] = { item, kind: 'expense', category };
    }));
    return index;
  }

  function actualsByItem(month) {
    const totals = {};
    month.transactions.forEach((t) => { totals[t.itemId] = round2((totals[t.itemId] || 0) + t.amount); });
    return totals;
  }

  /**
   * Totals for a month. Differences follow the spreadsheet convention:
   * income: actual - budget; expenses: budget - actual (positive = under budget / good).
   */
  function summarize(month) {
    const actuals = actualsByItem(month);
    const line = (item) => ({ budget: item.budget, actual: actuals[item.id] || 0 });
    const sum = (lines) => lines.reduce((acc, l) => ({
      budget: round2(acc.budget + l.budget), actual: round2(acc.actual + l.actual),
    }), { budget: 0, actual: 0 });

    const income = sum(month.income.map(line));
    income.difference = round2(income.actual - income.budget);

    const categories = month.categories.map((c) => {
      const total = sum(c.items.map(line));
      total.difference = round2(total.budget - total.actual);
      return { id: c.id, name: c.name, ...total };
    });
    const expenses = sum(categories);
    expenses.difference = round2(expenses.budget - expenses.actual);

    const net = { budget: round2(income.budget - expenses.budget), actual: round2(income.actual - expenses.actual) };
    net.difference = round2(net.actual - net.budget);

    // Transactions whose line item was removed are kept visible but not counted.
    const index = itemIndex(month);
    const orphaned = month.transactions.filter((t) => !index[t.itemId]).length;

    return { actuals, income, expenses, net, categories, orphaned };
  }

  function monthKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    return monthKey(new Date(y, m - 1 + delta, 1));
  }

  /** Most recent month before `key` that has a plan. */
  function previousMonthWithPlan(state, key) {
    return Object.keys(state.months).filter((k) => k < key).sort().pop() || null;
  }

  const api = {
    STORAGE_KEY, DEFAULT_TEMPLATE, uid, round2, emptyState, load, save, normalize,
    monthFromTemplate, copyPlan, monthFromImport, itemIndex, actualsByItem, summarize,
    monthKey, shiftMonth, previousMonthWithPlan,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof window !== 'undefined' ? window : globalThis);
