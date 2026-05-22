// ── Column indices in the input CSV (0-based) ──────────────────────────────
// Approved in NS | Event Created | Event Complete | Event Reported |
// Primary Contact Email | Name on F2F Account | Store Name | Store Address |
// City | Store Website | How Did You Find Us? | Plus Kit | Base Kit |
// Event Format | Date of Event | Org ID | Free Kit? | Order# | NS OK | Sam Notes
const COL = {
APPROVED:     0,
CREATED:      1,
COMPLETE:     2,
REPORTED:     3,
EMAIL:        4,
NAME:         5,
STORE:        6,
ADDRESS:      7,
CITY:         8,
WEBSITE:      9,
HOW_FOUND:    10,
PLUS_KIT:     11,
BASE_KIT:     12,
FORMAT:       13,
DATE:         14,
ORG_ID:       15,
FREE_KIT:     16,
ORDER:        17,
NS_OK:        18,
};

let outputRows = [];

// ── Helpers ────────────────────────────────────────────────────────────────

function clean(s) {
return (s || '').trim();
}

function parseDate(raw) {
// Accepts DD/MM/YYYY or MM/DD/YYYY or YYYY-MM-DD
raw = clean(raw);
if (!raw) return null;

let d, m, y;

if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
[y, m, d] = raw.split('-').map(Number);
} else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
// Treat as DD/MM/YYYY (F2F export style)
const parts = raw.split('/');
d = parseInt(parts[0], 10);
m = parseInt(parts[1], 10);
y = parseInt(parts[2], 10);
} else {
return null;
}

if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
const dt = new Date(Date.UTC(y, m - 1, d));
if (isNaN(dt)) return null;
return dt;
}

function formatDate(dt) {
// The Events Calendar expects MM/DD/YYYY
const y = dt.getUTCFullYear();
const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
const d = String(dt.getUTCDate()).padStart(2, '0');
return `${m}/${d}/${y}`;
}

function addHours(dt, h) {
return new Date(dt.getTime() + h * 3600 * 1000);
}

function isTrue(v) {
return clean(v).toUpperCase() === 'TRUE';
}

function buildEventName(prefix, format, store, inviteLabel) {
// Format: "F2F Tour Modern Qualifier – 401 Games Downtown (4 Invites Available)"
const f = format || 'TBD';
return `${prefix} ${f} Qualifier \u2013 ${store} (${inviteLabel})`;
}

function buildCategories(roundName, plusKit, freeKit, plusLabel, baseLabel) {
const cats = [roundName];
if (plusKit) {
cats.push(plusLabel);
} else {
// base kit or free kit
cats.push(baseLabel);
}
return cats.join(',');
}

function buildTags(format) {
// Tag by format: Modern, Sealed, Pioneer, Standard, etc.
const f = clean(format);
return f || '';
}

function normalizeWebsite(raw) {
raw = clean(raw);
if (!raw) return '';
// Strip markdown link syntax: [text](url) → url
const mdMatch = raw.match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
if (mdMatch) raw = mdMatch[1];
// Also handle bare markdown without protocol in the parens
const mdBare = raw.match(/\[.*?\]\(([^)]+)\)/);
if (mdBare) raw = mdBare[1];
if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
return raw;
}

function isWebsiteLike(raw) {
const s = clean(raw).toLowerCase();
if (!s) return false;
if (s.startsWith('http://') || s.startsWith('https://')) return true;
// bare domains like example.com or sub.domain.ca/path
return /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s);
}

function resolveRowFields(row) {
const legacy = {
    store: clean(row[COL.STORE]),
    city: clean(row[COL.CITY]),
    website: clean(row[COL.WEBSITE]),
};

const alt = {
    store: clean(row[4]),
    city: clean(row[6]),
    website: clean(row[7]),
};

let legacyScore = 0;
let altScore = 0;

if (legacy.store) legacyScore++;
if (isWebsiteLike(legacy.website)) legacyScore++;
if (parseDate(clean(row[COL.DATE] || ''))) legacyScore++;
if (clean(row[COL.HOW_FOUND]) && !/^\d+$/.test(clean(row[COL.HOW_FOUND]))) legacyScore++;

if (alt.store) altScore++;
if (isWebsiteLike(alt.website)) altScore++;
if (parseDate(clean(row[12] || ''))) altScore++;
if (/^\d+$/.test(clean(row[9] || ''))) altScore++;

if (altScore > legacyScore) {
    return alt;
}
return legacy;
}

function isPlusKitValue(v) {
const s = clean(v).toLowerCase();
return s.includes('plus');
}

function uniqueEvents(events) {
const seen = new Set();
return events.filter(e => {
const key = [
    e.date ? e.date.toISOString().slice(0, 10) : '',
    clean(e.format).toLowerCase(),
    e.isPlusKit ? 'plus' : 'base'
].join('|');
if (seen.has(key)) return false;
seen.add(key);
return true;
});
}

