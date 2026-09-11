# AGENTS.md

This file is for AI agents working on this repo. It documents the HelpPeople website
(the app being modified), the userscript in this repo, the reasoning behind key
decisions, and how to connect a browser for automated work.

## Repo contents

- `helppeople.user.js` — a Tampermonkey/Violentmonkey userscript ("HelpPeople Mejoras")
  that tweaks the HelpPeople helpdesk web app.
- `.playwright-mcp/` — screenshots/snapshots left behind by the Playwright MCP (ignore).

## The HelpPeople website

### Access & routing

- Base URL: `https://univalleapp.helppeoplecloud.com/container/`
- It is a **React SPA** built with **Ant Design (antd)** and **React Router with hash routing**.
- Routes:
  - `#/modulePage` — the home/module landing page.
  - `#/helppeople/helpdesk` — the helpdesk (where all the work happens).
  - `#/reports` — reports.
- Logged-in user session persists via `localStorage` (`token`, `tokenMulti`, `userInfo`, `actualRoute`).

### The helpdesk page

The helpdesk has two top-level **modules**, toggled by buttons (NOT routes, and NOT in the URL):

- `Dashboard` — KPI cards.
- `Solicitudes` — the ticket list/workspace.

Within `Solicitudes` there is more in-memory state (also not in the URL):

- **View toggle**: "Vista grilla" (grid/table), "Vista detallada", "Vista órdenes de trabajo".
  The default is grilla; opening a ticket and going back resets the view to grilla.
- **Search field selector**: "Por código" or "Por asunto". The app defaults to "Por asunto"
  and **resets to it after filter operations**.
- **Search box**: "Buscar solicitud...". Searching by code with "Por código" selected filters
  the table to exactly one row.
- **Advanced filters**: a collapsible side panel (`.request-filter-panel`) with many fields
  (Estado, Prioridad, Período, etc.), an "Aplicar" button, and a "clear" icon button
  (`[aria-label="clear"]`). Active filters show a count badge on the filter button.
- **Table**: rows are `tr.ant-table-row[data-row-key="<code>"]`; clicking a row (or the code
  link `<a>`) opens the ticket detail.

### Ticket detail

Opening a ticket shows a detail view with:

- `h3` text like `Detalle de solicitud #39532` → the ticket code.
- The subject is an `h2` starting with `[` (e.g. `[REQ35079] ...`).
- The **priority** is a `span.text-xs.font-medium` with a colored dot
  (`.w-2.h-2.rounded-sm`), located inside the same `flex` container as the
  `span.ant-tag[title="Estado de la Solicitud"]` tag.
- Tabs: "Órdenes de trabajo", "Notas", "Adjuntos", etc.
- The back arrow is `.anticon-arrow-left`.
- The app's own "tabs" for opened tickets appear at the top of the list view; they are
  React-only state (lost on reload) — this is why the userscript has its own todo widget.

### Orden de trabajo (OT)

- OTs live under the ticket's "Órdenes de trabajo" tab; clicking an OT row opens a
  **drawer** (`.ant-drawer`).
- The "Descripción" is a `.rich-text-content` div that is normally capped at
  `max-height: 120px` (the userscript removes this cap via the `tallerDescription` toggle).

## The userscript

### Install & updates

- Runs under Violentmonkey (extension id `jinjaccalgkegednnccohejagnlnfdag`). Requires the
  extension's **"Allow User Scripts"** toggle enabled in `chrome://extensions`.
- `@match https://univalleapp.helppeoplecloud.com/*`, `@run-at document-idle`, `@grant none`.
- **`@grant none` is important**: the script runs in the page's main world, so it can read
  the app's `localStorage`, query the DOM, and dispatch real events (which React responds to).

### Feature toggles (top of the file, `CONFIG`)

- `persistModule` — remembers Dashboard vs Solicitudes across reloads (`hp_ui_state.module`).
- `defaultSearchByCode` — sets the search field selector to "Por código".
- `persistView` — remembers grilla/detallada/órdenes (`hp_ui_state.view`) and re-applies it
  when the app resets the view to grilla.
- `todoWidget` — the floating todo-list widget.
- `tallerDescription` — removes the OT "Descripción" height cap.
- `backupTodo` — mirrors the `hp_*` keys to IndexedDB and restores them if `localStorage` is wiped.

### localStorage keys owned by the userscript

