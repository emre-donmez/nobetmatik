'use strict';

const STORAGE_KEY = 'nobetmatik:v1';
const MIN_SLOT = 30;
const MAX_UNITS = 10;
const DAY = 1440;

const $ = (id) => document.getElementById(id);

const state = {
  points: ['Nokta 1'],
  routes: ['Güzergâh 1'],
  recent: [],
  schedule: null,
  highlighted: null,
};

// ---------- Yardımcılar ----------

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const fmtTime = (min) => {
  const t = ((min % DAY) + DAY) % DAY;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

const fmtDur = (min) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} dk`;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

const gcd = (a, b) => {
  while (b) [a, b] = [b, a % b];
  return a;
};

const parsePeople = () =>
  $('people').value.split('\n').map((s) => s.trim()).filter(Boolean);

const slotSize = () => state.points.length + state.routes.length * 2;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2000);
}

// ---------- Kalıcılık ----------

function load() {
  let data = {};
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch { /* bozuk veri yok sayılır */ }

  $('start').value = data.start || '20:00';
  $('end').value = data.end || '09:00';
  $('people').value = typeof data.people === 'string' ? data.people : '';
  $('date').value = new Date().toLocaleDateString('sv-SE');

  const strList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (strList(data.points)) state.points = data.points.slice(0, MAX_UNITS);
  if (strList(data.routes)) state.routes = data.routes.slice(0, MAX_UNITS);
  if (strList(data.recent)) state.recent = data.recent.slice(0, 4);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      start: $('start').value,
      end: $('end').value,
      people: $('people').value,
      points: state.points,
      routes: state.routes,
      recent: state.recent,
    }));
  } catch { /* depolama dolu/kapalı */ }
}

// ---------- Form arayüzü ----------

function renderUnits() {
  const lists = [
    ['points', 'pointNames', 'pointsCount', 'Nokta'],
    ['routes', 'routeNames', 'routesCount', 'Güzergâh'],
  ];
  for (const [key, boxId, countId, label] of lists) {
    $(countId).textContent = state[key].length;
    const box = $(boxId);
    box.replaceChildren(...state[key].map((name, i) => {
      const input = el('input', { type: 'text', value: name, 'aria-label': `${label} ${i + 1} adı`, maxlength: '40' });
      input.addEventListener('input', () => {
        state[key][i] = input.value;
        save();
      });
      return input;
    }));
  }
  updatePeopleInfo();
}

function changeUnits(key, delta) {
  const list = state[key];
  const label = key === 'points' ? 'Nokta' : 'Güzergâh';
  if (delta > 0 && list.length < MAX_UNITS) list.push(`${label} ${list.length + 1}`);
  if (delta < 0 && list.length > 0) list.pop();
  renderUnits();
  save();
}

function renderRecent() {
  $('recentTimes').replaceChildren(...state.recent.map((range) => {
    const chip = el('button', { type: 'button', className: 'chip' }, range.replace('-', ' – '));
    chip.addEventListener('click', () => {
      const [s, e] = range.split('-');
      $('start').value = s;
      $('end').value = e;
      save();
    });
    return chip;
  }));
}

function updatePeopleInfo() {
  const n = parsePeople().length;
  const need = slotSize() * 2;
  $('peopleCount').textContent = n;
  $('peopleHint').textContent = !need
    ? 'En az bir nokta veya güzergâh ekleyin.'
    : n && n < need
      ? `${need} kişiden az olduğu için bazı görevler art arda gelecek.`
      : `Art arda görev olmaması için en az ${need} kişi önerilir.`;
}

function showError(msg) {
  const box = $('error');
  box.textContent = msg || '';
  box.hidden = !msg;
}

// ---------- Algoritma ----------

function slotScore(len) {
  const shape = len % 5 === 0 ? 0 : Number.isInteger(len) ? 0.5 : 1.5;
  const range = len < 60 ? (60 - len) / 30 : len > 120 ? (len - 120) / 30 : 0;
  return shape + range + Math.abs(len - 90) / 1000;
}

// Dilim sayısı, herkes eşit sayıda nokta ve güzergâh görevi alacak şekilde seçilir.
function computeSlots(n, p, r, total) {
  const a = n / gcd(n, p);
  const b = n / gcd(n, r * 2);
  const strict = (a * b) / gcd(a, b);
  const base = total / strict >= MIN_SLOT ? strict : n / gcd(n, p + r * 2);
  let best = null;
  for (let m = 1; ; m++) {
    const count = base * m;
    const len = total / count;
    if (m > 1 && len < MIN_SLOT) break;
    const score = slotScore(len);
    if (!best || score < best.score) best = { count, len, score };
    if (len < MIN_SLOT) break;
  }
  return best;
}

// Her dilimdeki kişilerden hangilerinin noktaya gideceğini max-flow ile seçer;
// herkes en fazla ceil(S*P/N) nokta görevi alır, kalan görevleri güzergâhtır.
function pickPointHolders(sel, p, n) {
  const count = sel.length;
  const cap = Math.ceil((count * p) / n);
  const src = 0, sink = count + n + 1;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (u, v, c) => {
    graph[u].push({ to: v, cap: c, rev: graph[v].length });
    graph[v].push({ to: u, cap: 0, rev: graph[u].length - 1 });
  };
  sel.forEach((ids, i) => {
    addEdge(src, 1 + i, p);
    ids.forEach((x) => addEdge(1 + i, 1 + count + x, 1));
  });
  for (let x = 0; x < n; x++) addEdge(1 + count + x, sink, cap);

  for (;;) {
    const prev = new Array(sink + 1).fill(null);
    prev[src] = { node: -1 };
    const queue = [src];
    while (queue.length && !prev[sink]) {
      const u = queue.shift();
      graph[u].forEach((e, idx) => {
        if (e.cap > 0 && !prev[e.to]) {
          prev[e.to] = { node: u, idx };
          queue.push(e.to);
        }
      });
    }
    if (!prev[sink]) break;
    for (let v = sink; v !== src; v = prev[v].node) {
      const e = graph[prev[v].node][prev[v].idx];
      e.cap--;
      graph[v][e.rev].cap++;
    }
  }

  return sel.map((_, i) => new Set(
    graph[1 + i].filter((e) => e.to > count && e.to < sink && e.cap === 0).map((e) => e.to - 1 - count)));
}

function buildSchedule(people, points, routes, start, total) {
  const n = people.length;
  const k = points.length + routes.length * 2;
  const { count, len } = computeSlots(n, points.length, routes.length, total);
  const duty = people.map(() => ({ minutes: 0, items: [] }));

  // Döngüsel sıra dinlenme sürelerini eşit dağıtır; roller ayrıca dengelenir.
  const sel = Array.from({ length: count }, (_, i) => Array.from({ length: k }, (_, j) => (i * k + j) % n));
  const holders = pickPointHolders(sel, points.length, n);

  const slots = sel.map((ids, i) => {
    const from = start + Math.round((i * total) / count);
    const to = start + Math.round(((i + 1) * total) / count);
    const pointIds = ids.filter((x) => holders[i].has(x));
    const routeFlat = ids.filter((x) => !holders[i].has(x));
    const routeIds = routes.map((_, r) => routeFlat.slice(r * 2, r * 2 + 2));
    const add = (p, role) => {
      duty[p].minutes += to - from;
      duty[p].items.push({ from, to, role });
    };
    pointIds.forEach((p, idx) => add(p, points[idx]));
    routeIds.forEach((pair, idx) => pair.forEach((p) => add(p, routes[idx])));
    return { from, to, points: pointIds, routes: routeIds };
  });

  return { people, points, routes, start, total, slots, duty, len, count, perPerson: (count * k) / n };
}

// ---------- Sonuç ----------

function nameSpan(people, idx) {
  return el('span', { className: 'name', dataset: { p: String(idx) } }, people[idx]);
}

function renderSchedule(s) {
  const { people, points, routes, slots, duty } = s;
  const date = fmtDate($('date').value);

  $('meta').textContent =
    `${date ? date + ' · ' : ''}${fmtTime(s.start)} – ${fmtTime(s.start + s.total)} · ` +
    `${s.count} dilim × ~${fmtDur(Math.round(s.len))} · kişi başı ${s.perPerson} görev`;

  const headRow = el('tr', {}, el('th', {}, 'Saat'),
    ...points.map((p) => el('th', {}, p || 'Nokta')),
    ...routes.map((r) => el('th', {}, r || 'Güzergâh')));

  const rows = slots.map((slot) => el('tr', {},
    el('td', { className: 'time' }, `${fmtTime(slot.from)}–${fmtTime(slot.to)}`),
    ...slot.points.map((p) => el('td', {}, nameSpan(people, p))),
    ...slot.routes.map(([a, b]) => el('td', {}, nameSpan(people, a), ' – ', nameSpan(people, b)))));

  $('table').replaceChildren(el('thead', {}, headRow), el('tbody', {}, ...rows));

  const notes = [];
  const need = (points.length + routes.length * 2) * 2;
  if (people.length < need) notes.push(`Kişi sayısı az olduğu için (önerilen en az ${need}) bazı görevler art arda geliyor.`);
  if (!Number.isInteger(s.len)) notes.push('Dakikalar tam bölünmediği için kişiler arasında birkaç dakikalık yuvarlama farkı olabilir.');
  if (s.len < MIN_SLOT) notes.push('Personel sayısı fazla olduğu için dilimler kısa çıktı.');
  $('note').textContent = notes.join(' ');

  $('summary').replaceChildren(...people.map((name, idx) => {
    const d = duty[idx];
    const li = el('li', { dataset: { p: String(idx) } },
      el('strong', {}, name),
      el('div', { className: 'slots' }, d.items.map((it) => `${fmtTime(it.from)}–${fmtTime(it.to)} ${it.role}`).join('\n')),
      el('div', { className: 'totals' }, `Görev ${fmtDur(d.minutes)} · İstirahat ${fmtDur(s.total - d.minutes)}`));
    li.addEventListener('click', () => highlight(idx));
    return li;
  }));

  state.highlighted = null;
  $('empty').hidden = true;
  $('output').hidden = false;
}

function highlight(idx) {
  state.highlighted = state.highlighted === idx ? null : idx;
  const key = String(state.highlighted);
  document.querySelectorAll('#table .name').forEach((n) => n.classList.toggle('hl', n.dataset.p === key));
  document.querySelectorAll('#summary li').forEach((li) => li.classList.toggle('active', li.dataset.p === key));
}

function shareText(s) {
  const { people, points, routes, slots, duty } = s;
  const date = fmtDate($('date').value);
  const lines = [
    `*Nöbet Çizelgesi${date ? ' - ' + date : ''}*`,
    `${fmtTime(s.start)} - ${fmtTime(s.start + s.total)} | ${s.count} dilim x ~${fmtDur(Math.round(s.len))}`,
    '',
  ];
  for (const slot of slots) {
    lines.push(`*${fmtTime(slot.from)} - ${fmtTime(slot.to)}*`);
    slot.points.forEach((p, i) => lines.push(`${points[i] || 'Nokta'}: ${people[p]}`));
    slot.routes.forEach(([a, b], i) => lines.push(`${routes[i] || 'Güzergâh'}: ${people[a]} - ${people[b]}`));
    lines.push('');
  }
  lines.push(`Kişi başı görev: ${fmtDur(duty[0].minutes)}, istirahat: ${fmtDur(s.total - duty[0].minutes)}`);
  return lines.join('\n');
}

// ---------- Akış ----------

function generate({ silent = false } = {}) {
  const people = parsePeople();
  const start = $('start').value;
  const end = $('end').value;
  const k = slotSize();

  let error = '';
  if (!start || !end) error = 'Başlangıç ve bitiş saatini girin.';
  else if (start === end) error = 'Başlangıç ve bitiş saati aynı olamaz.';
  else if (!k) error = 'En az bir nokta veya güzergâh ekleyin.';
  else if (people.length < k) error = `En az ${k} kişi gerekli (şu an ${people.length}).`;
  else if (new Set(people.map((p) => p.toLocaleLowerCase('tr'))).size !== people.length) error = 'Listede tekrar eden isim var.';

  if (error) {
    if (!silent) showError(error);
    return;
  }
  showError('');

  const s0 = toMin(start);
  const total = (toMin(end) - s0 + DAY) % DAY;
  state.schedule = buildSchedule(people, [...state.points], [...state.routes], s0, total);
  renderSchedule(state.schedule);

  if (!silent) {
    const range = `${start}-${end}`;
    state.recent = [range, ...state.recent.filter((r) => r !== range)].slice(0, 4);
    renderRecent();
    save();
    if (window.matchMedia('(max-width: 899px)').matches) $('result').scrollIntoView({ behavior: 'smooth' });
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea', {}, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Kopyalandı');
}

function shuffle() {
  const list = parsePeople();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  $('people').value = list.join('\n');
  save();
  toast('Sıra karıştırıldı');
}

function init() {
  load();
  renderUnits();
  renderRecent();

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    generate();
  });

  document.querySelectorAll('[data-list]').forEach((btn) =>
    btn.addEventListener('click', () => changeUnits(btn.dataset.list, Number(btn.dataset.delta))));

  ['start', 'end'].forEach((id) => $(id).addEventListener('change', save));
  $('people').addEventListener('input', () => {
    updatePeopleInfo();
    save();
  });

  $('shuffle').addEventListener('click', () => {
    shuffle();
    updatePeopleInfo();
  });
  $('clearPeople').addEventListener('click', () => {
    if (!$('people').value.trim() || !confirm('Personel listesi silinsin mi?')) return;
    $('people').value = '';
    updatePeopleInfo();
    save();
  });

  $('whatsapp').addEventListener('click', () => {
    if (!state.schedule) return;
    const url = `https://wa.me/?text=${encodeURIComponent(shareText(state.schedule))}`;
    // On mobile, a new tab stays at about:blank after handing off to the WhatsApp app
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      location.href = url;
    } else {
      window.open(url, '_blank', 'noopener');
    }
  });
  $('copy').addEventListener('click', () => {
    if (state.schedule) copyText(shareText(state.schedule));
  });

  generate({ silent: true });
}

init();