function extractEventsFromRow(row) {
const events = [];

// Legacy export layout (fixed columns)
const legacyDate = parseDate(clean(row[COL.DATE] || ''));
if (legacyDate) {
const legacyPlus = !!clean(row[COL.PLUS_KIT]);
const legacyBase = !!clean(row[COL.BASE_KIT]);
events.push({
    date: legacyDate,
    format: clean(row[COL.FORMAT]),
    isPlusKit: legacyPlus || isPlusKitValue(row[COL.BASE_KIT]),
    isFreeKit: isTrue(row[COL.FREE_KIT]),
    hasKit: legacyPlus || legacyBase,
});
}

// Alternate qualifier form layout: repeating [Kit, Format, Date] groups
for (let i = 10; i <= row.length - 3; i++) {
const date = parseDate(clean(row[i + 2] || ''));
if (!date) continue;

const kitRaw = clean(row[i]);
const formatRaw = clean(row[i + 1]);
events.push({
    date,
    format: formatRaw,
    isPlusKit: isPlusKitValue(kitRaw),
    isFreeKit: false,
    hasKit: !!kitRaw,
});
}

return uniqueEvents(events);
}

// ── CSV parsing (handles quoted fields) ───────────────────────────────────

function parseCSVLine(line, delim) {
const result = [];
let cur = '';
let inQuote = false;
for (let i = 0; i < line.length; i++) {
const ch = line[i];
if (ch === '"') {
    if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
    else { inQuote = !inQuote; }
} else if (ch === delim && !inQuote) {
    result.push(cur); cur = '';
} else {
    cur += ch;
}
}
result.push(cur);
return result;
}

function parseCSV(text) {
// Some pasted inputs can accidentally merge two submissions on one line.
// Insert a line break before a new timestamp token that appears after a tab.
const normalizedText = text.replace(
    /	(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\t)/g,
    '\n$1'
);

// Detect delimiter
const firstLine = normalizedText.split('\n')[0];
const tabCount = (firstLine.match(/\t/g) || []).length;
const commaCount = (firstLine.match(/,/g) || []).length;
const delim = tabCount > commaCount ? '\t' : ',';

const lines = normalizedText.split('\n').map(l => l.replace(/\r$/, ''));
const rows = lines.map(l => parseCSVLine(l, delim));
return { rows, delim };
}

// ── Core transform ─────────────────────────────────────────────────────────

function processData(text) {
const { rows } = parseCSV(text);
const errors = [];
const output = [];

const prefix = document.getElementById('eventNamePrefix').value.trim();
const roundName = document.getElementById('roundName').value.trim();
const description = document.getElementById('eventDescription').value.trim();
const plusLabel = document.getElementById('plusKitLabel').value.trim();
const baseLabel = document.getElementById('baseKitLabel').value.trim();

// Skip header row(s): find first row where col[14] looks like a date
let startRow = 0;
for (let i = 0; i < Math.min(5, rows.length); i++) {
const sampleEvents = extractEventsFromRow(rows[i] || []);
if (sampleEvents.length) { startRow = i; break; }
startRow = i + 1;
}

for (let i = startRow; i < rows.length; i++) {
const row = rows[i];
if (!row || row.length < 8) continue;

const fields = resolveRowFields(row);
const store = clean(fields.store || fields.city);
const website = normalizeWebsite(fields.website);
const events = extractEventsFromRow(row);

// Skip blank rows
if (!store && !events.length) continue;

if (!events.length) {
    errors.push(`Row ${i + 1}: unrecognised event columns — skipped`);
    continue;
}

if (!store) {
    errors.push(`Row ${i + 1}: missing store name — skipped`);
    continue;
}

events.forEach(event => {
const startDt = event.date;
const format = event.format;
const isPlusKit = event.isPlusKit;
const isFreeKit = event.isFreeKit;

const endDt = addHours(startDt, 7); // default +7h same day

const inviteLabel = isPlusKit ? plusLabel : baseLabel;
const eventName = buildEventName(prefix, format, store, inviteLabel);
const categories = buildCategories(roundName, isPlusKit, isFreeKit, plusLabel, baseLabel);
const tags = buildTags(format);

output.push({
    'Event Name': eventName,
    'Event Description': description,
    'Start Date': formatDate(startDt),
    'End Date': formatDate(endDt),
    'All Day Event': 'TRUE',
    'Event Venue Name': store,
    'Event Organizers': store,
    'Event Category': categories,
    'Event Tags': tags,
    'Event Website': website,
    // for preview
    _isPlusKit: isPlusKit,
    _isFreeKit: isFreeKit,
    _format: format,
});
});
}

return { output, errors };
}

// ── UI rendering ───────────────────────────────────────────────────────────