- `hp_ui_state` — `{ module, view }`.
- `hp_todo` — array of `{ code, subject, priority:{label,color}, tags:[tagName...], tab:<tabId> }`.
- `hp_tags` — array of `{ name, color }` (the tag registry).
- `hp_todo_tabs` — array of `{ id, name }` (the tab list; the first entry is the fallback tab).
- `hp_todo_tab_active` — the id of the currently selected tab.
- `hp_todo_width` — the todo panel's saved width (px).

### Backup / restore (IndexedDB)

The HelpPeople app **clears `localStorage` when it closes the session** (e.g. after the login
times out), which would wipe `hp_todo` and friends. The script therefore mirrors all `hp_*` keys
to IndexedDB (db `hp_mejoras`, store `kv`, key `snapshot`), which `localStorage.clear()` does not
touch, and restores any key that is missing on startup (before the widget is set up). Backups are
debounced after each `save()` and also run periodically / on `pagehide`. `backupNow()` skips
writing when `hp_todo` is absent, so a transient cleared state (right after logout) can't
overwrite the last good snapshot; a 5s watchdog also restores + re-renders if the app clears the
keys mid-session.

## Key DOM selectors used by the script

| What | Selector |
|---|---|
| Module buttons (Dashboard/Solicitudes) | `button.ant-btn` whose text includes the name; active = has `ant-btn-primary` |
| Search field selector | `.ant-select` matching `/Por (asunto|c[oó]digo)/` |
| Search input | `input[placeholder*="Buscar solicitud"]` |
| View buttons | `span[title="Vista grilla"] button` (also `detallada`, `órdenes de trabajo`); active = `ant-btn-primary` |
| Filter button / badge | `button` containing `[aria-label="filter"]`; badge `.ant-badge-count` |
| Filter clear button | `[aria-label="clear"]` (only in DOM when the filter panel is open) |
| Table row | `tr.ant-table-row[data-row-key="<code>"]` |
| Ticket detail heading | `h3` matching `/Detalle de solicitud/` |
| Ticket subject | `h2` matching `/^\[/` |
| Priority | `span.ant-tag[title="Estado de la Solicitud"]` → same container's `span.text-xs.font-medium` + `.w-2.h-2.rounded-sm` |
| Back arrow | `.anticon-arrow-left` |
| OT description | `.ant-drawer .rich-text-content` |
| Sidebar / logo | `nav`; logo `nav img[alt="Logo"]` |

## The todo widget

Floating panel anchored bottom-left (over the sidebar logo). Header has the title, the ticket
count, a minimize button (`#hp-todo-min`, collapses the panel), and a hamburger button
(`#hp-todo-gear`) that opens the options menu. The header-right order is min, gear, count.

- Auto-adds a ticket when its detail view opens (via `MutationObserver` on `h3`).
- The item for the currently open ticket gets a subtle green background
  (`.hp-todo-item.active`), driven by the same observer watching for the `Detalle de solicitud`
  heading (cleared when the detail view closes).
- Removing the open ticket from the list exits the ticket (clicks the app's back arrow).
- Per-item: priority dot+label, tag chips, a tag menu (circle/dot icon), and a remove button.
- Search box filters by code/subject across **all tabs** (the tab bar is hidden while a query is
  present); a numeric query with no match + Enter opens that ticket.
- HTML5 drag-and-drop reordering (live "make space" on `dragover`) with a semi-transparent drag
  image so the landing gap stays visible.
- **Tabs** (`#hp-todo-tabs`): a horizontal bar under the header. The first tab is the fallback.
  - Click a tab to filter the list; drag a list item onto a tab to move it there.
  - Double-click a tab name to rename it; the `+` button (`#hp-tab-add`) adds a tab and
    immediately starts renaming it.
  - Deleting a tab (× on any tab except the first) moves its items to the first tab.
  - New auto-added tickets land in the first tab.
  - Opening a ticket (however it was opened) switches to the tab that contains it, or to the
    first tab when it's a new ticket. This only fires when the open ticket *changes*, so you can
    switch tabs freely afterwards without it snapping back.
- Right-edge resize handle; width persisted in `hp_todo_width`.
- **Options menu** (`#hp-todo-gear` → `#hp-todo-menu`): "Exportar datos" / "Importar datos".
  - Export downloads `helppeople-todo-YYYY-MM-DD.json` containing `{version, exportedAt, todos, tags, tabs}`.
  - Import merges by code (existing tickets get subject/priority/tags updated; new ones appended)
    and registers new tags/tabs without touching existing ones.

## Reasoning behind key decisions

1. **Simulate the UI instead of touching React internals.** Module, view, and "open tickets"
   live only in React's in-memory state — no URL param, no public API, nothing in
   `localStorage`. Reaching into React's fiber tree is fragile (minified internals, breaks on
   app updates), so the script triggers the same DOM events a user would (`.click()`,
   native value setter + `input` event, `Enter` keydown). This is why opening a ticket from
   the todo widget "types" into the search box and clicks the row.

