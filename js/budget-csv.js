/*
 * Import/export helpers for the Vertex42 "Personal Monthly Budget" CSV layout.
 *
 * The spreadsheet is laid out as two side-by-side blocks of sections:
 *   left block  -> columns A-D (name, budget, actual, difference)
 *   right block -> columns F-I (name, budget, actual, difference)
 * Each section starts with a header row ("HOME EXPENSES, Budget, Actual, Difference")
 * and ends with a "Total <SECTION>" row. "BUDGET SUMMARY" is computed, so it is skipped.
 *
 * Works in the browser (attaches to window.BudgetCSV) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  /** Parse CSV text into an array of rows (handles quoted fields and escaped quotes). */
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /** Parse spreadsheet-formatted numbers: "4,500.00", "(2,060.19)", " -   ", "". */
  function parseAmount(value) {
    if (value == null) return 0;
    let s = String(value).trim();
    if (s === '' || s === '-') return 0;
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    s = s.replace(/[^0-9.\-]/g, '');
    if (s === '' || s === '-') return 0;
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return Math.round((negative ? -n : n) * 100) / 100;
  }

  function titleCase(name) {
    return name.toLowerCase().replace(/(^|[\s/&])([a-z])/g, (m, p, ch) => p + ch.toUpperCase());
  }

  const SKIP_SECTIONS = new Set(['BUDGET SUMMARY']);

  /** Read one block (given its starting column) and return its sections in order. */
  function readBlock(rows, col) {
    const sections = [];
    let current = null;
    rows.forEach((r) => {
      const name = (r[col] || '').trim();
      const budgetCell = (r[col + 1] || '').trim();
      const actualCell = (r[col + 2] || '').trim();

      if (budgetCell.toLowerCase() === 'budget' && actualCell.toLowerCase() === 'actual' && name) {
        current = SKIP_SECTIONS.has(name.toUpperCase()) ? null : { name, items: [] };
        if (current) sections.push(current);
        return;
      }
      if (!current) return;
      if (/^total\b/i.test(name)) { current = null; return; }

      const budget = parseAmount(budgetCell);
      const actual = parseAmount(actualCell);
      // Blank template rows ("", 0.00, 0.00) carry no information.
      if (!name && budget === 0 && actual === 0) return;
      current.items.push({ name: name || 'Unnamed', budget, actual });
    });
    return sections;
  }

  /**
   * Convert a Vertex42 budget CSV into { income: [...items], categories: [{name, items}] }.
   * Item shape: { name, budget, actual }.
   */
  function importVertex42(text) {
    const rows = parseCSV(text.replace(/^﻿/, ''));
    const sections = readBlock(rows, 0).concat(readBlock(rows, 5));
    if (!sections.length) {
      throw new Error('No budget sections found. Expected headers like "INCOME, Budget, Actual, Difference".');
    }
    const result = { income: [], categories: [] };
    sections.forEach((s) => {
      if (s.name.toUpperCase() === 'INCOME') {
        result.income.push(...s.items);
      } else {
        result.categories.push({ name: titleCase(s.name), items: s.items });
      }
    });
    return result;
  }

  function csvField(v) {
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Serialise rows (arrays of values) to CSV text. */
  function toCSV(rows) {
    return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
  }

  const api = { parseCSV, parseAmount, importVertex42, toCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BudgetCSV = api;
})(typeof window !== 'undefined' ? window : globalThis);
