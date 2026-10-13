# FTracker — personal money tracker

A small, dependency-free web app for tracking a monthly budget, modelled on the
Vertex42 **Personal Monthly Budget** spreadsheet (Income, Home Expenses,
Transportation, Health, Charity/Gifts, Subscriptions, Daily Living,
Entertainment, Savings, Obligations, Miscellaneous).

## Features

- **Budget vs Actual vs Difference** for every line item, per category, and in a
  summary (Total Income, Total Expenses, NET), using the same conventions as the
  spreadsheet (expenses: budget − actual; income and net: actual − budget).
- **Transactions** — log each expense or income with a date and note; "Actual"
  is the sum of a line item's transactions. Filter the list by line item.
- **Edit the plan inline** — rename categories and items, change budgets, add or
  delete items and categories.
- **Monthly workflow** — move between months; start a new month by copying the
  previous month's plan (budgets only), from a default template, or by importing a CSV.
- **Import your existing spreadsheet** — *Menu → Import budget CSV* reads the
  Vertex42 layout (both column blocks). Optionally turns the "Actual" column
  into transactions dated the 1st of the month.
- **Export** the month summary or its transactions as CSV, and download/restore
  a full JSON backup.
- Spending-by-category chart, light/dark mode, works on phones.

Data is stored in your browser's `localStorage` — nothing is sent to a server.
Use *Menu → Download backup* regularly, especially before clearing browser data
or switching devices.

## Running

Open `index.html` in a browser, or serve the folder:

```sh
npm start        # python3 -m http.server 8080, then open http://localhost:8080
```

It can also be published as-is with GitHub Pages.

## Tests

```sh
npm test         # node --test (Node 18+)
```

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Page structure and dialogs |
| `css/styles.css` | Styling (light/dark, responsive) |
| `js/budget-csv.js` | CSV parsing, Vertex42 import, CSV export helpers |
| `js/store.js` | Data model, localStorage persistence, budget calculations |
| `js/app.js` | UI rendering and event handling |
| `tests/` | Unit tests and a synthetic sample CSV |
