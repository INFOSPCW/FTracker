/* UI for FTracker. Depends on window.Store and window.BudgetCSV. */
(function () {
  'use strict';

  const { Store, BudgetCSV } = window;
  const $ = (sel) => document.querySelector(sel);

  let state = Store.load();
  let currentKey = Store.monthKey(new Date());
  let txFilter = 'all';
  const collapsed = new Set();

  // ---------- helpers ----------

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k in node && k !== 'list') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach((c) => {
      if (c == null || c === false) return;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  const numberFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(n) {
    const sym = state.settings.currency;
    const s = numberFormat.format(Math.abs(n));
    const withSym = sym ? sym + (sym.length > 1 ? ' ' : '') + s : s;
    return n < 0 ? '(' + withSym + ')' : withSym;
  }

  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function persist() {
    if (!Store.save(state)) toast('Could not save — browser storage may be full or disabled.');
  }

  function commit() { persist(); render(); }

  // Inline edits fire "change" while focus is moving (e.g. on Tab); re-render after
  // the focus has landed so render() can restore it on the rebuilt element.
  function commitSoon() { persist(); setTimeout(render, 0); }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const a = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function month() { return state.months[currentKey]; }

  function defaultDate() {
    const today = new Date();
    const todayKey = Store.monthKey(today);
    if (todayKey === currentKey) return today.toISOString().slice(0, 10);
    return currentKey + '-01';
  }

  function diffClass(n) { return n < 0 ? 'neg' : n > 0 ? 'pos' : ''; }

  // ---------- rendering ----------

  function render() {
    const active = document.activeElement;
    const focusKey = active && active.dataset ? active.dataset.key : null;
    renderPage();
    if (focusKey) {
      const target = document.querySelector('[data-key="' + focusKey + '"]');
      if (target) target.focus();
    }
  }

  function renderPage() {
    $('#monthPicker').value = currentKey;
    document.title = 'FTracker · ' + monthLabel(currentKey);
    const m = month();
    $('#emptyState').hidden = !!m;
    $('#monthContent').hidden = !m;
    if (!m) {
      $('#summary').replaceChildren();
      renderEmpty();
      return;
    }
    const summary = Store.summarize(m);
    renderSummary(summary);
    renderTxForm(m);
    renderSections(m, summary);
    renderBreakdown(summary);
    renderTransactions(m);
  }

  function renderEmpty() {
    $('#emptyMonthLabel').textContent = monthLabel(currentKey);
    const prev = Store.previousMonthWithPlan(state, currentKey);
    $('#copyPrevBtn').disabled = !prev;
    $('#copyPrevHint').textContent = prev
      ? 'Copies categories and budgets from ' + monthLabel(prev) + ' (transactions are not copied).'
      : 'No earlier month to copy from yet.';
  }

  function renderSummary(s) {
    const card = (title, t, opts) => {
      const pct = t.budget > 0 ? Math.min(100, (t.actual / t.budget) * 100) : 0;
      return el('div', { class: 'stat card' + (opts.accent ? ' accent' : '') },
        el('div', { class: 'stat-title' }, title),
        el('div', { class: 'stat-value ' + (opts.signed ? diffClass(t.actual) : '') }, money(t.actual)),
        el('div', { class: 'stat-sub' }, 'Budget ', el('strong', {}, money(t.budget))),
        opts.bar ? el('div', { class: 'bar' + (opts.income ? ' income' : t.actual > t.budget ? ' over' : '') },
          el('span', { style: 'width:' + pct + '%' })) : null,
        el('div', { class: 'stat-sub' }, opts.diffLabel + ' ',
          el('strong', { class: diffClass(t.difference) }, money(t.difference))));
    };
    $('#summary').replaceChildren(
      card('Income', s.income, { diffLabel: 'vs budget', bar: true, income: true }),
      card('Expenses', s.expenses, { diffLabel: 'Remaining', bar: true }),
      card('Net', s.net, { diffLabel: 'vs plan', signed: true, accent: true }),
    );
  }

  function renderTxForm(m) {
    const form = $('#txForm');
    const select = form.elements.itemId;
    const previous = select.value;
    const groups = [];
    if (m.income.length) {
      groups.push(el('optgroup', { label: 'Income' }, m.income.map((i) => el('option', { value: i.id }, i.name))));
    }
    m.categories.forEach((c) => {
      if (c.items.length) {
        groups.push(el('optgroup', { label: c.name }, c.items.map((i) => el('option', { value: i.id }, i.name))));
      }
    });
    select.replaceChildren(el('option', { value: '' }, 'Choose…'), ...groups);
    if (previous && Store.itemIndex(m)[previous]) select.value = previous;

    const date = form.elements.date;
    date.min = currentKey + '-01';
    const [y, mo] = currentKey.split('-').map(Number);
    date.max = currentKey + '-' + String(new Date(y, mo, 0).getDate()).padStart(2, '0');
    if (!date.value || date.value.slice(0, 7) !== currentKey) date.value = defaultDate();
  }

  function renderSections(m, summary) {
    const container = $('#sections');
    const sections = [
      sectionCard({ id: '__income', name: 'Income', items: m.income, kind: 'income' }, summary.income, summary.actuals),
      ...m.categories.map((c, i) => sectionCard({ ...c, kind: 'expense', ref: c }, summary.categories[i], summary.actuals)),
    ];
    container.replaceChildren(...sections);
  }

  function sectionCard(section, totals, actuals) {
    const isIncome = section.kind === 'income';
    const isCollapsed = collapsed.has(section.id);
    const pct = totals.budget > 0 ? Math.min(100, (totals.actual / totals.budget) * 100) : 0;
    const over = isIncome ? false : totals.actual > totals.budget;

    const head = el('div', { class: 'section-head' },
      el('button', {
        class: 'icon-btn toggle', 'aria-expanded': String(!isCollapsed),
        'aria-label': (isCollapsed ? 'Expand ' : 'Collapse ') + section.name,
        onclick: () => { isCollapsed ? collapsed.delete(section.id) : collapsed.add(section.id); render(); },
      }, isCollapsed ? '▸' : '▾'),
      isIncome
        ? el('h3', {}, 'Income')
        : el('input', {
          class: 'section-name', value: section.name, 'aria-label': 'Category name', 'data-key': 'cat:' + section.id,
          onchange: (e) => { section.ref.name = e.target.value.trim() || section.ref.name; commitSoon(); },
        }),
      el('div', { class: 'section-totals' },
        el('span', {}, money(totals.actual), el('span', { class: 'muted' }, ' / ' + money(totals.budget))),
        el('div', { class: 'bar small' + (over ? ' over' : '') + (isIncome ? ' income' : '') },
          el('span', { style: 'width:' + pct + '%' }))),
      isIncome ? null : el('button', {
        class: 'icon-btn danger', 'aria-label': 'Delete category ' + section.name, title: 'Delete category',
        onclick: () => deleteCategory(section.ref),
      }, '🗑'),
    );

    const card = el('section', { class: 'card section' + (isCollapsed ? ' collapsed' : '') }, head);
    if (isCollapsed) return card;

    const rows = section.items.map((item) => {
      const actual = actuals[item.id] || 0;
      const diff = Store.round2(isIncome ? actual - item.budget : item.budget - actual);
      return el('tr', {},
        el('td', {}, el('input', {
          class: 'cell-name', value: item.name, 'aria-label': 'Item name', 'data-key': 'name:' + item.id,
          onchange: (e) => { item.name = e.target.value.trim() || item.name; commitSoon(); },
        })),
        el('td', { class: 'num' }, el('input', {
          class: 'cell-num', type: 'number', step: '0.01', inputMode: 'decimal', value: item.budget ? item.budget.toFixed(2) : '',
          placeholder: '0.00', 'aria-label': 'Budget for ' + item.name, 'data-key': 'budget:' + item.id,
          onchange: (e) => { item.budget = Store.round2(Math.max(0, +e.target.value || 0)); commitSoon(); },
        })),
        el('td', { class: 'num' }, el('button', {
          class: 'link amount-link', title: 'Show transactions', 'data-key': 'actual:' + item.id, onclick: () => { txFilter = item.id; render(); },
        }, money(actual))),
        el('td', { class: 'num ' + diffClass(diff) }, money(diff)),
        el('td', { class: 'row-actions' },
          el('button', { class: 'icon-btn', title: 'Add transaction', 'data-key': 'add:' + item.id, 'aria-label': 'Add transaction to ' + item.name, onclick: () => focusTxFor(item.id) }, '+'),
          el('button', { class: 'icon-btn danger', title: 'Delete item', 'data-key': 'del:' + item.id, 'aria-label': 'Delete ' + item.name, onclick: () => deleteItem(section, item) }, '×')),
      );
    });

    const table = el('table', { class: 'items' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Item'), el('th', { class: 'num' }, 'Budget'), el('th', { class: 'num' }, 'Actual'),
        el('th', { class: 'num' }, 'Difference'), el('th', {}, el('span', { class: 'sr-only' }, 'Actions')))),
      el('tbody', {}, rows),
      el('tfoot', {}, el('tr', {},
        el('td', {}, el('button', { class: 'link', onclick: () => addItem(section) }, '+ Add item')),
        el('td', { class: 'num' }, money(totals.budget)),
        el('td', { class: 'num' }, money(totals.actual)),
        el('td', { class: 'num ' + diffClass(totals.difference) }, money(totals.difference)),
        el('td', {}))),
    );
    card.append(el('div', { class: 'table-wrap' }, table));
    return card;
  }

  function renderBreakdown(summary) {
    const cats = summary.categories.filter((c) => c.budget || c.actual).sort((a, b) => b.actual - a.actual);
    if (!cats.length) {
      $('#breakdown').replaceChildren(el('p', { class: 'muted' }, 'Set budgets or add transactions to see a breakdown.'));
      return;
    }
    const max = Math.max(...cats.map((c) => Math.max(c.actual, c.budget)), 1);
    $('#breakdown').replaceChildren(
      el('ul', { class: 'breakdown' }, cats.map((c) => el('li', {},
        el('div', { class: 'bd-label' }, el('span', {}, c.name), el('span', { class: 'muted' }, money(c.actual) + ' / ' + money(c.budget))),
        el('div', { class: 'bd-track' },
          el('span', { class: 'bd-budget', style: 'width:' + (c.budget / max) * 100 + '%' }),
          el('span', { class: 'bd-actual' + (c.actual > c.budget ? ' over' : ''), style: 'width:' + (c.actual / max) * 100 + '%' }))))),
      el('div', { class: 'legend' },
        el('span', {}, el('i', { class: 'sw actual' }), 'Actual'),
        el('span', {}, el('i', { class: 'sw budget' }), 'Budget'),
        el('span', {}, el('i', { class: 'sw over' }), 'Over budget')),
    );
  }

  function renderTransactions(m) {
    const index = Store.itemIndex(m);
    if (txFilter !== 'all' && !index[txFilter]) txFilter = 'all';

    const filter = $('#txFilter');
    filter.replaceChildren(
      el('option', { value: 'all' }, 'All'),
      el('optgroup', { label: 'Income' }, m.income.map((i) => el('option', { value: i.id }, i.name))),
      ...m.categories.filter((c) => c.items.length).map((c) =>
        el('optgroup', { label: c.name }, c.items.map((i) => el('option', { value: i.id }, i.name)))),
    );
    filter.value = txFilter;

    const list = m.transactions
      .filter((t) => txFilter === 'all' || t.itemId === txFilter)
      .slice()
      .sort((a, b) => (b.date.localeCompare(a.date)) || 0);

    if (!list.length) {
      $('#txList').replaceChildren(el('li', { class: 'muted empty-row' }, 'No transactions yet.'));
      return;
    }
    $('#txList').replaceChildren(...list.map((t) => {
      const info = index[t.itemId];
      const isIncome = info && info.kind === 'income';
      const label = info ? info.item.name : 'Deleted item';
      const sub = info ? (isIncome ? 'Income' : info.category.name) : '';
      return el('li', { class: 'tx' },
        el('div', { class: 'tx-date' }, new Date(t.date + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })),
        el('div', { class: 'tx-main' },
          el('div', {}, label, sub ? el('span', { class: 'muted' }, ' · ' + sub) : null),
          t.note ? el('div', { class: 'muted small' }, t.note) : null),
        el('div', { class: 'tx-amt ' + (isIncome ? 'pos' : '') }, (isIncome ? '+' : '−') + money(t.amount)),
        el('button', { class: 'icon-btn danger', 'aria-label': 'Delete transaction', title: 'Delete', onclick: () => deleteTransaction(t) }, '×'));
    }));
  }

  // ---------- actions ----------

  function addItem(section) {
    const name = prompt('Name of the new item:');
    if (!name || !name.trim()) return;
    section.items.push({ id: Store.uid(), name: name.trim(), budget: 0 });
    commit();
  }

  function deleteItem(section, item) {
    const m = month();
    const count = m.transactions.filter((t) => t.itemId === item.id).length;
    const msg = count
      ? `Delete "${item.name}" and its ${count} transaction(s)?`
      : `Delete "${item.name}"?`;
    if (!confirm(msg)) return;
    const idx = section.items.indexOf(item);
    if (idx >= 0) section.items.splice(idx, 1);
    m.transactions = m.transactions.filter((t) => t.itemId !== item.id);
    commit();
  }

  function deleteCategory(category) {
    const m = month();
    const ids = new Set(category.items.map((i) => i.id));
    const count = m.transactions.filter((t) => ids.has(t.itemId)).length;
    if (!confirm(`Delete category "${category.name}"` + (count ? ` and its ${count} transaction(s)?` : '?'))) return;
    m.categories = m.categories.filter((c) => c !== category);
    m.transactions = m.transactions.filter((t) => !ids.has(t.itemId));
    commit();
  }

  function deleteTransaction(t) {
    const m = month();
    m.transactions = m.transactions.filter((x) => x !== t);
    commit();
    toast('Transaction deleted');
  }

  function focusTxFor(itemId) {
    const form = $('#txForm');
    form.elements.itemId.value = itemId;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.elements.amount.focus({ preventScroll: true });
  }

  function setMonth(key) {
    currentKey = key;
    txFilter = 'all';
    render();
  }

  function startMonth(m) {
    state.months[currentKey] = m;
    commit();
  }

  // ---------- import / export ----------

  function openImport() {
    const form = $('#importForm');
    form.reset();
    form.elements.month.value = currentKey;
    $('#importError').hidden = true;
    $('#importDialog').showModal();
  }

  async function runImport() {
    const form = $('#importForm');
    const file = form.elements.file.files[0];
    const key = form.elements.month.value;
    if (!file || !key) return;
    try {
      const text = await file.text();
      const parsed = BudgetCSV.importVertex42(text);
      if (state.months[key] && !confirm(`Replace the existing budget and transactions for ${monthLabel(key)}?`)) return;
      state.months[key] = Store.monthFromImport(parsed, key, form.elements.withActuals.checked);
      currentKey = key;
      txFilter = 'all';
      commit();
      const items = parsed.income.length + parsed.categories.reduce((n, c) => n + c.items.length, 0);
      toast(`Imported ${parsed.categories.length} categories, ${items} items into ${monthLabel(key)}`);
    } catch (e) {
      $('#importError').textContent = e.message;
      $('#importError').hidden = false;
      $('#importDialog').showModal();
    }
  }

  function exportSummary() {
    const m = month();
    if (!m) return toast('Nothing to export for this month.');
    const s = Store.summarize(m);
    const rows = [['Section', 'Item', 'Budget', 'Actual', 'Difference']];
    const f = (n) => n.toFixed(2);
    m.income.forEach((i) => {
      const a = s.actuals[i.id] || 0;
      rows.push(['Income', i.name, f(i.budget), f(a), f(a - i.budget)]);
    });
    rows.push(['Total Income', '', f(s.income.budget), f(s.income.actual), f(s.income.difference)]);
    m.categories.forEach((c, ci) => {
      c.items.forEach((i) => {
        const a = s.actuals[i.id] || 0;
        rows.push([c.name, i.name, f(i.budget), f(a), f(i.budget - a)]);
      });
      const t = s.categories[ci];
      rows.push(['Total ' + c.name, '', f(t.budget), f(t.actual), f(t.difference)]);
    });
    rows.push(['Total Expenses', '', f(s.expenses.budget), f(s.expenses.actual), f(s.expenses.difference)]);
    rows.push(['NET', '', f(s.net.budget), f(s.net.actual), f(s.net.difference)]);
    download(`budget-${currentKey}.csv`, BudgetCSV.toCSV(rows), 'text/csv');
  }

  function exportTransactions() {
    const m = month();
    if (!m || !m.transactions.length) return toast('No transactions to export for this month.');
    const index = Store.itemIndex(m);
    const rows = [['Date', 'Type', 'Category', 'Item', 'Amount', 'Note']];
    m.transactions.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => {
      const info = index[t.itemId];
      rows.push([t.date, info ? info.kind : '', info ? (info.category ? info.category.name : 'Income') : '',
        info ? info.item.name : '(deleted)', t.amount.toFixed(2), t.note]);
    });
    download(`transactions-${currentKey}.csv`, BudgetCSV.toCSV(rows), 'text/csv');
  }

  function backup() {
    download(`ftracker-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json');
  }

  async function restore(file) {
    try {
      const data = Store.normalize(JSON.parse(await file.text()));
      const n = Object.keys(data.months).length;
      if (!confirm(`Replace all current data with this backup (${n} month(s))?`)) return;
      state = data;
      commit();
      toast('Backup restored');
    } catch (e) {
      alert('Could not restore backup: ' + e.message);
    }
  }

  // ---------- wiring ----------

  $('#prevMonth').addEventListener('click', () => setMonth(Store.shiftMonth(currentKey, -1)));
  $('#nextMonth').addEventListener('click', () => setMonth(Store.shiftMonth(currentKey, 1)));
  $('#monthPicker').addEventListener('change', (e) => { if (e.target.value) setMonth(e.target.value); });

  $('#copyPrevBtn').addEventListener('click', () => {
    const prev = Store.previousMonthWithPlan(state, currentKey);
    if (prev) startMonth(Store.copyPlan(state.months[prev]));
  });
  $('#defaultTemplateBtn').addEventListener('click', () => startMonth(Store.monthFromTemplate()));
  $('#emptyImportBtn').addEventListener('click', openImport);

  $('#addCategoryBtn').addEventListener('click', () => {
    const name = prompt('Name of the new category:');
    if (!name || !name.trim()) return;
    month().categories.push({ id: Store.uid(), name: name.trim(), items: [] });
    commit();
  });

  $('#txForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const amount = Store.round2(+form.elements.amount.value);
    const itemId = form.elements.itemId.value;
    if (!itemId || !(amount > 0)) return;
    month().transactions.push({
      id: Store.uid(), date: form.elements.date.value, itemId, amount, note: form.elements.note.value.trim(),
    });
    form.elements.amount.value = '';
    form.elements.note.value = '';
    commit();
    form.elements.amount.focus();
    toast('Transaction added');
  });

  $('#txFilter').addEventListener('change', (e) => { txFilter = e.target.value; render(); });

  // Menu
  const menuBtn = $('#menuBtn');
  const menuList = $('#menuList');
  const closeMenu = () => { menuList.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuList.hidden = !menuList.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menuList.hidden));
  });
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  menuList.addEventListener('click', (e) => {
    const action = e.target.dataset && e.target.dataset.action;
    if (!action) return;
    closeMenu();
    switch (action) {
      case 'import': openImport(); break;
      case 'export-summary': exportSummary(); break;
      case 'export-transactions': exportTransactions(); break;
      case 'backup': backup(); break;
      case 'restore': $('#restoreInput').click(); break;
      case 'settings':
        $('#settingsForm').elements.currency.value = state.settings.currency;
        $('#settingsDialog').showModal();
        break;
      case 'delete-month':
        if (month() && confirm(`Delete the budget and all transactions for ${monthLabel(currentKey)}?`)) {
          delete state.months[currentKey];
          commit();
        }
        break;
    }
  });

  $('#importDialog').addEventListener('close', () => {
    if ($('#importDialog').returnValue === 'ok') runImport();
  });
  $('#settingsDialog').addEventListener('close', () => {
    if ($('#settingsDialog').returnValue !== 'ok') return;
    state.settings.currency = $('#settingsForm').elements.currency.value.trim();
    commit();
  });
  $('#restoreInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) restore(file);
  });

  // Keep multiple tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key === Store.STORAGE_KEY) { state = Store.load(); render(); }
  });

  render();
})();