2. **The todo widget exists because the app's own ticket tabs can't be restored.** The app
   keeps a "tab" per opened ticket, but it is ephemeral React state. Recreating it after a
   reload would require search→click→back per ticket (slow, janky). Instead the script keeps
   its own persistent list in `localStorage` and can re-open any item by code.

3. **Open a ticket = search-by-code + click the row.** Since there is no deep link to a
   ticket, `openTicket()` does: ensure we're on the helpdesk route → ensure Solicitudes module
   → ensure grilla view (only grilla has the clickable table) → clear filters → set search
   field to "Por código" → type the code + Enter → wait for the single row → click it.

4. **Clear filters upfront.** Filters can exclude the ticket from the code search. Clearing
   them *before* searching avoids a failed-search delay. The clear is a no-op when no filters
   are active (checks the filter badge first), so it doesn't flash the panel when nothing to clear.

5. **`defaultSearchByCode` is a one-time set per element (WeakSet), not sticky.** The app
   resets the selector to "Por asunto" on filter operations. We wanted "código" as the default
   while still letting the user manually pick "asunto" without it fighting them. Trade-off: after
   a filter operation the field can end up back on "asunto" — accepted.

6. **Waits are short (1s) with retries (up to 10).** The React app renders asynchronously, so
   elements often appear a moment after an action. `waitForRetry(fn)` polls in 1-second chunks
   and retries up to 10 times rather than blocking on one long timeout. The ticket-search loop
   re-triggers the search on each attempt in case the first trigger was missed — but when the
   filters are confirmed clear and the table comes back empty (`tr.ant-table-row` count 0, the
   "Sin datos" state), it stops instead of retrying: the ticket simply doesn't exist.

7. **`stopPropagation()` on the tag menu.** When you click a color swatch or toggle a tag, the
   menu re-renders its own content, which **detaches the clicked element**. A
   `tagMenu.contains(e.target)` check then returns `false` for a detached node, so the menu
   would close on every interaction. `stopPropagation` on the menu prevents the document-level
   "click outside" handler from ever seeing menu clicks (the event path is fixed at dispatch
   time, so even detached elements still propagate through the menu).

8. **Drag-and-drop uses HTML5 DnD with live reordering on `dragover`.** Items are
   `draggable`, and on `dragover` the dragged row is moved with `insertAdjacentElement` so the
   other items visibly shift to make space. This was a deliberate choice: the user preferred
   this behavior over a pointer-based drag implementation.

9. **The FAB looks like the app logo.** The floating button is positioned exactly over the
   sidebar logo (left ~16px, same 40×40 size) and shows the app's own logo image, grabbed
   dynamically at runtime (`updateFabIcon`) so it keeps working if the asset URL changes.

10. **`suppressView` flag.** During `openTicket()` the script may temporarily switch the view
    to grilla. That flag stops the view-persistence logic from saving/restoring the view during
    the programmatic switch, so the user's saved view preference isn't clobbered.