function renderPreview(rows) {
const body = document.getElementById('previewBody');
body.innerHTML = '';
document.getElementById('rowCount').textContent = `${rows.length} event${rows.length !== 1 ? 's' : ''}`;

rows.forEach(r => {
const tr = document.createElement('tr');

const cats = r['Event Category'].split(',').map(c => `<span class="cat-chip">${c.trim()}</span>`).join('');
const tags = r['Event Tags'].split(',').filter(Boolean).map(t => `<span class="tag-chip">${t.trim()}</span>`).join('');

tr.innerHTML = `
    <td>${r['Event Name']}</td>
    <td class="mono">${r['Start Date']}</td>
    <td class="mono">${r['End Date']}</td>
    <td>${r['Event Venue Name']}</td>
    <td>${cats}</td>
    <td>${tags || '<span style="color:var(--text-dimmer)">—</span>'}</td>
    <td class="mono">${r['Event Website'] ? '<a href="'+r['Event Website']+'" style="color:var(--accent2);text-decoration:none" target="_blank">↗</a>' : '—'}</td>
`;
body.appendChild(tr);
});
}

function renderErrors(errors) {
const sec = document.getElementById('errorsSection');
const list = document.getElementById('errorsList');
if (!errors.length) { sec.classList.remove('visible'); return; }
sec.classList.add('visible');
list.innerHTML = errors.map(e => `<div class="error-item">· ${e}</div>`).join('');
}

// ── File handling ──────────────────────────────────────────────────────────

function handleFile(file) {
const reader = new FileReader();
reader.onload = e => {
const text = e.target.result;
const { output, errors } = processData(text);
outputRows = output;

renderErrors(errors);

if (output.length) {
    renderPreview(output);
    document.getElementById('previewSection').classList.add('visible');
    document.getElementById('exportBtn').disabled = false;

    // Update drop zone
    const dz = document.getElementById('dropZone');
    dz.classList.add('has-file');
    dz.querySelector('.drop-title').textContent = `✓ ${file.name}`;
    dz.querySelector('.drop-sub').textContent = `${output.length} events parsed · ${errors.length} skipped`;
}
};
reader.readAsText(file);
}

// ── Paste handling ─────────────────────────────────────────────────────────

function processPaste() {
const text = document.getElementById('pasteInput').value.trim();
if (!text) return;
const { output, errors } = processData(text);
outputRows = output;
renderErrors(errors);
if (output.length) {
renderPreview(output);
document.getElementById('previewSection').classList.add('visible');
document.getElementById('exportBtn').disabled = false;
const dz = document.getElementById('dropZone');
dz.classList.add('has-file');
dz.querySelector('.drop-title').textContent = `✓ Pasted data`;
dz.querySelector('.drop-sub').textContent = `${output.length} events parsed · ${errors.length} skipped`;
}
}

// Drop zone events
const dz = document.getElementById('dropZone');
const fi = document.getElementById('fileInput');

dz.addEventListener('click', () => fi.click());
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
dz.addEventListener('drop', e => {
e.preventDefault();
dz.classList.remove('dragover');
const file = e.dataTransfer.files[0];
if (file) handleFile(file);
});
fi.addEventListener('change', () => {
if (fi.files[0]) handleFile(fi.files[0]);
});

// ── Export ─────────────────────────────────────────────────────────────────

const HEADERS = [
'Event Name', 'Event Description', 'Start Date', 'End Date',
'All Day Event', 'Event Venue Name', 'Event Organizers',
'Event Category', 'Event Tags', 'Event Website'
];

function escapeCSV(v) {
v = String(v ?? '');
if (v.includes(',') || v.includes('"') || v.includes('\n')) {
v = '"' + v.replace(/"/g, '""') + '"';
}
return v;
}

function exportCSV() {
const lines = [HEADERS.map(escapeCSV).join(',')];
outputRows.forEach(r => {
const line = HEADERS.map(h => escapeCSV(r[h] || '')).join(',');
lines.push(line);
});

const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `f2f-events-calendar-${new Date().toISOString().slice(0, 10)}.csv`;
a.click();
URL.revokeObjectURL(url);

const msg = document.getElementById('statusMsg');
msg.classList.add('show');
setTimeout(() => msg.classList.remove('show'), 3000);
}

// ── Reset ──────────────────────────────────────────────────────────────────

function reset() {
outputRows = [];
document.getElementById('previewSection').classList.remove('visible');
document.getElementById('errorsSection').classList.remove('visible');
document.getElementById('exportBtn').disabled = true;
document.getElementById('fileInput').value = '';
document.getElementById('pasteInput').value = '';
const dz = document.getElementById('dropZone');
dz.classList.remove('has-file', 'dragover');
dz.querySelector('.drop-title').textContent = 'Drop your CSV here';
dz.querySelector('.drop-sub').textContent = 'or click to browse — expects the F2F qualifier export format';
document.getElementById('previewBody').innerHTML = '';
}
