// ==UserScript==
// @name         HelpPeople Mejoras
// @namespace    helppeople
// @version      1.5
// @description  Extensión de funcionalidades para HelpPeople
// @updateURL    https://raw.githubusercontent.com/nijamaDev/hp-scripts/main/helppeople.user.js
// @downloadURL  https://raw.githubusercontent.com/nijamaDev/hp-scripts/main/helppeople.user.js
// @match        https://univalleapp.helppeoplecloud.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(async function () {
  'use strict';

  // ============================================================
  // CONFIGURACIÓN DE FUNCIONES - Coloca en "false" las funciones a desactivar
  // ============================================================
  const CONFIG = {
    // Recuerda si estabas en Dashboard o Solicitudes al recargar la página
    persistModule: true,

    // Recuerda la vista de Solicitudes (grilla / detallada / órdenes de trabajo)
    persistView: true,

    // Amplía la "Descripción" de una Orden de Trabajo (quita el límite de altura)
    tallerDescription: true,

    // Muestra un widget flotante con la lista de tickets (esquina inferior izquierda)
    todoWidget: true,
  };
  // ============================================================
  // FIN DE LA CONFIGURACIÓN
  // ============================================================

  const KEY_STATE = 'hp_ui_state';
  const KEY_TODO = 'hp_todo';
  const KEY_TAGS = 'hp_tags';
  const KEY_TABS = 'hp_todo_tabs';
  const KEY_TAB_ACTIVE = 'hp_todo_tab_active';
  const TAG_COLORS = ['#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#fa8c16', '#eb2f96'];
  const MODULES = ['Dashboard', 'Solicitudes'];
  const SEARCH_FIELD_CODE = 'Por código';
  const SEARCH_FIELD_SUBJECT = 'Por asunto';
  const VIEWS = [
    { key: 'grilla', title: 'Vista grilla' },
    { key: 'detallada', title: 'Vista detallada' },
    { key: 'ordenes', title: 'Vista órdenes de trabajo' },
  ];

  let suppressView = false;
  let todoRender = null;

  const qa = (sel) => Array.from(document.querySelectorAll(sel));
  const q = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- almacenamiento ----------
  function loadRaw(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      return null;
    }
  }
  function loadObj(key) {
    return loadRaw(key) || {};
  }
  function loadArr(key) {
    return loadRaw(key) || [];
  }
  function save(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
    scheduleBackup();
  }

  // ---------- respaldo en IndexedDB ----------
  // La app borra su localStorage al cerrar sesión, y con él se perderían los
  // tickets. Guardamos una copia en IndexedDB (que no le afecta) y la
  // restauramos al iniciar si las claves no están.
  const BACKUP_KEYS = [KEY_STATE, KEY_TODO, KEY_TAGS, KEY_TABS, KEY_TAB_ACTIVE, 'hp_todo_width', 'hp_todo_height'];
  const BACKUP_DB = 'hp_mejoras';
  const BACKUP_STORE = 'kv';

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(BACKUP_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BACKUP_STORE)) db.createObjectStore(BACKUP_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, val) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(BACKUP_STORE, 'readwrite');
        tx.objectStore(BACKUP_STORE).put(val, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (e) {}
  }
  async function idbGet(key) {
    try {
      const db = await idbOpen();
      const val = await new Promise((resolve, reject) => {
        const tx = db.transaction(BACKUP_STORE, 'readonly');
        const r = tx.objectStore(BACKUP_STORE).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      db.close();
      return val;
    } catch (e) {
      return null;
    }
  }
  let tourActive = false;
  async function saveTourBackup() {
    const snap = {};
    for (const k of BACKUP_KEYS) snap[k] = localStorage.getItem(k);
    await idbSet('tour_backup', snap);
  }
  async function restoreTourBackup() {
    const snap = await idbGet('tour_backup');
    if (!snap) return false;
    for (const k of BACKUP_KEYS) {
      if (snap[k] == null) localStorage.removeItem(k);
      else localStorage.setItem(k, snap[k]);
    }
    await idbSet('tour_backup', null);
    return true;
  }
  async function backupNow() {
    if (!CONFIG.todoWidget || typeof indexedDB === 'undefined' || tourActive) return;
    const todoRaw = localStorage.getItem(KEY_TODO);
    // Si los tickets no están (p. ej. justo tras cerrar sesión), conserva el último respaldo.
    if (todoRaw === null) return;
    // No sobrescribir un respaldo con datos por una lista vacía/transitoria.
    let empty = false;
    try {
      empty = JSON.parse(todoRaw).length === 0;
    } catch (e) {
      empty = true;
    }
    if (empty) {
      const existing = await idbGet('snapshot');
      let existingCount = 0;
      try {
        existingCount = existing && existing[KEY_TODO] ? JSON.parse(existing[KEY_TODO]).length : 0;
      } catch (e) {
        existingCount = 0;
      }
      if (existingCount > 0) return;
    }
    const snap = { savedAt: Date.now() };
    for (const k of BACKUP_KEYS) snap[k] = localStorage.getItem(k);
    idbSet('snapshot', snap);
  }
  let backupTimer = null;
  function scheduleBackup() {
    if (!CONFIG.todoWidget || tourActive) return;
    if (backupTimer) return;
    backupTimer = setTimeout(() => {
      backupTimer = null;
      backupNow();
    }, 800);
  }
  async function restoreBackup(force) {
    if (!CONFIG.todoWidget || typeof indexedDB === 'undefined') return false;
    if (tourActive && !force) return false;
    const snap = await idbGet('snapshot');
    if (!snap) return false;
    if (!force && snap[KEY_TODO] == null) return false;
    let restored = false;
    for (const k of BACKUP_KEYS) {
      if (snap[k] == null) continue;
      if (force || localStorage.getItem(k) === null) {
        localStorage.setItem(k, snap[k]);
        restored = true;
      }
    }
    return restored;
  }

  // ---------- funciones auxiliares del DOM compartidas ----------
  function findModuleButtons() {
    const btns = qa('button.ant-btn');
    const result = {};
    for (const name of MODULES) {
      const btn = btns.find((b) => b.textContent.includes(name));
      if (btn) result[name] = btn;
    }
    return result;
  }
  function activeModule() {
    const map = findModuleButtons();
    for (const name of MODULES) {
      if (map[name] && map[name].classList.contains('ant-btn-primary')) return name;
    }
    return null;
  }
  function viewButtons() {
    const result = {};
    for (const v of VIEWS) {
      const span = q('span[title="' + v.title + '"]');
      if (span) result[v.key] = span.querySelector('button');
    }
    return result;
  }
  function activeView() {
    const map = viewButtons();
    for (const v of VIEWS) {
      if (map[v.key] && map[v.key].classList.contains('ant-btn-primary')) return v.key;
    }
    return null;
  }
  function searchFieldSelect() {
    return qa('.ant-select').find((s) => /Por (asunto|c[oó]digo)/.test(s.textContent));
  }
  function searchInput() {
    return q('input[placeholder*="Buscar solicitud"]');
  }
  function setNativeValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  async function waitFor(fn, timeout, step) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }
  async function waitForRetry(fn, attempts = 10, timeout = 1000, step = 100) {
    for (let i = 0; i < attempts; i++) {
      const v = await waitFor(fn, timeout, step);
      if (v) return v;
    }
    return null;
  }
  async function setSearchField(name) {
    const s = await waitForRetry(searchFieldSelect);
    if (!s) return false;
    if (s.textContent.trim() === name) return true;
    const target = s.querySelector('.ant-select-selector') || s;
    ['mousedown', 'mouseup', 'click'].forEach((t) =>
      target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))
    );
    const opt = await waitForRetry(() => qa('.ant-select-item-option').find((o) => o.textContent.trim() === name));
    if (!opt) return false;
    opt.click();
    return true;
  }
  function isSearchFieldSet(name) {
    const s = searchFieldSelect();
    return !!(s && s.textContent.trim() === name);
  }
  async function searchFor(text) {
    const input = await waitForRetry(searchInput);
    if (!input) return false;
    setNativeValue(input, text);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    return true;
  }
  function isTicketVisible(code) {
    const rows = qa('tr.ant-table-row');
    return rows.length === 1 && rows[0].getAttribute('data-row-key') === code;
  }
  function extractPriority() {
    const estadoTag = q('span.ant-tag[title="Estado de la Solicitud"]');
    if (!estadoTag) return null;
    const container = estadoTag.parentElement;
    if (!container) return null;
    const label = container.querySelector('span.text-xs.font-medium');
    const dot = container.querySelector('.w-2.h-2.rounded-sm');
    return {
      label: label ? label.textContent.trim() : '',
      color: dot ? dot.style.backgroundColor || '' : '',
    };
  }
  async function clearFilters() {
    const findFilterBtn = () => qa('button').find((b) => b.querySelector('[aria-label="filter"]'));
    const findClearBtn = () => qa('.request-filter-panel button').find((b) => b.querySelector('[aria-label="clear"]'));
    const hasBadge = () => {
      const fb = findFilterBtn();
      return !!(fb && fb.parentElement.querySelector('.ant-badge-count'));
    };

    // Espera a que aparezca la barra de herramientas; con cargas lentas (por ejemplo,
    // al salir del detalle de un ticket, donde se desmonta) los filtros pueden aplicarse después.
    if (!findFilterBtn()) {
      if (!(await waitForRetry(findFilterBtn))) return false;
      if (!hasBadge()) await waitFor(hasBadge, 1500, 100);
    }
    if (!hasBadge()) return true;

    // El panel puede no abrirse, o la app puede volver a aplicar los filtros mientras
    // termina de renderizar; reintenta abrir y limpiar hasta que el contador desaparezca.
    let opened = !!findClearBtn();
    for (let attempt = 0; attempt < 6 && hasBadge(); attempt++) {
      let clearBtn = findClearBtn();
      if (!clearBtn) {
        const fb = findFilterBtn();
        if (fb) {
          fb.click();
          opened = true;
        }
        clearBtn = await waitFor(findClearBtn, 1500, 100);
      }
      if (clearBtn) {
        clearBtn.click();
        await sleep(700);
      } else {
        await sleep(200);
      }
    }
    if (opened && findClearBtn()) {
      const fb = findFilterBtn();
      if (fb) fb.click();
    }
    return !hasBadge();
  }
  async function ensureListReady() {
    if (!window.location.hash.includes('helpdesk')) {
      window.location.hash = '#/helppeople/helpdesk';
      await waitForRetry(() => findModuleButtons()['Solicitudes']);
      await sleep(400);
    }
    const detail = qa('h3').find((h) => /Detalle de solicitud/.test(h.textContent));
    if (detail) {
      const back = q('.anticon-arrow-left');
      if (back) back.click();
      await sleep(400);
    }
    if (activeModule() !== 'Solicitudes') {
      const sol = qa('button.ant-btn').find((b) => b.textContent.includes('Solicitudes'));
      if (sol) sol.click();
      await sleep(600);
    }
    const view = activeView();
    if (view && view !== 'grilla') {
      const grilla = viewButtons()['grilla'];
      if (grilla) grilla.click();
      await sleep(400);
    }
  }
  async function searchPlatformBySubject(text) {
    suppressView = true;
    try {
      await ensureListReady();
      await clearFilters();
      await setSearchField(SEARCH_FIELD_SUBJECT);
      await searchFor(text);
    } finally {
      suppressView = false;
    }
  }
  async function openTicket(code) {
    suppressView = true;
    try {
      await ensureListReady();
      let filtersClear = await clearFilters();
      for (let attempt = 0; attempt < 10; attempt++) {
        // Antes de buscar, confirma las condiciones: filtros limpios y "Por código".
        if (!filtersClear) filtersClear = await clearFilters();
        if (!isSearchFieldSet(SEARCH_FIELD_CODE)) await setSearchField(SEARCH_FIELD_CODE);
        const ready = filtersClear && isSearchFieldSet(SEARCH_FIELD_CODE);
        await searchFor(code);
        if (await waitFor(() => isTicketVisible(code), 1500, 100)) break;
        // Con las condiciones confirmadas y la búsqueda aplicada sin resultados, no existe.
        if (ready && qa('tr.ant-table-row').length === 0) break;
        // En caso contrario, puede que falte algo; se revalúa en la próxima vuelta.
        filtersClear = await clearFilters();
      }
      await sleep(300);
      const link = q('tr.ant-table-row[data-row-key="' + code + '"] a');
      const target = link || q('tr.ant-table-row[data-row-key="' + code + '"]');
      if (target) target.click();
    } finally {
      suppressView = false;
    }
  }

  // ---------- característica: recordar módulo ----------
  function setupPersistModule() {
    document.addEventListener(
      'click',
      (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('button.ant-btn') : null;
        if (!btn) return;
        for (const name of MODULES) {
          if (btn.textContent.includes(name)) {
            save(KEY_STATE, Object.assign(loadObj(KEY_STATE), { module: name }));
            return;
          }
        }
      },
      true
    );
  }

  // ---------- característica: recordar vista ----------
  function setupPersistView() {
    document.addEventListener(
      'click',
      (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('button.ant-btn') : null;
        if (!btn) return;
        const span = btn.closest('span[title^="Vista "]');
        if (span) {
          const v = VIEWS.find((x) => x.title === span.getAttribute('title'));
          if (v && !suppressView) save(KEY_STATE, Object.assign(loadObj(KEY_STATE), { view: v.key }));
        }
      },
      true
    );

    let restoring = false;
    const observer = new MutationObserver(() => {
      const saved = loadObj(KEY_STATE).view;
      if (!saved || restoring || suppressView) return;
      const cur = activeView();
      if (cur && cur !== saved) {
        restoring = true;
        const btn = viewButtons()[saved];
        if (btn) btn.click();
        setTimeout(() => {
          restoring = false;
        }, 300);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- característica: descripción de OT más alta ----------
  function setupTallerDescription() {
    const style = document.createElement('style');
    style.textContent = '.ant-drawer .rich-text-content{max-height:none!important;overflow-y:visible!important;}';
    document.head.appendChild(style);
  }

  // ---------- característica: widget de tickets ----------
  function setupTodoWidget() {
    const style = document.createElement('style');
    style.textContent = [
      '#hp-todo-root{position:fixed;left:16px;bottom:15px;z-index:2147483647;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}',
      '#hp-todo-fab{width:40px;height:40px;border-radius:0;border:none;background:transparent;color:#1677ff;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative;padding:0;transition:transform .15s;}',
      '#hp-todo-fab:hover{transform:scale(1.06);}',
      '#hp-todo-fab img{width:40px;height:40px;display:block;}',
      '#hp-todo-badge{position:absolute;top:-5px;right:-5px;background:#f5222d;color:#fff;font-size:11px;font-weight:600;min-width:19px;height:19px;border-radius:10px;display:flex;align-items:center;justify-content:center;padding:0 5px;box-shadow:0 1px 4px rgba(0,0,0,.3);}',
      '#hp-todo-panel{position:absolute;bottom:0;left:64px;width:320px;max-height:440px;background:#fff;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);overflow:hidden;display:flex;flex-direction:column;border:1px solid #e8e8e8;}',
      '#hp-todo-panel.hidden{display:none;}',
      '#hp-todo-header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;font-weight:600;color:#333;border-bottom:1px solid #f0f0f0;background:#fafafa;flex-shrink:0;}',
      '#hp-todo-count{background:#e6f4ff;color:#1677ff;font-size:12px;padding:1px 8px;border-radius:10px;}',
      '#hp-todo-header-right{display:flex;align-items:center;gap:8px;}',
      '#hp-todo-gear,#hp-todo-min{border:none;background:none;color:#999;cursor:pointer;padding:0 4px;line-height:1;display:flex;align-items:center;border-radius:4px;}',
      '#hp-todo-gear:hover,#hp-todo-min:hover{color:#333;background:#e6f4ff;}',
      '#hp-todo-menu{position:fixed;z-index:2147483647;min-width:150px;background:#fff;border:1px solid #e8e8e8;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);padding:6px;display:flex;flex-direction:column;gap:2px;}',
      '#hp-todo-menu.hidden{display:none;}',
      '#hp-todo-menu .m-item{padding:6px 10px;border-radius:4px;cursor:pointer;font-size:13px;color:#333;}',
      '#hp-todo-menu .m-item:hover{background:#f5f5f5;}',
      '#hp-tour{position:fixed;inset:0;z-index:2147483647;pointer-events:none;}',
      '#hp-tour.hidden{display:none;}',
      '#hp-tour-spotlight{position:fixed;border-radius:8px;box-shadow:0 0 0 9999px rgba(0,0,0,.55);pointer-events:none;transition:top .15s,left .15s,width .15s,height .15s;}',
      '#hp-tour-pop{position:fixed;pointer-events:auto;width:300px;max-width:calc(100vw - 24px);background:#fff;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.35);padding:14px 16px;}',
      '#hp-tour-pop .tour-title{font-weight:700;color:#1677ff;font-size:14px;margin-bottom:4px;padding-right:16px;}',
      '#hp-tour-pop .tour-text{font-size:13px;color:#444;line-height:1.45;}',
      '#hp-tour-pop .tour-hint{font-size:11px;color:#52c41a;margin-top:6px;}',
      '#hp-tour-pop .tour-foot{display:flex;align-items:center;justify-content:space-between;margin-top:12px;}',
      '#hp-tour-pop .tour-count{font-size:12px;color:#999;}',
      '#hp-tour-pop .tour-btns{display:flex;gap:8px;}',
      '#hp-tour-pop .tour-btns button{border:1px solid #d9d9d9;background:#fff;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;color:#333;}',
      '#hp-tour-pop .tour-btns .tour-next{background:#1677ff;border-color:#1677ff;color:#fff;}',
      '#hp-tour-pop .tour-btns .tour-next.tour-done{background:#52c41a;border-color:#52c41a;}',
      '#hp-tour-pop .tour-btns .tour-next.tour-loading{position:relative;color:transparent;min-width:64px;cursor:default;}',
      '#hp-tour-pop .tour-btns .tour-next.tour-loading::after{content:"";position:absolute;top:50%;left:50%;width:12px;height:12px;margin:-7px 0 0 -7px;border:2px solid rgba(255,255,255,.5);border-top-color:#fff;border-radius:50%;animation:hp-tour-spin .7s linear infinite;}',
      '@keyframes hp-tour-spin{to{transform:rotate(360deg);}}',
      '#hp-tour-pop .tour-skip{position:absolute;top:8px;right:10px;border:none;background:none;color:#bbb;font-size:16px;cursor:pointer;padding:0 2px;line-height:1;}',
      '#hp-tour-pop .tour-skip:hover{color:#333;}',
      '#hp-todo-tabs{display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid #f0f0f0;background:#fafafa;overflow-x:auto;flex-shrink:0;}',
      '.hp-tab{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;border:1px solid #e8e8e8;background:#fff;cursor:pointer;font-size:12px;color:#555;white-space:nowrap;user-select:none;flex-shrink:0;}',
      '.hp-tab:hover{background:#f5f5f5;}',
      '.hp-tab.active{background:#e6f4ff;border-color:#91caff;color:#1677ff;font-weight:600;}',
      '.hp-tab.drop-target{background:#e8f8ee;border-color:#52c41a;}',
      '.hp-tab-name{max-width:110px;overflow:hidden;text-overflow:ellipsis;}',
      '.hp-tab-count{background:rgba(0,0,0,.06);color:#666;font-size:10px;padding:0 5px;border-radius:8px;}',
      '.hp-tab.active .hp-tab-count{background:rgba(22,119,255,.15);color:#1677ff;}',
      '.hp-tab-del{border:none;background:none;color:#bbb;cursor:pointer;font-size:13px;line-height:1;padding:0 1px;}',
      '.hp-tab-del:hover{color:#f5222d;}',
      '.hp-tab-name-input{width:90px;border:1px solid #1677ff;border-radius:4px;font-size:12px;padding:1px 4px;outline:none;}',
      '#hp-tab-add{border:1px dashed #d9d9d9;background:#fff;color:#999;border-radius:6px;cursor:pointer;font-size:14px;line-height:1;padding:3px 8px;flex-shrink:0;}',
      '#hp-tab-add:hover{color:#1677ff;border-color:#91caff;}',
      '#hp-todo-list{list-style:none;margin:0;padding:6px;overflow-y:auto;flex:1;min-height:0;}',
      '.hp-todo-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;user-select:none;}',
      '.hp-todo-item:hover{background:#f5f5f5;}',
      '.hp-todo-item.active{background:#e8f8ee;}',
      '.hp-todo-item.active:hover{background:#d9f2e3;}',
      '.hp-todo-item.selected{background:#e6f4ff;}',
      '.hp-todo-item.selected:hover{background:#d4e8ff;}',
      '.hp-todo-item.dragging{opacity:0.5;}',
      '.hp-code{font-weight:700;color:#1677ff;flex-shrink:0;font-size:13px;}',
      '.hp-subject{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#444;font-size:13px;}',
      '.hp-priority{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;font-size:11px;color:#666;}',
      '.hp-priority-dot{width:8px;height:8px;border-radius:2px;display:inline-block;flex-shrink:0;}',
      '.hp-todo-close{border:none;background:none;color:#999;font-size:16px;cursor:pointer;padding:0 4px;line-height:1;}',
      '.hp-todo-close:hover{color:#f5222d;}',
      '.hp-todo-menu{border:none;background:none;color:#999;cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0;}',
      '.hp-todo-menu:hover{color:#333;}',
      '.hp-tags{display:inline-flex;gap:4px;flex-shrink:0;max-width:120px;overflow:hidden;}',
      '.hp-tag-chip{font-size:11px;padding:1px 7px;border-radius:10px;white-space:nowrap;line-height:1.5;}',
      '#hp-tag-menu{position:fixed;z-index:2147483647;width:210px;background:#fff;border:1px solid #e8e8e8;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);padding:6px;display:flex;flex-direction:column;gap:2px;}',
      '#hp-tag-menu.hidden{display:none;}',
      '#hp-tag-menu .m-title{font-weight:600;font-size:12px;color:#333;padding:4px 6px;}',
      '#hp-tag-menu .m-tag{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:12px;color:#333;}',
      '#hp-tag-menu .m-tag:hover{background:#f5f5f5;}',
      '#hp-tag-menu .m-tag .m-chip{font-size:11px;padding:1px 7px;border-radius:10px;white-space:nowrap;flex:1;text-align:left;}',
      '#hp-tag-menu .m-check{color:#1677ff;flex-shrink:0;font-weight:700;}',
      '#hp-tag-menu .m-del{margin-left:auto;color:#999;cursor:pointer;font-size:14px;padding:0 4px;line-height:1;}',
      '#hp-tag-menu .m-del:hover{color:#f5222d;}',
      '#hp-tag-menu .m-edit{color:#999;cursor:pointer;font-size:12px;padding:0 4px;line-height:1;}',
      '#hp-tag-menu .m-edit:hover{color:#1677ff;}',
      '.m-edit-colors{display:flex;flex-wrap:wrap;gap:4px;padding:2px 6px 6px 6px;}',
      '#hp-tag-menu .m-new{color:#1677ff;padding:4px 6px;cursor:pointer;font-size:12px;border-top:1px solid #f0f0f0;margin-top:2px;border-radius:4px;}',
      '#hp-tag-menu .m-new:hover{background:#f5f5f5;}',
      '#hp-tag-form{padding:6px;display:flex;flex-direction:column;gap:6px;border-top:1px solid #f0f0f0;margin-top:2px;}',
      '#hp-tag-form.hidden{display:none;}',
      '#hp-tag-form input{width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #d9d9d9;border-radius:4px;font-size:12px;outline:none;}',
      '#hp-tag-colors{display:flex;flex-wrap:wrap;gap:4px;}',
      '.hp-color-swatch{width:20px;height:20px;border-radius:50%;cursor:pointer;border:2px solid transparent;box-sizing:border-box;}',
      '.hp-color-swatch.selected{border-color:#333;}',
      '#hp-tag-form .m-actions{display:flex;gap:6px;justify-content:flex-end;}',
      '#hp-tag-form .m-actions button{border:1px solid #d9d9d9;background:#fff;border-radius:4px;padding:3px 10px;font-size:12px;cursor:pointer;}',
      '#hp-tag-form .m-actions .m-save{background:#1677ff;color:#fff;border-color:#1677ff;}',
      '#hp-todo-hint{padding:8px 14px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;flex-shrink:0;}',
      '#hp-todo-footer{padding:8px;border-top:1px solid #f0f0f0;flex-shrink:0;}',
      '#hp-todo-search{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;outline:none;}',
      '#hp-todo-search:focus{border-color:#1677ff;}',
      '.hp-resize-handle{position:absolute;top:0;right:0;bottom:0;width:6px;cursor:ew-resize;}',
      '.hp-resize-handle:hover{background:rgba(22,119,255,0.15);}',
      '.hp-resize-handle-top{position:absolute;top:0;left:0;right:6px;height:6px;cursor:ns-resize;}',
      '.hp-resize-handle-top:hover{background:rgba(22,119,255,0.15);}',
    ].join('\n');
    document.head.appendChild(style);

    let logoSrc = '';
    const navEl = q('nav');
    const logoImg = navEl
      ? [...navEl.querySelectorAll('img')].find((im) => (im.getAttribute('alt') || '').toLowerCase().includes('logo') || (im.getAttribute('src') || '').toLowerCase().includes('logo'))
      : null;
    if (logoImg) logoSrc = logoImg.getAttribute('src');
    const fabIcon = logoSrc
      ? '<img src="' + logoSrc + '" alt="Tickets">'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>';

    const root = document.createElement('div');
    root.id = 'hp-todo-root';
    root.innerHTML =
      '<div id="hp-todo-panel">' +
      '<div id="hp-todo-header"><span>Tickets</span><span id="hp-todo-header-right"><button id="hp-todo-min" title="Minimizar"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M5 11h14v2H5z"/></svg></button><button id="hp-todo-gear" title="Opciones"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg></button><span id="hp-todo-count">0</span></span></div>' +
      '<div id="hp-todo-tabs"></div>' +
      '<ul id="hp-todo-list"></ul>' +
      '<div id="hp-todo-hint" class="hidden"></div>' +
      '<div id="hp-todo-footer"><input id="hp-todo-search" type="text" placeholder="Buscar código o asunto..."></div>' +
      '<div class="hp-resize-handle-top"></div>' +
      '<div class="hp-resize-handle"></div>' +
      '</div>' +
      '<button id="hp-todo-fab" title="Tickets">' +
      fabIcon +
      '<span id="hp-todo-badge" class="hidden">0</span>' +
      '</button>' +
      '<div id="hp-tag-menu" class="hidden">' +
      '<div class="m-title">Etiquetas</div>' +
      '<div id="hp-tag-menu-list"></div>' +
      '<div class="m-new" id="hp-tag-new-btn">+ Nueva etiqueta</div>' +
      '<div id="hp-tag-form" class="hidden">' +
      '<input id="hp-tag-name" type="text" placeholder="Nombre de la etiqueta...">' +
      '<div id="hp-tag-colors"></div>' +
      '<div class="m-actions"><button id="hp-tag-cancel">Cancelar</button><button class="m-save" id="hp-tag-save">Guardar</button></div>' +
      '</div>' +
      '</div>' +
      '<div id="hp-todo-menu" class="hidden">' +
      '<div class="m-item" id="hp-export-btn">Exportar datos</div>' +
      '<div class="m-item" id="hp-import-btn">Importar datos</div>' +
      '<div class="m-item" id="hp-tutorial-btn">Tutorial</div>' +
      '</div>' +
      '<div id="hp-tour" class="hidden">' +
      '<div id="hp-tour-spotlight"></div>' +
      '<div id="hp-tour-pop">' +
      '<button class="tour-skip" id="hp-tour-skip" title="Cerrar">&times;</button>' +
      '<div class="tour-title"></div>' +
      '<div class="tour-text"></div>' +
      '<div class="tour-hint"></div>' +
      '<div class="tour-foot"><span class="tour-count"></span><span class="tour-btns"><button id="hp-tour-prev">Anterior</button><button class="tour-next" id="hp-tour-next">Siguiente</button></span></div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(root);

    q('#hp-todo-fab').addEventListener('click', () => {
      q('#hp-todo-panel').classList.toggle('hidden');
    });
    q('#hp-todo-min').addEventListener('click', () => {
      q('#hp-todo-panel').classList.add('hidden');
    });

    // ---- menú de opciones (exportar / importar) ----
    const todoMenu = q('#hp-todo-menu');
    const gearBtn = q('#hp-todo-gear');
    todoMenu.addEventListener('click', (e) => e.stopPropagation());
    function positionTodoMenu() {
      const r = gearBtn.getBoundingClientRect();
      todoMenu.style.top = r.bottom + 4 + 'px';
      todoMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 170)) + 'px';
    }
    gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (todoMenu.classList.contains('hidden')) {
        positionTodoMenu();
        todoMenu.classList.remove('hidden');
      } else {
        todoMenu.classList.add('hidden');
      }
    });
    document.addEventListener('click', (e) => {
      if (todoMenu.classList.contains('hidden')) return;
      if (e.target.closest('#hp-todo-gear')) return;
      todoMenu.classList.add('hidden');
    });

    function exportTodoData() {
      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        todos: loadArr(KEY_TODO),
        tags: loadTags(),
        tabs: loadTabs(),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'helppeople-todo-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      todoMenu.classList.add('hidden');
    }
    function importTodoFile() {
      document.querySelectorAll('body > input[type=file]').forEach((el) => el.remove());
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            const imported = data && data.todos ? data.todos : [];
            const tagList = data && data.tags ? data.tags : [];
            const tabList = data && data.tabs ? data.tabs : [];
            if (!imported.length && !tagList.length && !tabList.length) {
              alert('El archivo no contiene datos de la lista de tickets.');
              return;
            }
            const tags = loadTags();
            for (const t of tagList) {
              if (t && t.name && !tags.find((x) => x.name === t.name)) {
                tags.push({ name: t.name, color: t.color || '#1677ff' });
              }
            }
            saveTags(tags);
            const tabs = loadTabs();
            for (const tb of tabList) {
              if (tb && tb.id && tb.name && !tabs.find((x) => x.id === tb.id)) {
                tabs.push({ id: tb.id, name: tb.name });
              }
            }
            saveTabs(tabs);
            const list = loadArr(KEY_TODO);
            for (const t of imported) {
              if (!t || !t.code) continue;
              const clean = {
                code: String(t.code),
                subject: t.subject || '',
                priority: t.priority && t.priority.label ? { label: t.priority.label, color: t.priority.color || '' } : null,
                tags: Array.isArray(t.tags) ? t.tags : [],
                tab: t.tab && tabs.find((x) => x.id === t.tab) ? t.tab : tabs[0].id,
              };
              const existing = list.find((x) => x.code === clean.code);
              if (existing) {
                if (clean.subject) existing.subject = clean.subject;
                if (clean.priority) existing.priority = clean.priority;
                if (clean.tags.length) existing.tags = clean.tags;
                existing.tab = clean.tab;
              } else {
                list.push(clean);
              }
            }
            save(KEY_TODO, list);
            render();
            alert('Se importaron ' + imported.length + ' ticket(s).');
          } catch (err) {
            alert('No se pudo importar el archivo: ' + err.message);
          }
        };
        reader.readAsText(file);
      });
      input.addEventListener('cancel', () => input.remove());
      document.body.appendChild(input);
      input.click();
      setTimeout(() => todoMenu.classList.add('hidden'), 0);
    }
    q('#hp-export-btn').addEventListener('click', exportTodoData);
    q('#hp-import-btn').addEventListener('click', importTodoFile);

    // ---- tutorial (tour guiado y práctico) ----
    const tourEl = q('#hp-tour');
    const tourSpot = q('#hp-tour-spotlight');
    const tourPop = q('#hp-tour-pop');
    const tourPrev = q('#hp-tour-prev');
    const tourNext = q('#hp-tour-next');
    let tourSteps = [];
    let tourIndex = 0;
    let tourPoll = null;
    let tourBusy = false;
    let tourSnaps = [];

    function stopTourPoll() {
      if (tourPoll) {
        clearInterval(tourPoll);
        tourPoll = null;
      }
    }
    // Mientras el paso se completa o se está auto-ejecutando, el botón queda
    // deshabilitado y con un spinner (para que no se haga click de más).
    function setTourNextBusy(busy, done) {
      tourNext.disabled = !!busy;
      tourNext.classList.toggle('tour-done', !!done);
      tourNext.classList.toggle('tour-loading', !!busy);
      tourNext.textContent = busy ? '' : tourNextLabel();
    }
    function startTourPoll(i) {
      stopTourPoll();
      const step = tourSteps[i];
      if (!step || typeof step.done !== 'function') return;
      let alreadyDone = false;
      try {
        alreadyDone = !!step.done();
      } catch (e) {
        alreadyDone = false;
      }
      // Si el paso ya está cumplido (p. ej. al volver con "Anterior"), no
      // auto-avanzar: dejamos que el usuario siga cuando quiera.
      if (alreadyDone) return;
      tourPoll = setInterval(() => {
        if (tourIndex !== i) return;
        try {
          updateSpotlight(step);
        } catch (e) {}
        let ok = false;
        try {
          ok = step.done();
        } catch (e) {
          ok = false;
        }
        if (!ok) return;
        stopTourPoll();
        setTourNextBusy(true, true);
        setTimeout(() => {
          if (tourIndex === i) advanceTour(1);
        }, 900);
      }, 400);
    }
    // Abre un ticket real de la tabla (sale del detalle si hace falta y evita
    // los códigos indicados en `skip`). Devuelve el código abierto o null.
    async function autoOpenTicket(skip) {
      const omit = Array.isArray(skip) ? skip : [];
      const inDetail = () => qa('h3').some((h) => /Detalle de solicitud/.test(h.textContent));
      if (inDetail()) {
        const back = q('.anticon-arrow-left');
        if (back) back.click();
        await sleep(1200);
      }
      try {
        await clearFilters();
      } catch (e) {}
      let code = null;
      for (let attempt = 0; attempt < 4 && !inDetail(); attempt++) {
        await waitFor(() => qa('tr.ant-table-row').length > 0, 3000, 150);
        const rows = qa('tr.ant-table-row');
        let row = rows.find((r) => !omit.includes(r.dataset.rowKey));
        if (!row) row = rows[0];
        if (!row) {
          await sleep(500);
          continue;
        }
        code = row.dataset.rowKey;
        row.click();
        await waitFor(() => inDetail(), 3000, 150);
        if (!inDetail()) await sleep(400);
      }
      if (code) await waitFor(() => loadArr(KEY_TODO).some((t) => t.code === code), 4000, 150);
      return code;
    }
    // Vuelve atrás si hace falta y abre un segundo ticket buscándolo por su
    // número (usa el flujo real de búsqueda por código).
    async function autoOpenSecond() {
      const inDetail = () => qa('h3').some((h) => /Detalle de solicitud/.test(h.textContent));
      if (inDetail()) {
        const back = q('.anticon-arrow-left');
        if (back) back.click();
        await sleep(1200);
      }
      try {
        await clearFilters();
      } catch (e) {}
      if (!(await waitFor(() => qa('tr.ant-table-row').length > 0, 5000, 200))) return;
      const skip = loadArr(KEY_TODO).map((t) => t.code);
      const row = qa('tr.ant-table-row').find((r) => !skip.includes(r.dataset.rowKey));
      const code = row ? row.dataset.rowKey : null;
      if (code) {
        await openTicket(code);
        await waitFor(() => loadArr(KEY_TODO).some((t) => t.code === code), 5000, 150);
      }
    }
    async function enterTourMode() {
      // Asegura el respaldo principal con los datos reales antes de limpiar.
      await backupNow();
      tourActive = true;
      await saveTourBackup();
      // Lista limpia para practicar (se restaura al salir).
      localStorage.setItem(KEY_TODO, JSON.stringify([]));
      localStorage.setItem(KEY_TAGS, JSON.stringify([]));
      localStorage.setItem(KEY_TABS, JSON.stringify([{ id: 'tab-default', name: 'General' }]));
      localStorage.setItem(KEY_TAB_ACTIVE, 'tab-default');
      selectedCodes.clear();
      selAnchor = null;
      activeTabId = 'tab-default';
      closeTagMenu();
      const si = q('#hp-todo-search');
      if (si) si.value = '';
      render();
    }
    async function exitTourMode() {
      stopTourPoll();
      // Cerrar el detalle ANTES de restaurar, para que el observer no vuelva a
      // agregar el ticket abierto a la lista restaurada.
      const h3 = qa('h3').find((h) => /Detalle de solicitud/.test(h.textContent));
      if (h3) {
        const back = q('.anticon-arrow-left');
        if (back) back.click();
        await sleep(700);
      }
      let restored = await restoreTourBackup();
      // Sin respaldo del tour: recupera al menos el respaldo principal.
      if (!restored) restored = await restoreBackup(true);
      tourActive = false;
      selectedCodes.clear();
      selAnchor = null;
      activeTabId = localStorage.getItem(KEY_TAB_ACTIVE) || loadTabs()[0].id;
      panelWidth = parseInt(localStorage.getItem('hp_todo_width'), 10) || 320;
      applyPanelWidth();
      panelHeight = parseInt(localStorage.getItem('hp_todo_height'), 10) || 0;
      applyPanelHeight();
      closeTagMenu();
      const si = q('#hp-todo-search');
      if (si) si.value = '';
      render();
      if (restored) backupNow();
    }

    const TOUR_STEPS = [
      {
        target: '#hp-todo-panel',
        title: '¡Hola! 👋',
        text: 'Te voy a guiar para que pruebes las funciones con una lista limpia. No te preocupes: al cerrar el tutorial restauro tu lista original. Empecemos.',
      },
      {
        target: () => q('tr.ant-table-row') || q('#hp-todo-list'),
        placement: 'right',
        title: 'Abre un ticket',
        text: 'Haz click en una fila de la tabla (o usa el buscador) para abrir un ticket. Se agregará solo a esta lista.',
        hint: 'Cuando lo abras, avanzaré solo. Si no, haz click en «Siguiente» y lo abro por ti.',
        done: () => loadArr(KEY_TODO).length >= 1,
        auto: () => autoOpenTicket([]),
      },
      {
        target: () => {
          const opened = loadArr(KEY_TODO).map((t) => t.code);
          const rows = qa('tr.ant-table-row');
          const row = rows.find((r) => !opened.includes(r.dataset.rowKey));
          return row || rows[0] || q('#hp-todo-list');
        },
        placement: 'right',
        title: 'Abre un segundo ticket',
        text: 'Te devolví a la lista y limpié los filtros. Abre otro ticket distinto; si prefieres, haz click en «Siguiente» y lo abro por ti buscando su número.',
        hint: 'Cuando tengas dos, avanzaré solo.',
        show: async () => {
          const inDetail = () => qa('h3').some((h) => /Detalle de solicitud/.test(h.textContent));
          if (inDetail()) {
            const back = q('.anticon-arrow-left');
            if (back) back.click();
            await sleep(1100);
          }
          try {
            await clearFilters();
          } catch (e) {}
        },
        done: () => loadArr(KEY_TODO).length >= 2,
        auto: () => autoOpenSecond(),
      },
      {
        target: '#hp-tab-add',
        placement: 'top',
        title: 'Crea una pestaña',
        text: 'Haz click en el + y escribe un nombre (Enter). Las pestañas sirven para organizar.',
        hint: 'Cuando la crees, avanzaré solo. Si no, haz click en «Siguiente» y la creo por ti.',
        done: () => loadTabs().length >= 2,
        auto: async () => {
          addTab();
          await sleep(250);
          const inp = q('.hp-tab-name-input');
          if (inp) {
            inp.value = 'Práctica';
            inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          }
          await sleep(300);
        },
      },
      {
        target: '#hp-todo-panel',
        placement: 'top',
        title: 'Muévelos a tu pestaña',
        text: 'Te dejo en la pestaña General. Arrastra los tickets (resaltados) hasta tu pestaña nueva. Puedes seleccionar varios con Ctrl/Cmd+click o un rango con Shift+click y arrastrarlos juntos.',
        hint: 'Cuando muevas al menos uno, avanzaré solo. Si no, haz click en «Siguiente» y los muevo por ti.',
        show: () => {
          const tabs = loadTabs();
          if (tabs[0] && activeTabId !== tabs[0].id) {
            activeTabId = tabs[0].id;
            localStorage.setItem(KEY_TAB_ACTIVE, activeTabId);
            render();
          }
        },
        done: () => {
          const tabs = loadTabs();
          return tabs.length >= 2 && loadArr(KEY_TODO).some((t) => itemTab(t) === tabs[1].id);
        },
        auto: async () => {
          const tabs = loadTabs();
          if (tabs.length < 2) return;
          const codes = loadArr(KEY_TODO).map((t) => t.code);
          if (codes.length) assignToTab(codes, tabs[1].id);
          await sleep(300);
        },
      },
      {
        target: () => {
          const menu = q('#hp-tag-menu');
          if (menu && !menu.classList.contains('hidden')) return menu;
          return q('#hp-todo-list li.hp-todo-item .hp-todo-menu');
        },
        title: 'Etiqueta los tickets',
        text: 'Pulsa el círculo de un ticket para abrir sus etiquetas. Ahí puedes crear una nueva (nombre + color) y asignarla; es útil para clasificar.',
        hint: 'Cuando un ticket tenga etiqueta, avanzaré solo. Si no, haz click en «Siguiente» y la creo por ti.',
        done: () => loadArr(KEY_TODO).some((t) => (t.tags || []).length > 0),
        auto: async () => {
          const list = loadArr(KEY_TODO);
          if (!list.length) return;
          const code = list[0].code;
          const li = q('#hp-todo-list li.hp-todo-item');
          const btn = li ? li.querySelector('.hp-todo-menu') : null;
          openTagMenu(code, btn);
          await sleep(250);
          const nb = q('#hp-tag-new-btn');
          if (nb) nb.click();
          await sleep(250);
          if (tagNameInput) {
            tagNameInput.value = 'Ejemplo';
            const save = q('#hp-tag-save');
            if (save) save.click();
          }
          await sleep(250);
          // Garantiza que la etiqueta quede creada y asignada al ticket.
          const tags = loadTags();
          if (!tags.find((t) => t.name === 'Ejemplo')) {
            saveTags(tags.concat([{ name: 'Ejemplo', color: tagDraftColor || '#1677ff' }]));
          }
          const list2 = loadArr(KEY_TODO);
          const item = list2.find((t) => t.code === code);
          if (item) {
            item.tags = item.tags || [];
            if (!item.tags.includes('Ejemplo')) {
              item.tags.push('Ejemplo');
              save(KEY_TODO, list2);
              render();
            }
          }
          closeTagMenu();
          await sleep(300);
        },
      },
      {
        target: '#hp-todo-list li.hp-todo-item .hp-todo-close',
        title: 'Quita los tickets',
        text: 'Cuando termines, quita los tickets con la × de cada uno (si está abierto, también saldrá del ticket).',
        hint: 'Cuando la lista quede vacía, avanzaré solo. Si no, haz click en «Siguiente» y los quito por ti.',
        done: () => loadArr(KEY_TODO).length === 0,
        auto: async () => {
          let guard = 0;
          while (loadArr(KEY_TODO).length && guard < 20) {
            guard += 1;
            await removeTodo(loadArr(KEY_TODO)[0].code);
            await sleep(200);
          }
        },
      },
      {
        target: '#hp-todo-fab',
        title: '¡Listo!',
        text: 'Muy bien. Al cerrar este tutorial restauro tu lista original tal como estaba. También puedes exportarla o importarla desde el menú ☰.',
      },
    ];

    function resolveTarget(step) {
      if (!step || !step.target) return null;
      return typeof step.target === 'function' ? step.target() : q(step.target);
    }
    function tourNextLabel() {
      return tourIndex >= tourSteps.length - 1 ? 'Terminar' : 'Siguiente';
    }
    function updateSpotlight(step) {
      const el = resolveTarget(step);
      const r = el ? el.getBoundingClientRect() : null;
      const pad = 5;
      if (r) {
        tourSpot.style.top = r.top - pad + 'px';
        tourSpot.style.left = r.left - pad + 'px';
        tourSpot.style.width = r.width + pad * 2 + 'px';
        tourSpot.style.height = r.height + pad * 2 + 'px';
      } else {
        tourSpot.style.top = '-20px';
        tourSpot.style.left = '-20px';
        tourSpot.style.width = '1px';
        tourSpot.style.height = '1px';
      }
    }
    function positionTourStep(step) {
      const el = resolveTarget(step);
      const r = el ? el.getBoundingClientRect() : null;
      const pad = 5;
      updateSpotlight(step);
      tourPop.querySelector('.tour-title').textContent = step.title;
      tourPop.querySelector('.tour-text').textContent = step.text;
      tourPop.querySelector('.tour-hint').textContent = step.hint || '';
      tourPop.querySelector('.tour-count').textContent = tourIndex + 1 + ' / ' + tourSteps.length;
      tourPrev.style.visibility = tourIndex === 0 ? 'hidden' : 'visible';
      tourNext.classList.remove('tour-done');
      tourNext.classList.remove('tour-loading');
      tourNext.disabled = false;
      tourNext.textContent = tourNextLabel();
      tourPop.style.visibility = 'hidden';
      const pw = tourPop.offsetWidth;
      const ph = tourPop.offsetHeight;
      let top;
      let left;
      if (r) {
        const place = step.placement || 'bottom';
        if (place === 'top') {
          top = r.top - ph - 10;
          if (top < 8) top = Math.min(Math.max(8, window.innerHeight - ph - 8), r.bottom + 10);
          left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - pw - 8));
        } else if (place === 'right') {
          if (r.right + 12 + pw <= window.innerWidth - 8) {
            left = r.right + 12;
            top = Math.min(Math.max(8, r.top), Math.max(8, window.innerHeight - ph - 8));
          } else {
            // No cabe a la derecha (p. ej. una fila ancha): debajo, alineado a la derecha.
            left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8));
            top = r.bottom + 10;
            if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 10);
          }
        } else if (place === 'left') {
          left = r.left - pw - 12;
          if (left < 8) left = Math.min(window.innerWidth - pw - 8, r.right + 12);
          top = Math.min(Math.max(8, r.top), Math.max(8, window.innerHeight - ph - 8));
        } else {
          top = r.bottom + 10;
          if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 10);
          left = Math.min(Math.max(8, r.left - pad), Math.max(8, window.innerWidth - pw - 8));
        }
      } else {
        top = Math.max(8, (window.innerHeight - ph) / 2);
        left = Math.max(8, (window.innerWidth - pw) / 2);
      }
      tourPop.style.top = top + 'px';
      tourPop.style.left = left + 'px';
      tourPop.style.visibility = 'visible';
    }
    // Guarda/restaura el estado del tour para que "Anterior" deshaga los
    // cambios del paso que se deja.
    function captureTourState() {
      return {
        todo: localStorage.getItem(KEY_TODO),
        tags: localStorage.getItem(KEY_TAGS),
        tabs: localStorage.getItem(KEY_TABS),
        active: localStorage.getItem(KEY_TAB_ACTIVE),
      };
    }
    async function restoreTourState(snap) {
      if (!snap) return;
      // Cerrar el detalle abierto para que el observer no re-agregue el ticket.
      const h3 = qa('h3').find((h) => /Detalle de solicitud/.test(h.textContent));
      if (h3) {
        const back = q('.anticon-arrow-left');
        if (back) back.click();
        await sleep(700);
      }
      const set = (k, v) => {
        if (v != null) localStorage.setItem(k, v);
        else localStorage.removeItem(k);
      };
      set(KEY_TODO, snap.todo);
      set(KEY_TAGS, snap.tags);
      set(KEY_TABS, snap.tabs);
      set(KEY_TAB_ACTIVE, snap.active);
      activeTabId = localStorage.getItem(KEY_TAB_ACTIVE) || loadTabs()[0].id;
      selectedCodes.clear();
      selAnchor = null;
      closeTagMenu();
      const si = q('#hp-todo-search');
      if (si) si.value = '';
      render();
    }
    async function showTourStep(i, capture) {
      const step = tourSteps[i];
      if (!step) return endTour();
      stopTourPoll();
      if (capture) tourSnaps[i] = captureTourState();
      tourIndex = i;
      if (typeof step.show === 'function') {
        try {
          await step.show();
        } catch (e) {}
        if (tourIndex !== i) return;
      }
      positionTourStep(step);
      startTourPoll(i);
    }
    async function advanceTour(dir) {
      stopTourPoll();
      const ni = tourIndex + dir;
      if (ni < 0) return;
      if (ni >= tourSteps.length) return endTour();
      if (dir < 0) {
        // Retroceder: restaura el estado de antes del paso al que vuelves,
        // deshaciendo ese paso y los posteriores y dejándolos listos para rehacer.
        const cur = tourIndex;
        await restoreTourState(tourSnaps[ni]);
        if (tourIndex !== cur) return;
        showTourStep(ni, false);
        return;
      }
      showTourStep(ni, true);
    }
    function endTour() {
      if (tourEl.classList.contains('hidden')) return;
      exitTourMode().then(() => {
        tourEl.classList.add('hidden');
      });
    }
    function resetTourUi() {
      tourPop.querySelector('.tour-title').textContent = '';
      tourPop.querySelector('.tour-text').textContent = '';
      tourPop.querySelector('.tour-hint').textContent = '';
      tourPop.querySelector('.tour-count').textContent = '';
      tourPop.style.visibility = 'hidden';
      tourNext.classList.remove('tour-done');
      tourNext.classList.remove('tour-loading');
      tourNext.disabled = false;
      tourNext.textContent = 'Siguiente';
      tourSpot.style.top = '-20px';
      tourSpot.style.left = '-20px';
      tourSpot.style.width = '1px';
      tourSpot.style.height = '1px';
    }
    async function openTour() {
      q('#hp-todo-panel').classList.remove('hidden');
      tourSteps = TOUR_STEPS.slice();
      tourIndex = 0;
      tourSnaps = [];
      resetTourUi();
      tourEl.classList.remove('hidden');
      await enterTourMode();
      // Mostrar el primer paso ya (sin contenido viejo) y preparar la app en segundo plano.
      showTourStep(0, true);
      try {
        await ensureListReady();
        await clearFilters();
        await waitFor(() => qa('tr.ant-table-row').length > 0, 8000, 200);
      } catch (e) {}
    }
    async function handleTourNext() {
      if (tourBusy) return;
      if (tourIndex >= tourSteps.length - 1) return endTour();
      const step = tourSteps[tourIndex];
      let done = true;
      if (step && typeof step.done === 'function') {
        try {
          done = !!step.done();
        } catch (e) {
          done = false;
        }
      }
      // Si el usuario avanza sin completar el paso, lo completo por él.
      if (!done && step && typeof step.auto === 'function') {
        tourBusy = true;
        stopTourPoll();
        setTourNextBusy(true, false);
        try {
          await step.auto();
        } catch (e) {}
        tourBusy = false;
      }
      advanceTour(1);
    }
    tourNext.addEventListener('click', handleTourNext);
    tourPrev.addEventListener('click', () => advanceTour(-1));
    q('#hp-tour-skip').addEventListener('click', () => endTour());
    window.addEventListener('resize', () => {
      if (!tourEl.classList.contains('hidden')) positionTourStep(tourSteps[tourIndex]);
    });
    q('#hp-tutorial-btn').addEventListener('click', () => {
      todoMenu.classList.add('hidden');
      openTour();
    });

    const listEl = q('#hp-todo-list');
    listEl.addEventListener('click', (e) => {
      const close = e.target.closest('.hp-todo-close');
      if (close) {
        removeTodo(close.closest('li').dataset.code);
        return;
      }
      const menuBtn = e.target.closest('.hp-todo-menu');
      if (menuBtn) {
        openTagMenu(menuBtn.closest('li').dataset.code, menuBtn);
        return;
      }
      const item = e.target.closest('li.hp-todo-item');
      if (!item) return;
      const code = item.dataset.code;
      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd + click: alterna la selección del item.
        if (selectedCodes.has(code)) selectedCodes.delete(code);
        else selectedCodes.add(code);
        selAnchor = code;
        applySelection();
        return;
      }
      if (e.shiftKey && selAnchor) {
        // Shift + click: selecciona el rango entre el ancla y el item.
        const codes = qa('#hp-todo-list li').map((li) => li.dataset.code);
        const a = codes.indexOf(selAnchor);
        const b = codes.indexOf(code);
        if (a >= 0 && b >= 0) {
          selectedCodes = new Set(codes.slice(Math.min(a, b), Math.max(a, b) + 1));
          applySelection();
        }
        return;
      }
      // Click normal: limpia la selección y abre el ticket.
      selectedCodes.clear();
      selAnchor = code;
      applySelection();
      openTicket(code);
    });

    // Al hacer click fuera de los items de la lista, se limpia la selección.
    document.addEventListener('click', (e) => {
      if (!selectedCodes.size) return;
      if (e.target.closest('#hp-todo-list li.hp-todo-item')) return;
      selectedCodes.clear();
      selAnchor = null;
      applySelection();
    });

    function currentQuery() {
      const inp = q('#hp-todo-search');
      return inp ? inp.value.trim().toLowerCase() : '';
    }
    function matches(query, t) {
      if (t.code.includes(query)) return true;
      if ((t.subject || '').toLowerCase().includes(query)) return true;
      return (t.tags || []).some((name) => (name || '').toLowerCase().includes(query));
    }
    function updateHint() {
      const hint = q('#hp-todo-hint');
      if (!hint) return;
      const all = loadArr(KEY_TODO);
      const query = currentQuery();
      if (!query) {
        hint.classList.add('hidden');
        return;
      }
      const found = all.filter((t) => matches(query, t));
      if (found.length === 0) {
        hint.textContent = /^\d+$/.test(query)
          ? 'Sin coincidencias. Enter para buscar la solicitud #' + query
          : 'Sin coincidencias. Enter para buscar por asunto';
        hint.classList.remove('hidden');
      } else {
        hint.classList.add('hidden');
      }
    }

    let activeTicketCode = null;
    function currentOpenTicketCode() {
      const h3 = qa('h3').find((h) => /Detalle de solicitud/.test(h.textContent));
      if (!h3) return null;
      const m = h3.textContent.match(/#(\d+)/);
      return m ? m[1] : null;
    }
    function applyActiveHighlight() {
      qa('#hp-todo-list li').forEach((li) => {
        li.classList.toggle('active', li.dataset.code === activeTicketCode);
      });
    }

    let selectedCodes = new Set();
    let selAnchor = null;
    function applySelection() {
      qa('#hp-todo-list li').forEach((li) => {
        li.classList.toggle('selected', selectedCodes.has(li.dataset.code));
      });
    }

    let activeTabId = localStorage.getItem(KEY_TAB_ACTIVE) || loadTabs()[0].id;

    function loadTabs() {
      let tabs = loadArr(KEY_TABS);
      if (!tabs.length) {
        tabs = [{ id: 'tab-default', name: 'General' }];
        save(KEY_TABS, tabs);
      }
      return tabs;
    }
    function saveTabs(tabs) {
      save(KEY_TABS, tabs);
    }
    function normalizeActiveTab() {
      const tabs = loadTabs();
      if (!tabs.find((t) => t.id === activeTabId)) activeTabId = tabs[0].id;
      return tabs;
    }
    function itemTab(t) {
      const tabs = loadTabs();
      return t.tab && tabs.find((x) => x.id === t.tab) ? t.tab : tabs[0].id;
    }
    function selectTab(id) {
      activeTabId = id;
      localStorage.setItem(KEY_TAB_ACTIVE, id);
      render();
    }
    function renderTabs() {
      const bar = q('#hp-todo-tabs');
      if (!bar) return;
      const tabs = loadTabs();
      const all = loadArr(KEY_TODO);
      bar.innerHTML = '';
      tabs.forEach((tab, i) => {
        const el = document.createElement('div');
        el.className = 'hp-tab' + (tab.id === activeTabId ? ' active' : '');
        el.dataset.tab = tab.id;
        const count = all.filter((t) => itemTab(t) === tab.id).length;
        el.innerHTML =
          '<span class="hp-tab-name"></span>' +
          (count ? '<span class="hp-tab-count">' + count + '</span>' : '') +
          (i > 0 ? '<button class="hp-tab-del" title="Eliminar pestaña">&times;</button>' : '');
        const nameEl = el.querySelector('.hp-tab-name');
        nameEl.textContent = tab.name;
        nameEl.title = 'Doble click para renombrar';
        el.addEventListener('click', (e) => {
          if (e.target.closest('.hp-tab-del') || e.target.closest('.hp-tab-name-input')) return;
          if (tab.id !== activeTabId) selectTab(tab.id);
        });
        nameEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          startRenameTab(tab, el);
        });
        const del = el.querySelector('.hp-tab-del');
        if (del) {
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTab(tab.id);
          });
        }
        el.addEventListener('dragover', (e) => {
          if (!dragCodes.length) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          el.classList.add('drop-target');
        });
        el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
        el.addEventListener('drop', (e) => {
          e.preventDefault();
          el.classList.remove('drop-target');
          if (dragCodes.length) assignToTab(dragCodes, tab.id);
        });
        bar.appendChild(el);
      });
      const add = document.createElement('button');
      add.id = 'hp-tab-add';
      add.title = 'Nueva pestaña';
      add.textContent = '+';
      add.addEventListener('click', addTab);
      bar.appendChild(add);
    }
    function addTab() {
      const tabs = loadTabs();
      let n = tabs.length + 1;
      let name = 'Pestaña ' + n;
      while (tabs.find((t) => t.name === name)) {
        n += 1;
        name = 'Pestaña ' + n;
      }
      const id = 'tab-' + Date.now();
      tabs.push({ id, name });
      saveTabs(tabs);
      activeTabId = id;
      localStorage.setItem(KEY_TAB_ACTIVE, id);
      render();
      const el = q('#hp-todo-tabs .hp-tab[data-tab="' + id + '"]');
      if (el) startRenameTab({ id, name }, el);
    }
    function deleteTab(id) {
      const tabs = loadTabs();
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx <= 0) return;
      if (!window.confirm('¿Eliminar la pestaña "' + tabs[idx].name + '"? Los tickets se moverán a la primera pestaña.')) return;
      const fallback = tabs[0].id;
      const list = loadArr(KEY_TODO);
      list.forEach((t) => {
        if (itemTab(t) === id) t.tab = fallback;
      });
      save(KEY_TODO, list);
      tabs.splice(idx, 1);
      saveTabs(tabs);
      if (activeTabId === id) {
        activeTabId = fallback;
        localStorage.setItem(KEY_TAB_ACTIVE, fallback);
      }
      render();
    }
    function startRenameTab(tab, el) {
      const nameEl = el.querySelector('.hp-tab-name');
      if (!nameEl) return;
      const input = document.createElement('input');
      input.className = 'hp-tab-name-input';
      input.value = tab.name;
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        const name = input.value.trim() || tab.name;
        const tabs = loadTabs();
        const t = tabs.find((x) => x.id === tab.id);
        if (t && t.name !== name) {
          t.name = name;
          saveTabs(tabs);
        }
        render();
      };
      const cancel = () => {
        if (done) return;
        done = true;
        render();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      });
      input.addEventListener('blur', commit);
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('dblclick', (e) => e.stopPropagation());
    }
    function assignToTab(codes, tabId) {
      const list = loadArr(KEY_TODO);
      const arr = Array.isArray(codes) ? codes : [codes];
      let changed = false;
      arr.forEach((code) => {
        const item = list.find((t) => t.code === code);
        if (item && itemTab(item) !== tabId) {
          item.tab = tabId;
          changed = true;
        }
      });
      if (changed) save(KEY_TODO, list);
      selectedCodes.clear();
      selAnchor = null;
      activeTabId = tabId;
      localStorage.setItem(KEY_TAB_ACTIVE, tabId);
      render();
    }

    function render() {
      const all = loadArr(KEY_TODO);
      normalizeActiveTab();
      const query = currentQuery();
      // Al buscar, se incluyen todas las pestañas (la barra de pestañas se oculta).
      const list = query ? all.filter((t) => matches(query, t)) : all.filter((t) => itemTab(t) === activeTabId);
      const ul = q('#hp-todo-list');
      if (!ul) return;
      renderTabs();
      const tabsEl = q('#hp-todo-tabs');
      if (tabsEl) tabsEl.style.display = query ? 'none' : 'flex';
      ul.innerHTML = '';
      for (const t of list) {
        const li = document.createElement('li');
        li.className = 'hp-todo-item';
        li.dataset.code = t.code;
        li.draggable = true;
        let prioHtml = '';
        if (t.priority && t.priority.label) {
          const dot = t.priority.color
            ? '<span class="hp-priority-dot" style="background:' + t.priority.color + '"></span>'
            : '';
          prioHtml = '<span class="hp-priority" title="Prioridad: ' + t.priority.label + '">' + dot + '<span class="hp-priority-label"></span></span>';
        }
        li.innerHTML =
          '<span class="hp-code">#' + t.code + '</span>' +
          '<span class="hp-subject"></span>' +
          tagsHtml(t) +
          prioHtml +
          '<button class="hp-todo-menu" title="Etiquetas"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg></button>' +
          '<button class="hp-todo-close" title="Quitar">&times;</button>';
        li.querySelector('.hp-subject').textContent = t.subject || '';
        const pl = li.querySelector('.hp-priority-label');
        if (pl) pl.textContent = t.priority.label;
        ul.appendChild(li);
      }
      const badge = q('#hp-todo-badge');
      const count = q('#hp-todo-count');
      if (badge) {
        badge.textContent = all.length;
        badge.classList.toggle('hidden', all.length === 0);
      }
      if (count) count.textContent = all.length;
      updateHint();
      applyActiveHighlight();
      applySelection();
    }

    function upsertTodo(code, subject, priority) {
      const list = loadArr(KEY_TODO);
      const existing = list.find((t) => t.code === code);
      if (existing) {
        let changed = false;
        if (!existing.subject && subject) {
          existing.subject = subject;
          changed = true;
        }
        if ((!existing.priority || !existing.priority.label) && priority && priority.label) {
          existing.priority = priority;
          changed = true;
        }
        if (changed) {
          save(KEY_TODO, list);
          render();
        }
        return;
      }
      list.unshift({ code, subject, priority: priority || null, tags: [], tab: loadTabs()[0].id });
      save(KEY_TODO, list);
      render();
    }

    async function removeTodo(code) {
      if (currentOpenTicketCode() === code) {
        const back = q('.anticon-arrow-left');
        if (back) back.click();
        await waitFor(() => !currentOpenTicketCode(), 2000, 50);
      }
      save(KEY_TODO, loadArr(KEY_TODO).filter((t) => t.code !== code));
      render();
    }

    // Reordenar arrastrando y soltando, dejando hueco en vivo
    let dragCode = null;
    let dragCodes = [];
    listEl.addEventListener('dragstart', (e) => {
      const item = e.target.closest('li.hp-todo-item');
      if (!item) return;
      dragCode = item.dataset.code;
      dragCodes = selectedCodes.has(dragCode) && selectedCodes.size > 1 ? [...selectedCodes] : [dragCode];
      if (dragCodes.length > 1) {
        qa('#hp-todo-list li').forEach((li) => {
          if (dragCodes.includes(li.dataset.code)) li.classList.add('dragging');
        });
      } else {
        item.classList.add('dragging');
      }
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', dragCode);
      } catch (err) {}
      // Imagen de arrastre semitransparente para que se vea dónde caerá. Se usa un
      // canvas porque Chrome dibuja totalmente opacas las imágenes de arrastre clonadas.
      try {
        const rect = item.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.globalAlpha = 0.65;
        const r = 6;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.arcTo(w, 0, w, h, r);
        ctx.arcTo(w, h, 0, h, r);
        ctx.arcTo(0, h, 0, 0, r);
        ctx.arcTo(0, 0, w, 0, r);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#d9d9d9';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.textBaseline = 'middle';
        let x = 12;
        const codeEl = item.querySelector('.hp-code');
        if (codeEl) {
          ctx.fillStyle = '#1677ff';
          ctx.font = '700 13px -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
          ctx.fillText(codeEl.textContent, x, h / 2);
          x += ctx.measureText(codeEl.textContent).width + 8;
        }
        const subjEl = item.querySelector('.hp-subject');
        if (subjEl) {
          ctx.fillStyle = '#444';
          ctx.font = '13px -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
          const maxW = w - x - 12;
          let txt = subjEl.textContent || '';
          while (txt.length > 1 && ctx.measureText(txt).width > maxW) txt = txt.slice(0, -1);
          if (txt !== subjEl.textContent) txt = txt.slice(0, -1) + '…';
          ctx.fillText(txt, x, h / 2);
        }
        canvas.style.position = 'fixed';
        canvas.style.left = rect.left + 'px';
        canvas.style.top = rect.top + 'px';
        canvas.style.pointerEvents = 'none';
        document.body.appendChild(canvas);
        e.dataTransfer.setDragImage(canvas, e.clientX - rect.left, e.clientY - rect.top);
        setTimeout(() => canvas.remove(), 0);
      } catch (err) {}
    });
    listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // Con varios items seleccionados no se reordena en vivo (solo se sueltan en pestañas).
      if (dragCodes.length > 1) return;
      const target = e.target.closest('li.hp-todo-item');
      if (!target || !dragCode || target.dataset.code === dragCode) return;
      const rect = target.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      const list = loadArr(KEY_TODO);
      const from = list.findIndex((t) => t.code === dragCode);
      const to = list.findIndex((t) => t.code === target.dataset.code);
      if (from < 0 || to < 0 || from === to) return;
      const moved = list.splice(from, 1)[0];
      const newTo = list.findIndex((t) => t.code === target.dataset.code);
      list.splice(after ? newTo + 1 : newTo, 0, moved);
      save(KEY_TODO, list);
      const draggedEl = listEl.querySelector('li[data-code="' + dragCode + '"]');
      if (draggedEl) {
        if (after) {
          target.insertAdjacentElement('afterend', draggedEl);
        } else {
          target.insertAdjacentElement('beforebegin', draggedEl);
        }
      }
    });
    listEl.addEventListener('drop', (e) => {
      e.preventDefault();
    });
    listEl.addEventListener('dragend', () => {
      qa('#hp-todo-list li.dragging').forEach((li) => li.classList.remove('dragging'));
      qa('.hp-tab.drop-target').forEach((el) => el.classList.remove('drop-target'));
      dragCode = null;
      dragCodes = [];
    });

    // Redimensionar en horizontal
    let panelWidth = parseInt(localStorage.getItem('hp_todo_width'), 10) || 320;
    function applyPanelWidth() {
      const panel = q('#hp-todo-panel');
      if (panel) panel.style.width = panelWidth + 'px';
    }
    applyPanelWidth();
    const handle = q('.hp-resize-handle');
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panelWidth;
      const onMove = (ev) => {
        panelWidth = Math.max(240, Math.min(800, startW + (ev.clientX - startX)));
        applyPanelWidth();
      };
      const onUp = () => {
        localStorage.setItem('hp_todo_width', String(panelWidth));
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });

    // Redimensionar en vertical (borde superior)
    let panelHeight = parseInt(localStorage.getItem('hp_todo_height'), 10) || 0;
    function applyPanelHeight() {
      const panel = q('#hp-todo-panel');
      if (!panel || panelHeight <= 0) return;
      panel.style.maxHeight = 'none';
      panel.style.height = Math.min(panelHeight, window.innerHeight - 80) + 'px';
    }
    applyPanelHeight();
    const handleTop = q('.hp-resize-handle-top');
    handleTop.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const panel = q('#hp-todo-panel');
      const startY = e.clientY;
      const startH = panel.getBoundingClientRect().height;
      const onMove = (ev) => {
        panelHeight = Math.max(160, Math.min(window.innerHeight - 80, startH + (startY - ev.clientY)));
        applyPanelHeight();
      };
      const onUp = () => {
        localStorage.setItem('hp_todo_height', String(panelHeight));
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });

    // Buscador
    const searchEl = q('#hp-todo-search');
    searchEl.addEventListener('input', () => render());
    searchEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const raw = (e.target.value || '').trim();
      if (!raw) return;
      e.target.value = '';
      render();
      if (/^\d+$/.test(raw)) {
        // Por código: abre la coincidencia (exacta o parcial) o la busca en la plataforma.
        const list = loadArr(KEY_TODO);
        const match = list.find((t) => t.code === raw) || list.find((t) => t.code.includes(raw));
        openTicket(match ? match.code : raw);
      } else {
        // Con letras: búsqueda por asunto en la plataforma, sin abrir nada.
        searchPlatformBySubject(raw);
      }
    });

    // ---- etiquetas ----
    function loadTags() {
      return loadArr(KEY_TAGS);
    }
    function saveTags(tags) {
      save(KEY_TAGS, tags);
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function tagsHtml(t) {
      const itemTags = t.tags || [];
      if (!itemTags.length) return '';
      const tagDefs = loadTags();
      return (
        '<span class="hp-tags">' +
        itemTags
          .map((name) => {
            const def = tagDefs.find((d) => d.name === name);
            const color = def ? def.color : '#1677ff';
            return '<span class="hp-tag-chip" style="background:' + color + '1f;color:' + color + ';">' + escapeHtml(name) + '</span>';
          })
          .join('') +
        '</span>'
      );
    }

    const tagMenu = q('#hp-tag-menu');
    const tagMenuList = q('#hp-tag-menu-list');
    const tagForm = q('#hp-tag-form');
    const tagNameInput = q('#hp-tag-name');
    const tagColorsEl = q('#hp-tag-colors');
    let tagMenuCode = null;
    let tagDraftColor = TAG_COLORS[0];
    tagMenu.addEventListener('click', (e) => e.stopPropagation());

    function renderTagColors() {
      tagColorsEl.innerHTML = '';
      for (const c of TAG_COLORS) {
        const sw = document.createElement('div');
        sw.className = 'hp-color-swatch' + (c === tagDraftColor ? ' selected' : '');
        sw.style.background = c;
        sw.dataset.color = c;
        sw.addEventListener('click', () => {
          tagDraftColor = c;
          renderTagColors();
        });
        tagColorsEl.appendChild(sw);
      }
    }

    function renderTagMenu() {
      const tags = loadTags();
      const item = loadArr(KEY_TODO).find((t) => t.code === tagMenuCode);
      const assigned = item && item.tags ? item.tags : [];
      tagMenuList.innerHTML = '';
      if (!tags.length) {
        tagMenuList.innerHTML = '<div class="m-tag" style="color:#999;cursor:default;">Sin etiquetas todavía</div>';
      }
      for (const tg of tags) {
        const checked = assigned.includes(tg.name);
        const div = document.createElement('div');
        div.className = 'm-tag';
        div.dataset.name = tg.name;
        div.innerHTML =
          '<span class="m-chip" style="background:' + tg.color + '1f;color:' + tg.color + ';">' + escapeHtml(tg.name) + '</span>' +
          (checked ? '<span class="m-check">✓</span>' : '') +
          '<span class="m-edit" title="Cambiar color">✎</span>' +
          '<span class="m-del" title="Eliminar etiqueta">&times;</span>';
        div.addEventListener('click', () => toggleTag(tg.name));
        const edit = div.querySelector('.m-edit');
        edit.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleColorEditor(tg.name, div);
        });
        const del = div.querySelector('.m-del');
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteTag(tg.name);
        });
        tagMenuList.appendChild(div);
      }
    }

    function toggleTag(name) {
      if (!tagMenuCode) return;
      const list = loadArr(KEY_TODO);
      const item = list.find((t) => t.code === tagMenuCode);
      if (!item) return;
      item.tags = item.tags || [];
      const i = item.tags.indexOf(name);
      if (i >= 0) item.tags.splice(i, 1);
      else item.tags.push(name);
      save(KEY_TODO, list);
      render();
      renderTagMenu();
    }

    function deleteTag(name) {
      saveTags(loadTags().filter((t) => t.name !== name));
      const list = loadArr(KEY_TODO);
      list.forEach((t) => {
        if (t.tags) {
          const i = t.tags.indexOf(name);
          if (i >= 0) t.tags.splice(i, 1);
        }
      });
      save(KEY_TODO, list);
      render();
      renderTagMenu();
    }

    function setTagColor(name, color) {
      const tags = loadTags();
      const tg = tags.find((t) => t.name === name);
      if (tg) {
        tg.color = color;
        saveTags(tags);
      }
      render();
      renderTagMenu();
    }

    function toggleColorEditor(name, tagDiv) {
      const existing = tagDiv.nextElementSibling;
      if (existing && existing.classList.contains('m-edit-colors')) {
        existing.remove();
        return;
      }
      tagMenuList.querySelectorAll('.m-edit-colors').forEach((el) => el.remove());
      const tg = loadTags().find((t) => t.name === name);
      const colors = document.createElement('div');
      colors.className = 'm-edit-colors';
      for (const c of TAG_COLORS) {
        const sw = document.createElement('div');
        sw.className = 'hp-color-swatch' + (tg && c === tg.color ? ' selected' : '');
        sw.style.background = c;
        sw.addEventListener('click', (e) => {
          e.stopPropagation();
          setTagColor(name, c);
        });
        colors.appendChild(sw);
      }
      tagDiv.after(colors);
    }

    function openTagMenu(code, btn) {
      tagMenuCode = code;
      renderTagMenu();
      tagForm.classList.add('hidden');
      tagMenu.classList.remove('hidden');
      const r = btn.getBoundingClientRect();
      tagMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 226)) + 'px';
      tagMenu.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    }

    function closeTagMenu() {
      tagMenu.classList.add('hidden');
      tagMenuCode = null;
    }

    q('#hp-tag-new-btn').addEventListener('click', () => {
      tagForm.classList.remove('hidden');
      tagNameInput.value = '';
      tagDraftColor = TAG_COLORS[0];
      renderTagColors();
      tagNameInput.focus();
    });

    q('#hp-tag-save').addEventListener('click', () => {
      const name = tagNameInput.value.trim();
      if (!name) return;
      const tags = loadTags();
      if (!tags.find((t) => t.name === name)) {
        tags.push({ name, color: tagDraftColor });
        saveTags(tags);
      }
      if (tagMenuCode) {
        const list = loadArr(KEY_TODO);
        const item = list.find((t) => t.code === tagMenuCode);
        if (item) {
          item.tags = item.tags || [];
          if (!item.tags.includes(name)) item.tags.push(name);
          save(KEY_TODO, list);
          render();
        }
      }
      tagForm.classList.add('hidden');
      renderTagMenu();
    });

    q('#hp-tag-cancel').addEventListener('click', () => {
      tagForm.classList.add('hidden');
      tagNameInput.value = '';
    });

    document.addEventListener('click', (e) => {
      if (tagMenu.classList.contains('hidden')) return;
      if (e.target.closest('.hp-todo-menu')) return;
      closeTagMenu();
    });

    // Cambia el ícono provisional por el logo de la app cuando se renderiza
    let fabIconUpdated = false;
    function updateFabIcon() {
      if (fabIconUpdated) return;
      const fab = q('#hp-todo-fab');
      if (!fab) return;
      const nav = q('nav');
      const logo = nav
        ? [...nav.querySelectorAll('img')].find((im) => (im.getAttribute('alt') || '').toLowerCase().includes('logo') || (im.getAttribute('src') || '').toLowerCase().includes('logo'))
        : null;
      if (!logo) return;
      const src = logo.getAttribute('src');
      if (!src) return;
      const img = document.createElement('img');
      img.src = src;
      img.alt = 'Tickets';
      const svg = fab.querySelector('svg');
      if (svg) fab.replaceChild(img, svg);
      fabIconUpdated = true;
    }
    updateFabIcon();

    const observer = new MutationObserver(() => {
      updateFabIcon();
      const code = currentOpenTicketCode();
      const ticketChanged = code !== activeTicketCode;
      if (code) {
        const existing = loadArr(KEY_TODO).find((t) => t.code === code);
        let tabChanged = false;
        if (ticketChanged) {
          const targetTab = existing ? itemTab(existing) : loadTabs()[0].id;
          if (targetTab !== activeTabId) {
            activeTabId = targetTab;
            localStorage.setItem(KEY_TAB_ACTIVE, targetTab);
            tabChanged = true;
          }
        }
        const h2 = qa('h2').find((h) => /^\[/.test(h.textContent.trim()));
        const subject = h2 ? h2.textContent.trim().replace(/\s+/g, ' ') : '';
        const priority = extractPriority();
        upsertTodo(code, subject, priority);
        if (tabChanged && existing) render();
      }
      if (ticketChanged) {
        activeTicketCode = code;
        applyActiveHighlight();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    todoRender = render;
    render();
  }

  // ---------- inicio ----------
  if (CONFIG.todoWidget) {
    await restoreTourBackup();
    await restoreBackup();
  }
  if (CONFIG.persistModule) setupPersistModule();
  if (CONFIG.persistView) setupPersistView();
  if (CONFIG.todoWidget) setupTodoWidget();
  if (CONFIG.tallerDescription) setupTallerDescription();

  if (CONFIG.todoWidget) {
    backupNow();
    setInterval(backupNow, 15000);
    // Si la app borra el localStorage en caliente (sin recargar), restaura y redibuja.
    setInterval(async () => {
      if (localStorage.getItem(KEY_TODO) === null) {
        const restored = await restoreBackup();
        if (restored && todoRender) todoRender();
      }
    }, 5000);
    window.addEventListener('pagehide', backupNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') backupNow();
    });
  }

  if (CONFIG.persistModule) {
    let attempts = 0;
    const timer = setInterval(() => {
      const map = findModuleButtons();
      if (MODULES.every((n) => map[n])) {
        clearInterval(timer);
        const saved = loadObj(KEY_STATE);
        if (saved.module && MODULES.includes(saved.module) && activeModule() !== saved.module) {
          const btn = map[saved.module];
          if (btn) btn.click();
        }
      } else if (++attempts > 80) {
        clearInterval(timer);
      }
    }, 250);
  }
})();