11. **Import uses an attached, hidden `<input type=file>` and defers closing the menu.**
    Chrome cancels a native file dialog if the page hides the element that was clicked
    (`display:none` on the menu) **in the same task** as `input.click()`. So the import input is
    appended to `document.body` (not detached), the options menu stops its clicks from bubbling
    to the document "click outside" handler (`stopPropagation`, same trick as the tag menu), and
    the menu is hidden via `setTimeout(…, 0)` after `input.click()`. Without all three, the
    picker silently fails to open in a real browser (it still looks fine under Playwright's CDP
    file-chooser interception, which is why automated tests can't catch it).

12. **Removing the open ticket goes back first, then deletes.** `removeTodo()` clicks the app's
    back arrow and waits for the detail heading to disappear *before* writing the new list. If
    it deleted first, the `render()` it triggers would fire the todo `MutationObserver` while
    the detail view is still mounted, and `upsertTodo()` would immediately re-add the ticket.

13. **`clearFilters()` is defensive about the async toolbar.** When opening a ticket from
    another ticket's detail view, the Solicitudes toolbar is **unmounted**, then remounts after
    going back — sometimes slower than the app re-applies its filters. `clearFilters()` waits
    for the filter button (`waitForRetry`), gives late-appearing filters a moment to show up,
    retries opening the panel and clicking clear until the badge is actually gone, and is called
    again on each failed search attempt. Note: a successful "Por código" search legitimately
    shows a badge of `1` (the search itself counts as an active filter) — that is not a leftover.

14. **Tabs use a fallback first tab that can't be deleted.** The tab registry's first entry is
    the default. `itemTab()` maps any item with a missing/unknown tab id to the first tab, so
    legacy items (no `tab` field) and items from a deleted tab are never orphaned. New
    auto-added tickets go to the first tab, and opening a ticket switches the active tab to the
    one holding it (or the first tab for a new ticket).

15. **The todo data is backed up to IndexedDB because the app clears `localStorage` on
    logout.** A userscript only has page-origin storage, and the app wipes `localStorage` when
    the session ends. IndexedDB is a different store on the same origin that survives that, so
    the script mirrors the `hp_*` keys there and restores any missing key on startup (the init
    is `async` and awaits the restore before building the UI). `localStorage` stays the working
    store so all reads remain synchronous.

## Gotchas / notes for future agents

- The app renders via React **after** `document-idle`, so elements (sidebar, module buttons,
  search field) may not exist at script startup. The script uses `MutationObserver` and
  `waitForRetry` for this; don't assume elements are present synchronously.
- Filter operations reset the search-field selector to "Por asunto" and can re-render the
  toolbar; re-query selectors after filter actions.
- Navigating with Playwright `goto` to the *same* URL may use bfcache and NOT actually reload
  the page. For a guaranteed fresh load, open a **new tab** (or navigate to a different URL).
- The filter panel `.request-filter-panel` is always in the DOM but collapses to `width:0`
  when closed; its content (including the clear button) is only present/usable when open.
- The todo widget is fixed at the bottom-left; the tag menu is `position:fixed` and opens
  upward from the hamburger button.
- **Custom drag images need a canvas.** Chrome renders a cloned-element `setDragImage` image
  fully opaque (and may not rasterize an off-screen clone at all), so the userscript draws a
  translucent `<canvas>` (`ctx.globalAlpha`) for the dragged item instead.
- **Never verify the file picker via the Playwright MCP alone.** The MCP intercepts file
  choosers at the CDP level, so it reports success even when a real Chrome would suppress the
  native dialog (see decision 11). To truly test import, watch for the actual OS dialog or
  reproduce the "hide in the same task" condition.

## Connecting to the browser (automation)

The environment: Fedora 44 / KDE, user `ni`, Bun at `/home/ni/.bun/bin/bun` (no Node/npm).

### Launch Chromium with remote debugging

```bash
nohup chromium-browser --remote-debugging-port=9222 \
  --user-data-dir="/home/ni/.config/chromium-cdp" >/tmp/opencode/chromium.log 2>&1 &
```

- CDP endpoint: `http://localhost:9222`.
- The `chromium-cdp` profile is a copy of the user's real profile so logins/cookies carry over.
  Modern Chromium refuses `--remote-debugging-port` on the default profile, hence the custom dir.
- Verify: `curl -s http://localhost:9222/json/version`.

### opencode's Playwright MCP

The opencode config at `~/.config/opencode/opencode.jsonc` connects Playwright to that browser:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["/home/ni/.bun/bin/bunx", "@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"],
      "enabled": true
    }
  }
}
```

opencode loads config only at startup — after editing this file, restart opencode.
Browser MCP tools then appear as `playwright_browser_*`.

### Reinstalling/updating the userscript

Violentmonkey installs scripts by navigating to the `.user.js` URL (the MCP blocks `file://`).
Serve the repo over HTTP and open the file:

```bash
nohup python3 -m http.server 8123 --bind 127.0.0.1 \
  --directory /mnt/dev/Github/hp-scripts >/tmp/opencode/http.log 2>&1 &
```

Then navigate the browser to `http://127.0.0.1:8123/helppeople.user.js`, click
Reinstall/Install in Violentmonkey, and reload the helpdesk page. Stop the server afterwards.

### Workflow tips for automated tasks

- The userscript is a good reference for driving the app: it already encapsulates
  searching-by-code, opening tickets, reading priority, etc.
- If you need to test a fresh state, open a new tab rather than relying on `goto` to the same URL.
- The app is sensitive to timing; prefer the same short-wait/retry pattern the script uses.