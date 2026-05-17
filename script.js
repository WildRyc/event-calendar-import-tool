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

// ── CSV parsing (handles quoted fields) ───────────────────────────────────

function parseCSVLine(line) {
const result = [];
let cur = '';
let inQuote = false;
for (let i = 0; i < line.length; i++) {
const ch = line[i];
if (ch === '"') {
    if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
    else { inQuote = !inQuote; }
} else if ((ch === ',' || ch === '\t') && !inQuote) {
    result.push(cur); cur = '';
} else {
    cur += ch;
}
}
result.push(cur);
return result;
}

function parseCSV(text) {
// Detect delimiter
const firstLine = text.split('\n')[0];
const tabCount = (firstLine.match(/\t/g) || []).length;
const commaCount = (firstLine.match(/,/g) || []).length;
const delim = tabCount > commaCount ? '\t' : ',';

const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
const rows = lines.map(l => parseCSVLine(l));
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
const maybeDate = clean(rows[i][COL.DATE] || '');
if (parseDate(maybeDate)) { startRow = i; break; }
startRow = i + 1;
}

for (let i = startRow; i < rows.length; i++) {
const row = rows[i];
if (!row || row.length < 14) continue;

const store = clean(row[COL.STORE]);
const rawDate = clean(row[COL.DATE]);
const format = clean(row[COL.FORMAT]);
const website = normalizeWebsite(row[COL.WEBSITE]);

// Skip blank rows
if (!store && !rawDate) continue;

const startDt = parseDate(rawDate);
if (!startDt) {
    errors.push(`Row ${i + 1}: unrecognised date "${rawDate}" — skipped`);
    continue;
}

if (!store) {
    errors.push(`Row ${i + 1}: missing store name — skipped`);
    continue;
}

const isPlusKit = !!clean(row[COL.PLUS_KIT]);
const isFreeKit = isTrue(row[COL.FREE_KIT]);

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
