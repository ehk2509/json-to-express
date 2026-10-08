:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #172033;
  background: #f5f7fb;
  font-synthesis: none;
  --brand: #2563eb;
  --brand-soft: color-mix(in srgb, var(--brand) 10%, white);
  --border: #e3e8f1;
  --muted: #67748a;
  --surface: #ffffff;
  --danger: #c0392b;
}

html[data-theme="dark"] {
  color: #e8edf6;
  background: #101521;
  --surface: #171e2c;
  --border: #2a3548;
  --muted: #98a6bb;
  --brand-soft: #1e2a44;
}

@media (prefers-color-scheme: dark) {
  html[data-theme="system"] {
    color: #e8edf6;
    background: #101521;
    --surface: #171e2c;
    --border: #2a3548;
    --muted: #98a6bb;
    --brand-soft: #1e2a44;
  }
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; background: inherit; color: inherit; }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }

.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
}

.sidebar {
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 22px 16px;
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}

.brand { display: flex; align-items: center; gap: 12px; padding: 0 8px 22px; }
.brand strong { display: block; font-size: 14px; }
.brand small { color: var(--muted); }

.brand-mark {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: white;
  background: var(--brand);
  font-weight: 800;
  letter-spacing: -.04em;
}

nav { display: flex; flex-direction: column; gap: 4px; }
nav button {
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  padding: 10px 12px;
  border-radius: 10px;
}
nav button:hover, nav button.active { background: var(--brand-soft); color: var(--brand); }

.nav-label {
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: .12em;
  font-size: 10px;
  font-weight: 700;
  padding: 18px 12px 6px;
}

.sidebar-footer {
  margin-top: auto;
  display: grid;
  gap: 10px;
  color: var(--muted);
  padding: 10px 8px;
}

.content { padding: 36px; min-width: 0; }

.page-header {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
}
.page-header h1 { margin: 4px 0 6px; font-size: 30px; letter-spacing: -.03em; }
.page-header p { margin: 0; color: var(--muted); }

.eyebrow {
  color: var(--brand);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .14em;
}

.button {
  border: 1px solid var(--border);
  background: var(--surface);
  color: inherit;
  padding: 9px 13px;
  border-radius: 9px;
  font-weight: 650;
}
.button:hover { transform: translateY(-1px); }
.button:disabled { opacity: .45; cursor: not-allowed; transform: none; }
.button-primary { background: var(--brand); color: #fff; border-color: var(--brand); }

.resource-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.resource-card {
  text-align: left;
  border: 1px solid var(--border);
  background: var(--surface);
  color: inherit;
  border-radius: 16px;
  padding: 20px;
  display: grid;
  gap: 8px;
  box-shadow: 0 6px 22px rgba(15, 23, 42, .04);
}
.resource-card:hover { border-color: var(--brand); transform: translateY(-2px); }
.resource-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--brand-soft);
  color: var(--brand);
  font-weight: 800;
}
.resource-card small { color: var(--muted); }

.filters {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
}

.filter { display: grid; gap: 5px; min-width: 150px; flex: 1 1 160px; }
.filter label, .field label { font-size: 12px; font-weight: 700; color: var(--muted); }

.filter input, .filter select,
.field input, .field select, .field textarea,
.auth-card textarea {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--surface);
  color: inherit;
  border-radius: 9px;
  padding: 9px 10px;
  outline: none;
}

.filter input:focus, .filter select:focus,
.field input:focus, .field select:focus, .field textarea:focus,
.auth-card textarea:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.filter-actions { display: flex; gap: 8px; }

.table-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 6px 22px rgba(15, 23, 42, .04);
}

.table-scroll { overflow: auto; }
table { width: 100%; border-collapse: collapse; min-width: 720px; }
th, td {
  text-align: left;
  padding: 13px 15px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
th {
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  background: color-mix(in srgb, var(--surface) 95%, var(--brand) 5%);
}
tbody tr:hover { background: var(--brand-soft); }

.actions-column { width: 1%; white-space: nowrap; }
.row-actions { white-space: nowrap; display: flex; gap: 10px; align-items: center; }
.row-actions button { border: 0; background: transparent; color: var(--brand); padding: 2px 0; }
.row-actions .danger-link { color: var(--danger); }

.pagination {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
}

.empty { padding: 28px; text-align: center; color: var(--muted); }

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, .52);
  display: grid;
  place-items: center;
  padding: 20px;
  z-index: 50;
}

.modal {
  width: min(720px, 100%);
  max-height: 90vh;
  overflow: auto;
  background: var(--surface);
  border-radius: 18px;
  box-shadow: 0 28px 80px rgba(0, 0, 0, .28);
  padding: 22px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: start;
  margin-bottom: 18px;
}
.modal-header h2 { margin: 4px 0 0; }

.icon-button {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 28px;
  line-height: 1;
}

.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; }
.field { display: grid; gap: 6px; margin-bottom: 14px; }
.field textarea { resize: vertical; }
.field small { color: var(--muted); }
.field-error input, .field-error select, .field-error textarea { border-color: var(--danger); }
.error-text { color: var(--danger) !important; }

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  padding-top: 8px;
}

.toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 80;
  background: #172033;
  color: white;
  padding: 13px 15px;
  border-radius: 12px;
  display: flex;
  gap: 18px;
  align-items: center;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .25);
  max-width: 440px;
}
.toast-error { background: #8f2d24; }
.toast button { border: 0; background: transparent; color: white; font-size: 20px; }

.auth-screen { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
.auth-card {
  width: min(480px, 100%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 28px;
  display: grid;
  gap: 16px;
  box-shadow: 0 18px 60px rgba(15, 23, 42, .08);
}
.auth-card h1 { margin: 0; }
.auth-card p { color: var(--muted); margin: 0; }

@media (max-width: 860px) {
  .app-shell { grid-template-columns: 1fr; }
  .sidebar {
    position: static;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  nav { flex-direction: row; flex-wrap: wrap; }
  .nav-label { width: 100%; }
  .sidebar-footer { display: none; }
  .content { padding: 22px 16px; }
  .form-grid { grid-template-columns: 1fr; }
  .page-header { flex-direction: column; }
}
