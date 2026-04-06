/*
 * Device Charge Log Plugin for Obsidian
 * Version: 1.0.0
 * Mobile-first design, Android compatible
 * Features: pending sessions, simultaneous multi-device charging,
 *           auto-calculated Duration and Percentage Charged,
 *           vault-driven Device dropdown
 */

'use strict';

var obsidian = require('obsidian');

// ============================================================
// CONSTANTS
// ============================================================
const PLUGIN_ID     = 'device-charge-log';
const LOG_FOLDER    = 'Activity Logs/Device Charge Log';
const PAGE_SIZE     = 20;
const PENDING_KEY   = 'dcl-pending-sessions';   // localStorage key for pending sessions
const FOLDER_DEVICES = '_system/Database/Devices';

// Palette for device badge/chart colours
const PALETTE = [
    '#3b82f6','#8b5cf6','#22c55e','#f59e0b',
    '#ef4444','#06b6d4','#ec4899','#10b981',
    '#f97316','#6366f1','#14b8a6','#84cc16'
];

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function padZ(n) { return String(n).padStart(2, '0'); }

function nowDate() {
    const d = new Date();
    return `${d.getFullYear()}-${padZ(d.getMonth()+1)}-${padZ(d.getDate())}`;
}

function nowTime() {
    const d = new Date();
    return `${padZ(d.getHours())}:${padZ(d.getMinutes())}`;
}

function formatDateTime(date, time) {
    try {
        const dt = new Date(`${date}T${time}`);
        if (isNaN(dt)) return `${date} ${time}`;
        return dt.toLocaleString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch(e) { return `${date} ${time}`; }
}

function formatDateShort(date) {
    try {
        const d = new Date(date + 'T00:00:00');
        if (isNaN(d)) return date;
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch(e) { return date; }
}

function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Stable palette index 0–11 for any string */
function paletteIdx(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
    return Math.abs(h) % PALETTE.length;
}

function deviceColor(val) {
    if (!val) return '#6b7280';
    return PALETTE[paletteIdx(val)];
}

function deviceBadgeClass(val) {
    if (!val) return 'dcl-badge-none';
    return `dcl-badge-p${paletteIdx(val)}`;
}

/** Compute duration string "Xh Ym" from two HH:MM strings (handles overnight) */
function calcDuration(startTime, endTime) {
    if (!startTime || !endTime) return '';
    try {
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        let mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins < 0) mins += 24 * 60;   // overnight
        if (mins === 0) return '0m';
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    } catch(e) { return ''; }
}

/** Compute percentage gained as signed integer string, e.g. "+72%" */
function calcPctCharged(startPct, endPct) {
    const s = parseInt(startPct, 10);
    const e = parseInt(endPct,   10);
    if (isNaN(s) || isNaN(e)) return '';
    const diff = e - s;
    return diff >= 0 ? `+${diff}%` : `${diff}%`;
}

/** CSS class for a percentage badge based on ending level */
function pctBadgeClass(pct) {
    const n = parseInt(pct, 10);
    if (isNaN(n))  return '';
    if (n <= 20)   return 'dcl-pct-low';
    if (n <= 50)   return 'dcl-pct-mid';
    if (n <= 85)   return 'dcl-pct-good';
    return 'dcl-pct-full';
}

function escapeYaml(val) {
    if (!val) return '""';
    const s = String(val);
    if (s.includes('\n') || s.includes('"') || s.includes("'") || s.includes(':') || s.includes('#')) {
        return `"${s.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return s;
}

function parseYamlFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const data = {};
    for (const line of match[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        let val   = line.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
        }
        data[key] = val;
    }
    return data;
}

function buildMarkdown(entry) {
    return `---
date: ${escapeYaml(entry.date)}
device: ${escapeYaml(entry.device || '')}
start_time: ${escapeYaml(entry.start_time || '')}
start_pct: ${escapeYaml(String(entry.start_pct || ''))}
end_time: ${escapeYaml(entry.end_time || '')}
end_pct: ${escapeYaml(String(entry.end_pct || ''))}
duration: ${escapeYaml(entry.duration || '')}
pct_charged: ${escapeYaml(entry.pct_charged || '')}
location: ${escapeYaml(entry.location || '')}
comments: ${escapeYaml(entry.comments || '')}
---

# Device Charge Log Entry

**Date:** ${entry.date}  
**Device:** ${entry.device || 'N/A'}  
**Start Time:** ${entry.start_time || 'N/A'}  
**Starting %:** ${entry.start_pct !== '' && entry.start_pct !== undefined ? entry.start_pct + '%' : 'N/A'}  
**End Time:** ${entry.end_time || 'N/A'}  
**Ending %:** ${entry.end_pct   !== '' && entry.end_pct   !== undefined ? entry.end_pct   + '%' : 'N/A'}  
**Duration:** ${entry.duration || 'N/A'}  
**% Charged:** ${entry.pct_charged || 'N/A'}  
**Location:** ${entry.location || 'N/A'}  

## Comments
${entry.comments || '_No comments_'}
`;
}

function entryToFilename(entry) {
    const devSlug  = slugify(entry.device || 'device');
    const timeSlug = (entry.start_time || '00-00').replace(':', '-');
    return `${entry.date}_${timeSlug}_${devSlug}.md`;
}

// ============================================================
// TOAST & CONFIRM
// ============================================================

function showToast(message, type = 'info', duration = 2800) {
    let toast = document.querySelector('.dcl-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'dcl-toast';
        document.body.appendChild(toast);
    }
    toast.className = `dcl-toast ${type}`;
    toast.textContent = message;
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

function showConfirm(title, message, onConfirm, confirmLabel = 'Delete', confirmCls = 'dcl-btn-danger') {
    const overlay = document.createElement('div');
    overlay.className = 'dcl-confirm-overlay';
    overlay.innerHTML = `
        <div class="dcl-confirm-box">
            <span class="confirm-icon">⚠️</span>
            <h3>${title}</h3>
            <p>${message}</p>
            <div class="dcl-confirm-actions">
                <button class="dcl-btn dcl-btn-secondary" id="dcl-cancel-btn">Cancel</button>
                <button class="dcl-btn ${confirmCls}"    id="dcl-confirm-btn">${confirmLabel}</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#dcl-cancel-btn').addEventListener('click',  () => document.body.removeChild(overlay));
    overlay.querySelector('#dcl-confirm-btn').addEventListener('click', () => { document.body.removeChild(overlay); onConfirm(); });
}

// ============================================================
// PENDING SESSION STORE
// Uses the Obsidian plugin data file (this.plugin.saveData / loadData)
// so sessions persist across Obsidian restarts on Android.
// ============================================================

// Each pending session object:
// { id, device, date, start_time, start_pct, location, created_at }

// ============================================================
// PLUGIN CLASS
// ============================================================

class DeviceChargeLogPlugin extends obsidian.Plugin {
    async onload() {
        await this.ensureFolder();

        // Load pending sessions from plugin data
        const saved = await this.loadData();
        this.pendingSessions = (saved && saved.pendingSessions) ? saved.pendingSessions : [];

        this.addRibbonIcon('battery-charging', 'Device Charge Log', () => {
            new DeviceChargeLogModal(this.app, this).open();
        });

        this.addCommand({
            id:   'open-device-charge-log',
            name: 'Open Device Charge Log',
            callback: () => new DeviceChargeLogModal(this.app, this).open()
        });
    }

    async ensureFolder() {
        if (!(await this.app.vault.adapter.exists(LOG_FOLDER))) {
            try { await this.app.vault.createFolder(LOG_FOLDER); } catch(e) {}
        }
    }

    /** Persist pending sessions to plugin data file */
    async savePendingSessions() {
        const data = (await this.loadData()) || {};
        data.pendingSessions = this.pendingSessions;
        await this.saveData(data);
    }

    /** Add a new pending session; returns the session object */
    async addPendingSession(session) {
        session.id = `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
        session.created_at = new Date().toISOString();
        this.pendingSessions.push(session);
        await this.savePendingSessions();
        return session;
    }

    /** Remove pending session by id */
    async removePendingSession(id) {
        this.pendingSessions = this.pendingSessions.filter(s => s.id !== id);
        await this.savePendingSessions();
    }

    /** Load device names from vault folder */
    async loadDevices() {
        const folder = this.app.vault.getAbstractFileByPath(FOLDER_DEVICES);
        if (!folder || !(folder instanceof obsidian.TFolder)) return [];
        return folder.children
            .filter(f => f instanceof obsidian.TFile && f.extension === 'md')
            .map(f => f.basename)
            .sort((a, b) => a.localeCompare(b));
    }

    // ---- CRUD ----
    async saveEntry(entry, oldFilename) {
        await this.ensureFolder();
        const filename = entryToFilename(entry);
        const filepath = `${LOG_FOLDER}/${filename}`;
        const content  = buildMarkdown(entry);

        if (oldFilename && oldFilename !== filename) {
            const old = this.app.vault.getAbstractFileByPath(`${LOG_FOLDER}/${oldFilename}`);
            if (old) await this.app.vault.delete(old);
        }

        const existing = this.app.vault.getAbstractFileByPath(filepath);
        if (existing) await this.app.vault.modify(existing, content);
        else          await this.app.vault.create(filepath, content);
        return filename;
    }

    async deleteEntry(filename) {
        const file = this.app.vault.getAbstractFileByPath(`${LOG_FOLDER}/${filename}`);
        if (file) { await this.app.vault.delete(file); return true; }
        return false;
    }

    async loadAllEntries() {
        const folder = this.app.vault.getAbstractFileByPath(LOG_FOLDER);
        if (!folder || !(folder instanceof obsidian.TFolder)) return [];

        const entries = [];
        for (const file of folder.children) {
            if (!(file instanceof obsidian.TFile) || file.extension !== 'md') continue;
            try {
                const raw  = await this.app.vault.read(file);
                const data = parseYamlFrontmatter(raw);
                if (data && data.date) {
                    entries.push({
                        filename:    file.name,
                        date:        data.date        || '',
                        device:      data.device      || '',
                        start_time:  data.start_time  || '',
                        start_pct:   data.start_pct   || '',
                        end_time:    data.end_time     || '',
                        end_pct:     data.end_pct      || '',
                        duration:    data.duration    || '',
                        pct_charged: data.pct_charged || '',
                        location:    data.location    || '',
                        comments:    data.comments    || '',
                    });
                }
            } catch(e) { /* skip corrupt */ }
        }

        entries.sort((a, b) => {
            const da = `${a.date}T${a.start_time}`;
            const db = `${b.date}T${b.start_time}`;
            return db.localeCompare(da);
        });
        return entries;
    }

    // ---- CSV export ----
    async exportCSV(entries) {
        const headers = ['Date','Device','Start Time','Start %','End Time','End %','Duration','% Charged','Location','Comments'];
        const rows    = entries.map(e =>
            [e.date, e.device, e.start_time, e.start_pct, e.end_time, e.end_pct, e.duration, e.pct_charged, e.location, e.comments]
            .map(v => `"${String(v||'').replace(/"/g,'""')}"`)
            .join(',')
        );
        const csv = [headers.join(','), ...rows].join('\n');
        const ts  = new Date().toISOString().slice(0, 10);
        const fp  = `${LOG_FOLDER}/export_${ts}.csv`;
        const ex  = this.app.vault.getAbstractFileByPath(fp);
        if (ex) await this.app.vault.modify(ex, csv);
        else    await this.app.vault.create(fp, csv);
        return fp;
    }

    // ---- CSV import ----
    parseCSVLine(line) {
        const result = []; let inQ = false; let cur = '';
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
            else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
            else cur += ch;
        }
        result.push(cur);
        return result;
    }

    async importCSV(content) {
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length < 2) return 0;
        let imported = 0;
        for (let i = 1; i < lines.length; i++) {
            const c = this.parseCSVLine(lines[i]);
            if (c.length < 2) continue;
            const entry = {
                date:        (c[0]||'').trim(),
                device:      (c[1]||'').trim(),
                start_time:  (c[2]||'').trim(),
                start_pct:   (c[3]||'').trim(),
                end_time:    (c[4]||'').trim(),
                end_pct:     (c[5]||'').trim(),
                duration:    (c[6]||'').trim(),
                pct_charged: (c[7]||'').trim(),
                location:    (c[8]||'').trim(),
                comments:    (c[9]||'').trim(),
            };
            if (!entry.date) continue;
            // Recompute calculated fields if missing
            if (!entry.duration && entry.start_time && entry.end_time)
                entry.duration = calcDuration(entry.start_time, entry.end_time);
            if (!entry.pct_charged && entry.start_pct !== '' && entry.end_pct !== '')
                entry.pct_charged = calcPctCharged(entry.start_pct, entry.end_pct);
            await this.saveEntry(entry, null);
            imported++;
        }
        return imported;
    }
}

// ============================================================
// MODAL
// ============================================================

class DeviceChargeLogModal extends obsidian.Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin          = plugin;
        this.entries         = [];
        this.filteredEntries = [];
        this.devices         = [];
        this.currentView     = 'dashboard';
        this.currentEntry    = null;
        this.completingSession = null;   // pending session being completed
        this.searchQuery     = '';
        this.filterDevice    = 'all';
        this.currentPage     = 0;
        this.contentEl.addClass('dcl-modal-root');
    }

    async onOpen() {
        const modalContainer = this.modalEl.closest('.modal-container');
        if (modalContainer) {
            modalContainer.style.cssText =
                'position:fixed;inset:0;display:flex;align-items:stretch;' +
                'justify-content:center;padding:0;margin:0;z-index:9999;';
        }
        this.modalEl.style.cssText =
            'position:relative;width:100%;max-width:680px;' +
            'height:100dvh;height:100vh;max-height:100dvh;max-height:100vh;' +
            'border-radius:0;margin:0;padding:0;' +
            'display:flex;flex-direction:column;overflow:hidden;' +
            'background:var(--background-primary);';
        this.contentEl.style.cssText =
            'flex:1 1 0;min-height:0;overflow:hidden;' +
            'display:flex;flex-direction:column;padding:0;margin:0;';

        const obsCloseBtn = this.modalEl.querySelector('.modal-close-button');
        if (obsCloseBtn) obsCloseBtn.style.display = 'none';

        this.contentEl.empty();
        this.wrapper = this.contentEl.createDiv({ cls: 'dcl-modal' });

        [this.entries, this.devices] = await Promise.all([
            this.plugin.loadAllEntries(),
            this.plugin.loadDevices(),
        ]);
        this.filteredEntries = [...this.entries];

        this.render();
    }

    onClose() { this.contentEl.empty(); }

    render() {
        this.wrapper.empty();
        this.renderHeader();
        switch (this.currentView) {
            case 'dashboard':      this.renderDashboard();         break;
            case 'start':          this.renderStartForm();         break;
            case 'complete':       this.renderCompleteForm();      break;
            case 'manual':         this.renderManualForm(false);   break;
            case 'edit':           this.renderManualForm(true);    break;
            case 'entries':        this.renderEntries();           break;
            case 'charts':         this.renderCharts();            break;
            case 'detail':         this.renderDetail();            break;
            case 'data':           this.renderDataMgmt();          break;
        }
    }

    // ---- HEADER ----
    renderHeader() {
        const hdr = this.wrapper.createDiv({ cls: 'dcl-header' });
        const top = hdr.createDiv({ cls: 'dcl-header-top' });
        top.createDiv().createEl('h2').innerHTML =
            `<span class="dcl-header-icon">🔋</span> Device Charge Log`;
        hdr.createEl('p', { cls: 'dcl-header-subtitle', text: 'Track charging sessions across all devices' });
        top.createEl('button', { cls: 'dcl-close-btn', text: '✕' })
            .addEventListener('click', () => this.close());
        this.renderStatsStrip();
    }

    renderStatsStrip() {
        const strip = this.wrapper.createDiv({ cls: 'dcl-stats-strip' });
        const s     = this.computeStats();
        for (const chip of [
            { value: s.total,      label: 'Sessions' },
            { value: s.today,      label: 'Today' },
            { value: s.pending,    label: 'Pending' },
            { value: s.thisWeek,   label: 'This Week' },
            { value: s.topDevice,  label: 'Top Device' },
        ]) {
            const c = strip.createDiv({ cls: 'dcl-stat-chip' });
            c.createEl('span', { cls: 'stat-value', text: String(chip.value) });
            c.createEl('span', { cls: 'stat-label',  text: chip.label });
        }
    }

    computeStats() {
        const today   = nowDate();
        const total   = this.entries.length;
        const todayCnt = this.entries.filter(e => e.date === today).length;
        const pending  = this.plugin.pendingSessions.length;

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const wStr    = `${weekAgo.getFullYear()}-${padZ(weekAgo.getMonth()+1)}-${padZ(weekAgo.getDate())}`;
        const thisWeek = this.entries.filter(e => e.date >= wStr).length;

        const devCounts = {};
        for (const e of this.entries) if (e.device) devCounts[e.device] = (devCounts[e.device]||0)+1;
        const topDevice = Object.entries(devCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—';

        return { total, today: todayCnt, pending, thisWeek, topDevice };
    }

    // ---- DASHBOARD ----
    renderDashboard() {
        const content = this.wrapper.createDiv({ cls: 'dcl-content' });

        // ---- Pending sessions panel ----
        const pendingSessions = this.plugin.pendingSessions;
        const panel = content.createDiv({ cls: 'dcl-pending-panel' });

        const ph = panel.createDiv({ cls: 'dcl-pending-header' });
        const ptitle = ph.createDiv({ cls: 'dcl-pending-title' });
        ptitle.createDiv({ cls: 'pulse-dot' });
        ptitle.createEl('span', { text: `Pending Sessions (${pendingSessions.length})` });

        if (pendingSessions.length === 0) {
            panel.createEl('p', { cls: 'dcl-pending-empty', text: 'No active charging sessions' });
        } else {
            for (const session of pendingSessions) {
                this.renderPendingCard(panel, session);
            }
        }

        // ---- Dashboard grid ----
        const grid = content.createDiv({ cls: 'dcl-dashboard-grid' });
        for (const btn of [
            { icon: '⚡', label: 'Start Charging', desc: 'Begin a new session',   view: 'start' },
            { icon: '📋', label: 'View Entries',   desc: 'Browse completed logs', view: 'entries' },
            { icon: '✍️', label: 'Manual Entry',   desc: 'Log a past session',    view: 'manual' },
            { icon: '📊', label: 'Charts',          desc: 'Visual statistics',     view: 'charts' },
            { icon: '⚙️', label: 'Data Manager',   desc: 'Import / Export CSV',   view: 'data', full: true },
        ]) {
            const el = grid.createEl('button', { cls: 'dcl-dashboard-btn' + (btn.full ? ' full-width' : '') });
            el.innerHTML = `
                <span class="btn-icon">${btn.icon}</span>
                <span class="btn-label">${btn.label}</span>
                <span class="btn-desc">${btn.desc}</span>`;
            el.addEventListener('click', () => { this.currentView = btn.view; this.render(); });
        }
    }

    renderPendingCard(container, session) {
        const card = container.createDiv({ cls: 'dcl-session-card' });

        const top = card.createDiv({ cls: 'dcl-session-top' });
        const devEl = top.createDiv({ cls: 'dcl-session-device' });
        devEl.innerHTML = `🔌 <span>${session.device || 'Unknown Device'}</span>`;

        top.createEl('span', {
            cls: 'dcl-session-time',
            text: `Started ${session.start_time} on ${session.date}`
        });

        card.createEl('p', {
            cls: 'dcl-session-pct',
            text: `Starting at ${session.start_pct !== '' ? session.start_pct + '%' : '?%'} · ${session.location ? session.location.slice(0,40) + (session.location.length>40?'…':'') : 'No location'}`
        });

        // Elapsed time progress (visual only — from created_at if available)
        if (session.created_at) {
            const elapsed = Math.floor((Date.now() - new Date(session.created_at).getTime()) / 60000);
            const barPct  = Math.min(100, (elapsed / 120) * 100); // cap at 2h for display
            const prog    = card.createDiv({ cls: 'dcl-session-progress' });
            const fill    = prog.createDiv({ cls: 'dcl-session-progress-fill' });
            fill.style.width = `${barPct}%`;
            card.createEl('p', {
                cls: 'dcl-session-pct',
                text: `Elapsed: ~${elapsed < 60 ? elapsed + 'm' : Math.floor(elapsed/60) + 'h ' + (elapsed%60) + 'm'}`
            });
        }

        const acts = card.createDiv({ cls: 'dcl-session-actions' });

        const completeBtn = acts.createEl('button', {
            cls: 'dcl-session-btn dcl-session-btn-complete',
            text: '✅ Complete Session'
        });
        completeBtn.addEventListener('click', () => {
            this.completingSession = session;
            this.currentView = 'complete';
            this.render();
        });

        const discardBtn = acts.createEl('button', {
            cls: 'dcl-session-btn dcl-session-btn-discard',
            text: '🗑 Discard'
        });
        discardBtn.addEventListener('click', () => {
            showConfirm(
                'Discard Session',
                `Discard the pending charge session for "${session.device || 'this device'}"? This cannot be undone.`,
                async () => {
                    await this.plugin.removePendingSession(session.id);
                    showToast('Session discarded', 'info');
                    this.render();
                },
                'Discard', 'dcl-btn-danger'
            );
        });
    }

    // ---- START CHARGING FORM ----
    renderStartForm() {
        const content = this.wrapper.createDiv({ cls: 'dcl-content' });
        content.createEl('button', { cls: 'dcl-back-btn', text: '← Dashboard' })
            .addEventListener('click', () => { this.currentView = 'dashboard'; this.render(); });

        const secHdr = content.createDiv({ cls: 'dcl-section-header' });
        secHdr.createEl('h3', { text: 'Start Charging Session' });
        secHdr.createDiv({ cls: 'dcl-section-divider' });

        const form = content.createDiv({ cls: 'dcl-form-view' });

        // Date & Start Time
        const row1 = form.createDiv({ cls: 'dcl-form-row' });

        const dateGrp = row1.createDiv({ cls: 'dcl-form-group' });
        dateGrp.createEl('label', { cls: 'required', text: 'Date' });
        const dateInput = dateGrp.createEl('input', { cls: 'dcl-input', type: 'date', value: nowDate() });

        const startTimeGrp = row1.createDiv({ cls: 'dcl-form-group' });
        startTimeGrp.createEl('label', { cls: 'required', text: 'Start Charge Time' });
        const startTimeInput = startTimeGrp.createEl('input', { cls: 'dcl-input', type: 'time', value: nowTime() });

        // Device
        const devGrp = form.createDiv({ cls: 'dcl-form-group' });
        devGrp.createEl('label', { cls: 'required', text: 'Device' });
        const devSelect = devGrp.createEl('select', { cls: 'dcl-select' });
        devSelect.createEl('option', { value: '', text: '— Select Device —' });
        if (this.devices.length === 0) {
            devSelect.createEl('option', { value: '__none__', text: `(No devices — add notes to ${FOLDER_DEVICES})` });
            devGrp.createEl('p', { cls: 'dcl-select-note', text: `Add .md files to: ${FOLDER_DEVICES}` });
        } else {
            for (const d of this.devices) devSelect.createEl('option', { value: d, text: d });
        }

        // Starting %
        const startPctGrp = form.createDiv({ cls: 'dcl-form-group' });
        startPctGrp.createEl('label', { text: 'Starting Percentage (%)' });
        const startPctInput = startPctGrp.createEl('input', {
            cls: 'dcl-input', type: 'number'
        });
        startPctInput.setAttribute('min', '0');
        startPctInput.setAttribute('max', '100');
        startPctInput.setAttribute('placeholder', '0–100');

        // Location
        const locGrp = form.createDiv({ cls: 'dcl-form-group' });
        locGrp.createEl('label', { text: 'Location' });
        const locRow = locGrp.createDiv({ cls: 'dcl-location-row' });
        const locInput = locRow.createEl('input', {
            cls: 'dcl-input', type: 'text', placeholder: 'Enter location or use GPS…'
        });
        this.attachGpsBtn(locRow, locInput);

        // Actions
        const actions   = form.createDiv({ cls: 'dcl-form-actions' });
        const cancelBtn = actions.createEl('button', { cls: 'dcl-btn dcl-btn-secondary', text: 'Cancel' });
        cancelBtn.addEventListener('click', () => { this.currentView = 'dashboard'; this.render(); });

        const startBtn = actions.createEl('button', { cls: 'dcl-btn dcl-btn-pending', text: '⚡ Start Session' });
        startBtn.addEventListener('click', async () => {
            const date      = dateInput.value.trim();
            const startTime = startTimeInput.value.trim();
            const device    = devSelect.value === '__none__' ? '' : devSelect.value;

            if (!date || !startTime) { showToast('Date and Start Time are required', 'error'); return; }

            startBtn.disabled = true; startBtn.textContent = 'Starting…';

            const session = {
                device,
                date,
                start_time: startTime,
                start_pct:  startPctInput.value.trim(),
                location:   locInput.value.trim(),
            };

            await this.plugin.addPendingSession(session);
            showToast(`⚡ Session started for ${device || 'device'}`, 'success');
            this.currentView = 'dashboard';
            this.render();
        });
    }

    // ---- COMPLETE SESSION FORM ----
    renderCompleteForm() {
        const session = this.completingSession;
        if (!session) { this.currentView = 'dashboard'; this.render(); return; }

        const content = this.wrapper.createDiv({ cls: 'dcl-content' });
        content.createEl('button', { cls: 'dcl-back-btn', text: '← Dashboard' })
            .addEventListener('click', () => {
                this.completingSession = null;
                this.currentView = 'dashboard';
                this.render();
            });

        const secHdr = content.createDiv({ cls: 'dcl-section-header' });
        secHdr.createEl('h3', { text: 'Complete Charging Session' });
        secHdr.createDiv({ cls: 'dcl-section-divider' });

        // Session summary banner
        const banner = content.createDiv({ cls: 'dcl-edit-banner' });
        banner.textContent = `🔌  ${session.device || 'Device'} — Started ${session.start_time} on ${session.date}`;

        const form = content.createDiv({ cls: 'dcl-form-view' });

        // End Time
        const endTimeGrp = form.createDiv({ cls: 'dcl-form-group' });
        endTimeGrp.createEl('label', { cls: 'required', text: 'End Charge Time' });
        const endTimeInput = endTimeGrp.createEl('input', {
            cls: 'dcl-input', type: 'time', value: nowTime()
        });

        // Ending %
        const endPctGrp = form.createDiv({ cls: 'dcl-form-group' });
        endPctGrp.createEl('label', { text: 'Ending Percentage (%)' });
        const endPctInput = endPctGrp.createEl('input', {
            cls: 'dcl-input', type: 'number'
        });
        endPctInput.setAttribute('min', '0');
        endPctInput.setAttribute('max', '100');
        endPctInput.setAttribute('placeholder', '0–100');

        // Auto-calculated fields
        const calcRow = form.createDiv({ cls: 'dcl-form-row' });

        const durGrp = calcRow.createDiv({ cls: 'dcl-form-group' });
        durGrp.createEl('label', { text: 'Duration' });
        const durInput = durGrp.createEl('input', { cls: 'dcl-input dcl-input-calc', type: 'text', value: '—' });
        durInput.readOnly = true;
        durGrp.createEl('p', { cls: 'dcl-calc-note', text: 'Auto-calculated' });

        const pctChgGrp = calcRow.createDiv({ cls: 'dcl-form-group' });
        pctChgGrp.createEl('label', { text: '% Charged' });
        const pctChgInput = pctChgGrp.createEl('input', { cls: 'dcl-input dcl-input-calc', type: 'text', value: '—' });
        pctChgInput.readOnly = true;
        pctChgGrp.createEl('p', { cls: 'dcl-calc-note', text: 'Auto-calculated' });

        // Live recalculate
        const recalc = () => {
            durInput.value    = calcDuration(session.start_time, endTimeInput.value)    || '—';
            pctChgInput.value = calcPctCharged(session.start_pct, endPctInput.value)    || '—';
        };
        endTimeInput.addEventListener('input', recalc);
        endPctInput.addEventListener('input',  recalc);
        recalc();

        // Comments
        const comGrp = form.createDiv({ cls: 'dcl-form-group' });
        comGrp.createEl('label', { text: 'Comments' });
        const comTextarea = comGrp.createEl('textarea', {
            cls: 'dcl-textarea', placeholder: 'Any additional notes…'
        });

        // Actions
        const actions   = form.createDiv({ cls: 'dcl-form-actions' });
        const cancelBtn = actions.createEl('button', { cls: 'dcl-btn dcl-btn-secondary', text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
            this.completingSession = null;
            this.currentView = 'dashboard';
            this.render();
        });

        const saveBtn = actions.createEl('button', { cls: 'dcl-btn dcl-btn-primary', text: '💾  Save & Complete' });
        saveBtn.addEventListener('click', async () => {
            const endTime = endTimeInput.value.trim();
            if (!endTime) { showToast('End Charge Time is required', 'error'); return; }

            saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

            const entry = {
                date:        session.date,
                device:      session.device,
                start_time:  session.start_time,
                start_pct:   session.start_pct,
                end_time:    endTime,
                end_pct:     endPctInput.value.trim(),
                duration:    calcDuration(session.start_time, endTime),
                pct_charged: calcPctCharged(session.start_pct, endPctInput.value.trim()),
                location:    session.location,
                comments:    comTextarea.value.trim(),
            };

            try {
                await this.plugin.saveEntry(entry, null);
                await this.plugin.removePendingSession(session.id);
                this.entries = await this.plugin.loadAllEntries();
                this.completingSession = null;
                showToast(`✅ Session saved for ${session.device || 'device'}`, 'success');
                this.currentView = 'dashboard';
                this.render();
            } catch(e) {
                showToast(`Error saving: ${e.message}`, 'error');
                saveBtn.disabled = false; saveBtn.textContent = '💾  Save & Complete';
            }
        });
    }

    // ---- MANUAL ENTRY FORM (new + edit) ----
    renderManualForm(isEdit) {
        const entry   = isEdit && this.currentEntry ? this.currentEntry : null;
        const content = this.wrapper.createDiv({ cls: 'dcl-content' });

        content.createEl('button', { cls: 'dcl-back-btn', text: '← Back' })
            .addEventListener('click', () => {
                this.currentView = isEdit ? 'detail' : 'dashboard';
                this.render();
            });

        if (isEdit) content.createDiv({ cls: 'dcl-edit-banner', text: '✏️  Editing existing entry' });

        const form = content.createDiv({ cls: `dcl-form-view${isEdit ? ' dcl-edit-mode' : ''}` });

        const secHdr = form.createDiv({ cls: 'dcl-section-header' });
        secHdr.createEl('h3', { text: isEdit ? 'Edit Entry' : 'Manual Entry' });
        secHdr.createDiv({ cls: 'dcl-section-divider' });

        // Date
        const dateGrp = form.createDiv({ cls: 'dcl-form-group' });
        dateGrp.createEl('label', { cls: 'required', text: 'Date' });
        const dateInput = dateGrp.createEl('input', {
            cls: 'dcl-input', type: 'date',
            value: entry ? entry.date : nowDate()
        });

        // Device
        const devGrp = form.createDiv({ cls: 'dcl-form-group' });
        devGrp.createEl('label', { cls: 'required', text: 'Device' });
        const devSelect = devGrp.createEl('select', { cls: 'dcl-select' });
        devSelect.createEl('option', { value: '', text: '— Select Device —' });
        if (this.devices.length === 0) {
            devSelect.createEl('option', { value: '__none__', text: `(No devices — add notes to ${FOLDER_DEVICES})` });
            devGrp.createEl('p', { cls: 'dcl-select-note', text: `Add .md files to: ${FOLDER_DEVICES}` });
        } else {
            for (const d of this.devices) {
                const o = devSelect.createEl('option', { value: d, text: d });
                if (entry && entry.device === d) o.selected = true;
            }
        }

        // Start Time & Start %
        const row1 = form.createDiv({ cls: 'dcl-form-row' });

        const stGrp = row1.createDiv({ cls: 'dcl-form-group' });
        stGrp.createEl('label', { text: 'Start Charge Time' });
        const startTimeInput = stGrp.createEl('input', {
            cls: 'dcl-input', type: 'time',
            value: entry ? entry.start_time : ''
        });

        const spGrp = row1.createDiv({ cls: 'dcl-form-group' });
        spGrp.createEl('label', { text: 'Starting %' });
        const startPctInput = spGrp.createEl('input', { cls: 'dcl-input', type: 'number' });
        startPctInput.setAttribute('min','0'); startPctInput.setAttribute('max','100');
        startPctInput.setAttribute('placeholder','0–100');
        if (entry && entry.start_pct !== '') startPctInput.value = entry.start_pct;

        // End Time & End %
        const row2 = form.createDiv({ cls: 'dcl-form-row' });

        const etGrp = row2.createDiv({ cls: 'dcl-form-group' });
        etGrp.createEl('label', { text: 'End Charge Time' });
        const endTimeInput = etGrp.createEl('input', {
            cls: 'dcl-input', type: 'time',
            value: entry ? entry.end_time : ''
        });

        const epGrp = row2.createDiv({ cls: 'dcl-form-group' });
        epGrp.createEl('label', { text: 'Ending %' });
        const endPctInput = epGrp.createEl('input', { cls: 'dcl-input', type: 'number' });
        endPctInput.setAttribute('min','0'); endPctInput.setAttribute('max','100');
        endPctInput.setAttribute('placeholder','0–100');
        if (entry && entry.end_pct !== '') endPctInput.value = entry.end_pct;

        // Calculated fields (read-only)
        const row3 = form.createDiv({ cls: 'dcl-form-row' });

        const durGrp = row3.createDiv({ cls: 'dcl-form-group' });
        durGrp.createEl('label', { text: 'Duration' });
        const durInput = durGrp.createEl('input', {
            cls: 'dcl-input dcl-input-calc', type: 'text',
            value: entry ? entry.duration : '—'
        });
        durInput.readOnly = true;
        durGrp.createEl('p', { cls: 'dcl-calc-note', text: 'Auto-calculated' });

        const pctChgGrp = row3.createDiv({ cls: 'dcl-form-group' });
        pctChgGrp.createEl('label', { text: '% Charged' });
        const pctChgInput = pctChgGrp.createEl('input', {
            cls: 'dcl-input dcl-input-calc', type: 'text',
            value: entry ? entry.pct_charged : '—'
        });
        pctChgInput.readOnly = true;
        pctChgGrp.createEl('p', { cls: 'dcl-calc-note', text: 'Auto-calculated' });

        // Live recalculate on any time/pct change
        const recalc = () => {
            durInput.value    = calcDuration(startTimeInput.value, endTimeInput.value)    || '—';
            pctChgInput.value = calcPctCharged(startPctInput.value, endPctInput.value)    || '—';
        };
        startTimeInput.addEventListener('input', recalc);
        endTimeInput.addEventListener('input',   recalc);
        startPctInput.addEventListener('input',  recalc);
        endPctInput.addEventListener('input',    recalc);

        // Location
        const locGrp = form.createDiv({ cls: 'dcl-form-group' });
        locGrp.createEl('label', { text: 'Location' });
        const locRow = locGrp.createDiv({ cls: 'dcl-location-row' });
        const locInput = locRow.createEl('input', {
            cls: 'dcl-input', type: 'text',
            placeholder: 'Enter location or use GPS…',
            value: entry ? entry.location : ''
        });
        this.attachGpsBtn(locRow, locInput);

        // Comments
        const comGrp = form.createDiv({ cls: 'dcl-form-group' });
        comGrp.createEl('label', { text: 'Comments' });
        const comTextarea = comGrp.createEl('textarea', {
            cls: 'dcl-textarea', placeholder: 'Any additional notes…'
        });
        if (entry && entry.comments) comTextarea.value = entry.comments;

        // Sticky actions
        const actions   = form.createDiv({ cls: 'dcl-form-actions' });
        const cancelBtn = actions.createEl('button', { cls: 'dcl-btn dcl-btn-secondary', text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
            this.currentView = isEdit ? 'detail' : 'dashboard'; this.render();
        });

        const saveBtn = actions.createEl('button', {
            cls: 'dcl-btn dcl-btn-primary',
            text: isEdit ? '💾  Save Changes' : '💾  Save Entry'
        });
        saveBtn.addEventListener('click', async () => {
            const date = dateInput.value.trim();
            if (!date) { showToast('Date is required', 'error'); return; }

            saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

            const devVal = devSelect.value === '__none__' ? '' : devSelect.value;
            const newEntry = {
                date,
                device:      devVal,
                start_time:  startTimeInput.value.trim(),
                start_pct:   startPctInput.value.trim(),
                end_time:    endTimeInput.value.trim(),
                end_pct:     endPctInput.value.trim(),
                duration:    calcDuration(startTimeInput.value.trim(), endTimeInput.value.trim()),
                pct_charged: calcPctCharged(startPctInput.value.trim(), endPctInput.value.trim()),
                location:    locInput.value.trim(),
                comments:    comTextarea.value.trim(),
            };

            try {
                const oldFilename   = isEdit && entry ? entry.filename : null;
                const savedFilename = await this.plugin.saveEntry(newEntry, oldFilename);
                newEntry.filename   = savedFilename;
                this.entries        = await this.plugin.loadAllEntries();
                showToast(isEdit ? '✅ Entry updated!' : '✅ Entry saved!', 'success');
                if (isEdit) { this.currentEntry = newEntry; this.currentView = 'detail'; }
                else          this.currentView = 'dashboard';
                this.render();
            } catch(e) {
                showToast(`Error saving: ${e.message}`, 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = isEdit ? '💾  Save Changes' : '💾  Save Entry';
            }
        });
    }

    // ---- GPS helper (shared by start form & manual form) ----
    attachGpsBtn(container, inputEl) {
        const gpsBtn = container.createEl('button', { cls: 'dcl-location-btn', text: '📍' });
        gpsBtn.setAttribute('title', 'Get current location');
        gpsBtn.addEventListener('click', () => {
            gpsBtn.textContent = '⏳'; gpsBtn.disabled = true;
            if (!navigator.geolocation) {
                showToast('Geolocation not available', 'error');
                gpsBtn.textContent = '📍'; gpsBtn.disabled = false; return;
            }
            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    const lat = pos.coords.latitude.toFixed(5);
                    const lon = pos.coords.longitude.toFixed(5);
                    try {
                        const resp = await fetch(
                            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16`,
                            { headers: { 'Accept-Language': 'en' } }
                        );
                        const geo = await resp.json();
                        inputEl.value = (geo && geo.display_name) ? geo.display_name : `${lat}, ${lon}`;
                    } catch(e) { inputEl.value = `${lat}, ${lon}`; }
                    gpsBtn.textContent = '✅'; gpsBtn.disabled = false;
                    showToast('Location acquired', 'success');
                },
                (err) => {
                    showToast(`Location error: ${err.message}`, 'error');
                    gpsBtn.textContent = '📍'; gpsBtn.disabled = false;
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        });
    }

    // ---- ENTRIES TABLE ----
    renderEntries() {
        const content = this.wrapper.createDiv({ cls: 'dcl-content' });
        content.createEl('button', { cls: 'dcl-back-btn', text: '← Dashboard' })
            .addEventListener('click', () => { this.currentView = 'dashboard'; this.render(); });

        const secHdr = content.createDiv({ cls: 'dcl-section-header' });
        secHdr.createEl('h3', { text: 'All Sessions' });
        secHdr.createDiv({ cls: 'dcl-section-divider' });

        const sfRow = content.createDiv({ cls: 'dcl-search-filter-row' });
        const searchInput = sfRow.createEl('input', { cls: 'dcl-search-input', type: 'search', placeholder: '🔍 Search…' });
        searchInput.value = this.searchQuery;

        const filterSelect = sfRow.createEl('select', { cls: 'dcl-filter-select' });
        filterSelect.createEl('option', { value: 'all', text: 'All Devices' });
        const uniqueDevices = [...new Set(this.entries.map(e => e.device).filter(Boolean))].sort();
        for (const d of uniqueDevices) {
            const o = filterSelect.createEl('option', { value: d, text: d.length > 14 ? d.slice(0,12)+'…' : d });
            if (this.filterDevice === d) o.selected = true;
        }
        if (this.filterDevice === 'all') filterSelect.value = 'all';

        const tableWrap = content.createDiv({ cls: 'dcl-entries-view' });
        const countEl   = content.createEl('p', { cls: 'dcl-entries-count' });
        const paginWrap = content.createDiv({ cls: 'dcl-pagination' });

        const refresh = () => { this.applyFilters(); this.renderEntriesTable(tableWrap, countEl, paginWrap); };

        searchInput.addEventListener('input', () => {
            this.searchQuery = searchInput.value; this.currentPage = 0; refresh();
        });
        filterSelect.addEventListener('change', () => {
            this.filterDevice = filterSelect.value; this.currentPage = 0; refresh();
        });

        this.applyFilters();
        this.renderEntriesTable(tableWrap, countEl, paginWrap);
    }

    applyFilters() {
        let result = [...this.entries];
        if (this.filterDevice !== 'all') result = result.filter(e => e.device === this.filterDevice);
        if (this.searchQuery.trim()) {
            const q = this.searchQuery.toLowerCase();
            result  = result.filter(e =>
                e.date.includes(q)               ||
                e.device.toLowerCase().includes(q)||
                e.start_time.includes(q)         ||
                e.end_time.includes(q)           ||
                e.duration.toLowerCase().includes(q)   ||
                e.pct_charged.toLowerCase().includes(q)||
                e.location.toLowerCase().includes(q)   ||
                e.comments.toLowerCase().includes(q)
            );
        }
        this.filteredEntries = result;
    }

    renderEntriesTable(container, countEl, paginWrap) {
        container.empty(); paginWrap.empty();

        const total      = this.filteredEntries.length;
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (this.currentPage >= totalPages) this.currentPage = 0;

        const pageEntries = this.filteredEntries.slice(this.currentPage * PAGE_SIZE, (this.currentPage + 1) * PAGE_SIZE);
        countEl.textContent = `Showing ${pageEntries.length} of ${total} sessions`;

        if (total === 0) {
            const empty = container.createDiv({ cls: 'dcl-empty-state' });
            empty.createEl('span', { cls: 'empty-icon', text: '🔋' });
            empty.createEl('p', { text: 'No sessions found' });
            return;
        }

        const tableWrap = container.createDiv({ cls: 'dcl-table-wrap' });
        const table     = tableWrap.createEl('table', { cls: 'dcl-table' });
        const hrow      = table.createEl('thead').createEl('tr');
        for (const h of ['Date', 'Device', 'Start → End', 'Duration', '% Gained'])
            hrow.createEl('th', { text: h });

        const tbody = table.createEl('tbody');
        for (const entry of pageEntries) {
            const tr = tbody.createEl('tr');

            tr.createEl('td', { text: formatDateShort(entry.date) });

            const devTd = tr.createEl('td');
            if (entry.device) {
                devTd.createEl('span', { cls: `dcl-badge ${deviceBadgeClass(entry.device)}`, text: entry.device });
            } else {
                devTd.createEl('span', { cls: 'dcl-badge dcl-badge-none', text: '—' });
            }

            // Start pct → End pct + times
            const timeTd = tr.createEl('td');
            const startStr = entry.start_time ? `${entry.start_time}${entry.start_pct !== '' ? ' ('+entry.start_pct+'%)' : ''}` : '—';
            const endStr   = entry.end_time   ? `${entry.end_time}${entry.end_pct   !== '' ? ' ('+entry.end_pct+'%)'   : ''}` : '—';
            timeTd.textContent = `${startStr} → ${endStr}`;
            timeTd.style.fontSize = '10px';
            timeTd.style.color = 'var(--text-muted)';

            tr.createEl('td', { text: entry.duration || '—' });

            const pctTd = tr.createEl('td');
            if (entry.pct_charged) {
                const cls = entry.end_pct ? pctBadgeClass(entry.end_pct) : '';
                pctTd.createEl('span', { cls: `dcl-badge ${cls}`, text: entry.pct_charged });
            } else {
                pctTd.textContent = '—';
            }

            tr.addEventListener('click', () => {
                this.currentEntry = entry; this.currentView = 'detail'; this.render();
            });
        }

        if (totalPages > 1) {
            const prevBtn = paginWrap.createEl('button', { cls: 'dcl-page-btn', text: '← Prev' });
            if (this.currentPage === 0) prevBtn.disabled = true;
            prevBtn.addEventListener('click', () => { this.currentPage--; this.renderEntriesTable(container, countEl, paginWrap); });

            paginWrap.createEl('span', { cls: 'dcl-page-info', text: `Page ${this.currentPage+1} of ${totalPages}` });

            const nextBtn = paginWrap.createEl('button', { cls: 'dcl-page-btn', text: 'Next →' });
            if (this.currentPage >= totalPages - 1) nextBtn.disabled = true;
            nextBtn.addEventListener('click', () => { this.currentPage++; this.renderEntriesTable(container, countEl, paginWrap); });
        }
    }

    // ---- DETAIL ----
    renderDetail() {
        const entry = this.currentEntry;
        if (!entry) { this.currentView = 'entries'; this.render(); return; }

        const content = this.wrapper.createDiv({ cls: 'dcl-content' });
        content.createEl('button', { cls: 'dcl-back-btn', text: '← Sessions' })
            .addEventListener('click', () => { this.currentView = 'entries'; this.render(); });

        const secHdr = content.createDiv({ cls: 'dcl-section-header' });
        secHdr.createEl('h3', { text: 'Session Detail' });
        secHdr.createDiv({ cls: 'dcl-section-divider' });

        const card   = content.createDiv({ cls: 'dcl-detail-card dcl-detail-view' });
        const fields = [
            { label: 'Date',        value: entry.date },
            { label: 'Device',      value: entry.device || '—', devBadge: !!entry.device },
            { label: 'Start Time',  value: entry.start_time || '—' },
            { label: 'Starting %',  value: entry.start_pct !== '' ? entry.start_pct + '%' : '—' },
            { label: 'End Time',    value: entry.end_time || '—' },
            { label: 'Ending %',    value: entry.end_pct  !== '' ? entry.end_pct  + '%' : '—', pctBadge: entry.end_pct !== '' },
            { label: 'Duration',    value: entry.duration    || '—' },
            { label: '% Charged',   value: entry.pct_charged || '—' },
            { label: 'Location',    value: entry.location    || '—' },
            { label: 'Comments',    value: entry.comments    || '—' },
            { label: 'File',        value: entry.filename },
        ];

        for (const f of fields) {
            const row   = card.createDiv({ cls: 'dcl-detail-row' });
            row.createEl('span', { cls: 'dcl-detail-label', text: f.label });
            const valEl = row.createEl('span', { cls: 'dcl-detail-value' });
            if (f.devBadge) {
                valEl.createEl('span', { cls: `dcl-badge ${deviceBadgeClass(f.value)}`, text: f.value });
            } else if (f.pctBadge) {
                valEl.createEl('span', { cls: `dcl-badge ${pctBadgeClass(entry.end_pct)}`, text: f.value });
            } else {
                valEl.textContent = f.value;
            }
        }

        const actions = content.createDiv({ cls: 'dcl-form-actions' });
        actions.createEl('button', { cls: 'dcl-btn dcl-btn-danger', text: '🗑️  Delete' })
            .addEventListener('click', () => {
                showConfirm('Delete Session', 'This session will be permanently deleted. Are you sure?', async () => {
                    await this.plugin.deleteEntry(entry.filename);
                    this.entries      = await this.plugin.loadAllEntries();
                    this.currentEntry = null;
                    this.currentView  = 'entries';
                    this.applyFilters();
                    showToast('Session deleted', 'info');
                    this.render();
                });
            });

        actions.createEl('button', { cls: 'dcl-btn dcl-btn-primary', text: '✏️  Edit' })
            .addEventListener('click', () => { this.currentView = 'edit'; this.render(); });
    }

    // ---- CHARTS ----
    renderCharts() {
        const content = this.wrapper.createDiv({ cls: 'dcl-content' });
        content.createEl('button', { cls: 'dcl-back-btn', text: '← Dashboard' })
            .addEventListener('click', () => { this.currentView = 'dashboard'; this.render(); });

        const secHdr = content.createDiv({ cls: 'dcl-section-header' });
        secHdr.createEl('h3', { text: 'Statistics & Charts' });
        secHdr.createDiv({ cls: 'dcl-section-divider' });

        if (this.entries.length === 0) {
            const empty = content.createDiv({ cls: 'dcl-empty-state' });
            empty.createEl('span', { cls: 'empty-icon', text: '📊' });
            empty.createEl('p', { text: 'No data yet. Log some sessions to see charts!' });
            return;
        }

        this.renderDeviceDonut(content);
        this.renderAvgPctGainedBar(content);
        this.renderAvgDurationBar(content);
        this.renderDailyBar(content);
        this.renderActivityHeatmap(content);
    }

    renderDeviceDonut(container) {
        const card = container.createDiv({ cls: 'dcl-chart-card' });
        card.createEl('h4', { text: '📱 Sessions by Device' });

        const counts = {};
        for (const e of this.entries) if (e.device) counts[e.device] = (counts[e.device]||0)+1;
        const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0, 8);
        const total  = this.entries.length || 1;
        if (sorted.length === 0) { card.createEl('p', { text: 'No device data yet.' }); return; }

        const wrap = card.createDiv({ cls: 'dcl-donut-wrap' });
        const r = 36, cx = 50, cy = 50, circ = 2 * Math.PI * r;

        const svg = wrap.createSvg('svg', { cls: 'dcl-donut-svg' });
        svg.setAttribute('width','100'); svg.setAttribute('height','100'); svg.setAttribute('viewBox','0 0 100 100');

        const bgC = svg.createSvg('circle');
        bgC.setAttribute('cx',cx); bgC.setAttribute('cy',cy); bgC.setAttribute('r',r);
        bgC.setAttribute('fill','none'); bgC.setAttribute('stroke','var(--background-modifier-border)'); bgC.setAttribute('stroke-width','14');

        let offset = 0;
        for (const [label, count] of sorted) {
            const dash = circ * (count / total);
            const c    = svg.createSvg('circle');
            c.setAttribute('cx',cx); c.setAttribute('cy',cy); c.setAttribute('r',r);
            c.setAttribute('fill','none'); c.setAttribute('stroke', deviceColor(label)); c.setAttribute('stroke-width','14');
            c.setAttribute('stroke-dasharray', `${dash} ${circ - dash}`);
            c.setAttribute('stroke-dashoffset', -offset);
            c.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
            offset += dash;
        }

        const ct = svg.createSvg('text');
        ct.setAttribute('x',cx); ct.setAttribute('y',cy+4); ct.setAttribute('text-anchor','middle');
        ct.setAttribute('font-size','14'); ct.setAttribute('font-weight','700'); ct.setAttribute('fill','var(--text-normal)');
        ct.textContent = total;

        const legend = wrap.createDiv({ cls: 'dcl-donut-legend' });
        for (const [label, count] of sorted) {
            const item = legend.createDiv({ cls: 'dcl-legend-item' });
            item.createDiv({ cls: 'dcl-legend-dot' }).style.background = deviceColor(label);
            item.createEl('span', { cls: 'dcl-legend-item-label', text: label });
            item.createEl('span', { cls: 'dcl-legend-item-val',   text: String(count) });
        }
    }

    renderAvgPctGainedBar(container) {
        const card = container.createDiv({ cls: 'dcl-chart-card' });
        card.createEl('h4', { text: '⚡ Avg % Gained by Device' });

        // Group entries by device, compute average pct_charged
        const totals = {}, counts = {};
        for (const e of this.entries) {
            if (!e.device || !e.pct_charged) continue;
            const n = parseInt(e.pct_charged.replace(/[^-\d]/g,''), 10);
            if (isNaN(n)) continue;
            totals[e.device] = (totals[e.device]||0) + n;
            counts[e.device] = (counts[e.device]||0) + 1;
        }
        const avgs = Object.keys(totals).map(d => ({ device: d, avg: Math.round(totals[d] / counts[d]) }))
            .sort((a,b) => b.avg - a.avg).slice(0, 8);

        if (avgs.length === 0) { card.createEl('p', { text: 'Not enough data yet.' }); return; }

        const maxVal = Math.max(...avgs.map(a => a.avg), 1);
        const chart  = card.createDiv({ cls: 'dcl-bar-chart' });
        for (const { device, avg } of avgs) {
            const row  = chart.createDiv({ cls: 'dcl-bar-row' });
            row.createEl('span', { cls: 'dcl-bar-label', text: device });
            const fill = row.createDiv({ cls: 'dcl-bar-track' }).createDiv({ cls: 'dcl-bar-fill' });
            fill.style.width      = `${(avg / maxVal * 100).toFixed(0)}%`;
            fill.style.background = deviceColor(device);
            fill.createEl('span', { text: `${avg}%` });
            row.createEl('span', { cls: 'dcl-bar-value', text: `${avg}%` });
        }
    }

    renderAvgDurationBar(container) {
        const card = container.createDiv({ cls: 'dcl-chart-card' });
        card.createEl('h4', { text: '⏱️ Avg Duration by Device (min)' });

        // Parse duration strings to minutes
        const parseDuration = (d) => {
            if (!d) return null;
            const hm = d.match(/(\d+)h\s*(\d+)m/);
            const h  = d.match(/^(\d+)h$/);
            const m  = d.match(/^(\d+)m$/);
            if (hm) return parseInt(hm[1])*60 + parseInt(hm[2]);
            if (h)  return parseInt(h[1])*60;
            if (m)  return parseInt(m[1]);
            return null;
        };

        const totals = {}, counts = {};
        for (const e of this.entries) {
            if (!e.device || !e.duration) continue;
            const mins = parseDuration(e.duration);
            if (mins === null) continue;
            totals[e.device] = (totals[e.device]||0) + mins;
            counts[e.device] = (counts[e.device]||0) + 1;
        }
        const avgs = Object.keys(totals).map(d => ({ device: d, avg: Math.round(totals[d] / counts[d]) }))
            .sort((a,b) => b.avg - a.avg).slice(0, 8);

        if (avgs.length === 0) { card.createEl('p', { text: 'Not enough data yet.' }); return; }

        const maxVal = Math.max(...avgs.map(a => a.avg), 1);
        const chart  = card.createDiv({ cls: 'dcl-bar-chart' });
        for (const { device, avg } of avgs) {
            const label = avg >= 60 ? `${Math.floor(avg/60)}h ${avg%60}m` : `${avg}m`;
            const row   = chart.createDiv({ cls: 'dcl-bar-row' });
            row.createEl('span', { cls: 'dcl-bar-label', text: device });
            const fill  = row.createDiv({ cls: 'dcl-bar-track' }).createDiv({ cls: 'dcl-bar-fill' });
            fill.style.width      = `${(avg / maxVal * 100).toFixed(0)}%`;
            fill.style.background = '#1e40af';
            fill.createEl('span', { text: label });
            row.createEl('span', { cls: 'dcl-bar-value', text: label });
        }
    }

    renderDailyBar(container) {
        const card  = container.createDiv({ cls: 'dcl-chart-card' });
        card.createEl('h4', { text: '📅 Sessions – Last 7 Days' });

        const today = new Date();
        const days  = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(today); d.setDate(today.getDate() - (6 - i));
            const str = `${d.getFullYear()}-${padZ(d.getMonth()+1)}-${padZ(d.getDate())}`;
            return { date: str, label: formatDateShort(str) };
        });

        const maxVal = Math.max(...days.map(d => this.entries.filter(e => e.date === d.date).length), 1);
        const chart  = card.createDiv({ cls: 'dcl-bar-chart' });
        for (const day of days) {
            const count = this.entries.filter(e => e.date === day.date).length;
            const row   = chart.createDiv({ cls: 'dcl-bar-row' });
            row.createEl('span', { cls: 'dcl-bar-label', text: day.label });
            const fill  = row.createDiv({ cls: 'dcl-bar-track' }).createDiv({ cls: 'dcl-bar-fill' });
            fill.style.width      = `${(count / maxVal * 100).toFixed(0)}%`;
            fill.style.background = '#1d4ed8';
            if (count > 0) fill.createEl('span', { text: String(count) });
            row.createEl('span', { cls: 'dcl-bar-value', text: String(count) });
        }
    }

    renderActivityHeatmap(container) {
        const card = container.createDiv({ cls: 'dcl-chart-card' });
        card.createEl('h4', { text: '🗓️ Activity Heatmap – Last 8 Weeks' });

        const today = new Date();
        const start = new Date(today); start.setDate(today.getDate() - 55);

        const weeks = [];
        let current = new Date(start);
        while (current <= today) {
            const week = [];
            for (let d = 0; d < 7 && current <= today; d++) {
                const str = `${current.getFullYear()}-${padZ(current.getMonth()+1)}-${padZ(current.getDate())}`;
                week.push({ date: str, count: this.entries.filter(e => e.date === str).length });
                const nxt = new Date(current); nxt.setDate(current.getDate() + 1); current = nxt;
            }
            weeks.push(week);
        }

        const heatmap = card.createDiv({ cls: 'dcl-heatmap' });
        for (const week of weeks) {
            const col = heatmap.createDiv({ cls: 'dcl-heatmap-col' });
            col.createEl('span', { cls: 'dcl-heatmap-label', text: week[0]?.date.slice(5) || '' });
            for (const cell of week) {
                const el = col.createDiv({ cls: 'dcl-heatmap-cell' });
                if (cell.count > 0) el.setAttribute('data-count', String(Math.min(cell.count, 5)));
                el.setAttribute('title', `${cell.date}: ${cell.count} sessions`);
            }
        }
    }

    // ---- DATA MANAGEMENT ----
    renderDataMgmt() {
        const content = this.wrapper.createDiv({ cls: 'dcl-content' });
        content.createEl('button', { cls: 'dcl-back-btn', text: '← Dashboard' })
            .addEventListener('click', () => { this.currentView = 'dashboard'; this.render(); });

        const secHdr = content.createDiv({ cls: 'dcl-section-header' });
        secHdr.createEl('h3', { text: 'Data Management' });
        secHdr.createDiv({ cls: 'dcl-section-divider' });

        // Export
        const exportSec = content.createDiv({ cls: 'dcl-mgmt-section' });
        exportSec.createEl('h4').textContent = '📤 Export Data';
        exportSec.createEl('p', { text: `Export all ${this.entries.length} sessions to CSV in: ${LOG_FOLDER}/export_YYYY-MM-DD.csv` });
        const exportBtn = exportSec.createEl('button', {
            cls: 'dcl-btn dcl-btn-success',
            text: `📤  Export ${this.entries.length} Sessions to CSV`
        });
        exportBtn.style.width = '100%';
        exportBtn.addEventListener('click', async () => {
            if (this.entries.length === 0) { showToast('No sessions to export', 'error'); return; }
            exportBtn.disabled = true; exportBtn.textContent = 'Exporting…';
            try {
                const fp = await this.plugin.exportCSV(this.entries);
                showToast(`✅ Exported to: ${fp}`, 'success', 4000);
            } catch(e) { showToast(`Export failed: ${e.message}`, 'error'); }
            exportBtn.disabled = false;
            exportBtn.textContent = `📤  Export ${this.entries.length} Sessions to CSV`;
        });

        // Import
        const importSec = content.createDiv({ cls: 'dcl-mgmt-section' });
        importSec.createEl('h4').textContent = '📥 Import Data';
        importSec.createEl('p', { text: 'Import from CSV. Expected columns: Date, Device, Start Time, Start %, End Time, End %, Duration, % Charged, Location, Comments.' });
        const fileWrap  = importSec.createDiv({ cls: 'dcl-file-input-wrap' });
        const fileInput = fileWrap.createEl('input', { type: 'file' });
        fileInput.setAttribute('accept', '.csv,text/csv');
        const fileLabel = fileWrap.createEl('label', { cls: 'dcl-file-label' });
        fileLabel.textContent = '📁 Tap to choose a CSV file';

        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0]; if (!file) return;
            fileLabel.textContent = `⏳ Importing ${file.name}…`;
            const reader = new FileReader();
            reader.onload = async (evt) => {
                try {
                    const count = await this.plugin.importCSV(evt.target.result);
                    this.entries = await this.plugin.loadAllEntries();
                    this.applyFilters();
                    showToast(`✅ Imported ${count} sessions`, 'success', 4000);
                    fileLabel.textContent = `✅ Imported ${count} sessions from ${file.name}`;
                    this.render();
                } catch(e) {
                    showToast(`Import failed: ${e.message}`, 'error');
                    fileLabel.textContent = '❌ Import failed. Try again.';
                }
            };
            reader.onerror = () => { showToast('Failed to read file', 'error'); fileLabel.textContent = '📁 Tap to choose a CSV file'; };
            reader.readAsText(file);
        });

        // Device source info
        const srcSec = content.createDiv({ cls: 'dcl-mgmt-section' });
        srcSec.createEl('h4').textContent = '📂 Device Dropdown Source';
        srcSec.createEl('p', { text: 'Add a .md file to this folder to add a device option. The file name becomes the dropdown label.' });
        const srcRow = srcSec.createDiv({ cls: 'dcl-detail-row' });
        srcRow.createEl('span', { cls: 'dcl-detail-label', text: 'Devices' });
        const srcVal = srcRow.createEl('span', { cls: 'dcl-detail-value' });
        srcVal.innerHTML = `<small style="color:var(--text-muted);font-size:10px">${FOLDER_DEVICES}</small><br><strong>${this.devices.length} devices loaded</strong>`;

        // Stats
        const statsSec = content.createDiv({ cls: 'dcl-mgmt-section' });
        statsSec.createEl('h4').textContent = '📊 Storage Info';
        const s = this.computeStats();
        for (const row of [
            { label: 'Total sessions',  value: s.total },
            { label: 'Today',           value: s.today },
            { label: 'Pending',         value: s.pending },
            { label: 'This week',       value: s.thisWeek },
            { label: 'Top device',      value: s.topDevice },
            { label: 'Storage folder',  value: LOG_FOLDER },
        ]) {
            const r = statsSec.createDiv({ cls: 'dcl-detail-row' });
            r.createEl('span', { cls: 'dcl-detail-label', text: row.label });
            r.createEl('span', { cls: 'dcl-detail-value', text: String(row.value) });
        }
    }
}

module.exports = DeviceChargeLogPlugin;
