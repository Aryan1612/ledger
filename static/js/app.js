// =============================================================================
// LEDGER — frontend logic
// Talks directly to Supabase (Postgres + Auth) from the browser, renders a
// hand-drawn canvas pie chart (no CDN dependency for the chart itself), and
// manages categories + transactions. Auth is passkey-first, with a one-time
// email link as the bootstrap/fallback path (see README-web.md).
// =============================================================================

// -----------------------------------------------------------------------------
// Supabase client
// -----------------------------------------------------------------------------
// Passkey auth is still an experimental supabase-js feature and must be
// explicitly opted into here, or auth.signInWithPasskey/registerPasskey won't
// exist on the client at all.
const sb = window.supabase.createClient(
  window.LEDGER_SUPABASE_URL,
  window.LEDGER_SUPABASE_ANON_KEY,
  { auth: { experimental: { passkey: true } } }
);

const state = {
  categories: [],
  transactions: [],
  summary: null,
  currentMonth: null,
  editingId: null,
};

const fmt = (n) => {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + '₹' + abs.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

const fmtPrecise = (n) => {
  const sign = n < 0 ? '-' : '';
  return sign + '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Compact form for tight spaces (trend bar labels): ₹25.6k, ₹1.2L, ₹850
const fmtCompact = (n) => {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 100000) return sign + '₹' + trimZero((abs / 100000).toFixed(1)) + 'L';
  if (abs >= 1000) return sign + '₹' + trimZero((abs / 1000).toFixed(1)) + 'k';
  return sign + '₹' + Math.round(abs);
};
const trimZero = (s) => s.replace(/\.0$/, '');

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// -----------------------------------------------------------------------------
// Data helpers — talk to Supabase directly (Postgres + RPC), no backend server
// -----------------------------------------------------------------------------
// Row Level Security (schema.sql) means every query here is automatically
// scoped to the signed-in user — there's no user_id filtering to do by hand.

function unwrap({ data, error }) {
  if (error) throw new Error(error.message || 'Request failed');
  return data;
}

const getCategories = async () =>
  unwrap(await sb.from('categories').select('*').order('name'));

const createCategory = async (name, color) =>
  unwrap(await sb.from('categories').insert({ name, color }).select().single());

const deleteCategory = async (id) =>
  unwrap(await sb.from('categories').delete().eq('id', id));

const updateCategory = async (id, payload) =>
  unwrap(await sb.from('categories').update(payload).eq('id', id));

// occurred_at is stored as text "YYYY-MM-DDTHH:MM..."; month filtering matches
// the same substr(occurred_at, 1, 7) logic the SQL functions use.
const getTransactions = async (month) => {
  const rows = unwrap(
    await sb
      .from('transactions')
      .select('*, categories(name, color)')
      .gte('occurred_at', `${month}-01`)
      .lt('occurred_at', `${shiftMonth(month, 1)}-01`)
      .order('occurred_at', { ascending: false })
  );
  // Flatten the embedded category row so the rest of the app can keep using
  // tx.category_name / tx.category_color / tx.category_id as before.
  return rows.map(tx => ({
    ...tx,
    category_name: tx.categories?.name ?? null,
    category_color: tx.categories?.color ?? null,
  }));
};

const createTransaction = async (payload) =>
  unwrap(await sb.from('transactions').insert(payload).select().single());

const updateTransaction = async (id, payload) =>
  unwrap(await sb.from('transactions').update(payload).eq('id', id));

const deleteTransaction = async (id) =>
  unwrap(await sb.from('transactions').delete().eq('id', id));

const getSummary = async (month) =>
  unwrap(await sb.rpc('get_summary', { p_month: month ?? null }));

const getTrends = async (months, categoryIds) =>
  unwrap(await sb.rpc('get_trends', {
    p_months: months,
    p_category_ids: categoryIds && categoryIds.length ? categoryIds : null,
  }));

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------

async function initApp() {
  setDefaultDatetime();
  bindStaticHandlers();
  bindSheetHandlers();
  bindCompareHandlers();
  initPieHover();

  state.categories = await getCategories();
  renderCategorySelect();

  state.summary = await getSummary(); // no month -> backend picks latest or current
  state.currentMonth = state.summary.month;

  populateMonthSelect(state.summary.available_months, state.currentMonth);
  await refreshAll();

  // Re-draw the donut whenever the container's size changes (window resize,
  // phone rotation) so it always matches its box instead of going stale.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderChart, 120);
  });
}

// -----------------------------------------------------------------------------
// Auth gate
// -----------------------------------------------------------------------------
// Three screens live in index.html: the sign-in card, the "register this
// device" prompt (shown right after the one-time email link is used), and
// the app itself. This decides which one is visible and wires up the buttons.

function showAuthScreen() {
  document.getElementById('authScreen').hidden = false;
  document.getElementById('appRoot').hidden = true;
}

function showRegisterPrompt() {
  document.getElementById('authScreen').hidden = false;
  document.getElementById('appRoot').hidden = true;
  document.getElementById('bootstrapForm').hidden = true;
  document.getElementById('firstTimeToggle').hidden = true;
  document.getElementById('registerPasskeyBlock').hidden = false;
}

let appStarted = false;
async function showApp() {
  document.getElementById('authScreen').hidden = true;
  document.getElementById('appRoot').hidden = false;
  if (!appStarted) {
    appStarted = true;
    await initApp().catch(err => {
      console.error(err);
      toast('Could not load — check the console for errors');
    });
  }
}

function authStatus(msg) {
  const el = document.getElementById('authStatus');
  el.textContent = msg;
  el.hidden = !msg;
}

// True right after the person clicks the emailed magic link and lands back
// on the site — that's the one moment we want to offer passkey registration
// instead of going straight into the app.
let justCameFromEmailLink = false;

function bindAuthHandlers() {
  document.getElementById('passkeySigninBtn').addEventListener('click', async () => {
    authStatus('Waiting for your passkey…');
    const { error } = await sb.auth.signInWithPasskey();
    if (error) {
      authStatus('');
      toast(error.message || 'Passkey sign-in failed');
      return;
    }
    authStatus('');
    await showApp();
  });

  document.getElementById('firstTimeToggle').addEventListener('click', () => {
    document.getElementById('bootstrapForm').hidden = false;
    document.getElementById('firstTimeToggle').hidden = true;
  });

  document.getElementById('bootstrapForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('bootstrapEmail').value.trim();
    if (!email) return;
    authStatus('Sending link…');
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      authStatus('');
      toast(error.message || 'Could not send the link');
      return;
    }
    authStatus(`Link sent to ${email} — open it on this device.`);
  });

  document.getElementById('registerPasskeyBtn').addEventListener('click', async () => {
    const { error } = await sb.auth.registerPasskey();
    if (error) {
      toast(error.message || 'Could not register passkey');
      return;
    }
    toast('Passkey registered on this device');
    await showApp();
  });

  document.getElementById('skipRegisterBtn').addEventListener('click', async () => {
    await showApp();
  });

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    appStarted = false;
    showAuthScreen();
    document.getElementById('bootstrapForm').hidden = true;
    document.getElementById('firstTimeToggle').hidden = false;
    document.getElementById('registerPasskeyBlock').hidden = true;
  });
}

async function initAuth() {
  bindAuthHandlers();

  // Clicking the emailed magic link lands back here with auth tokens in the
  // URL; supabase-js exchanges them for a session automatically, which fires
  // SIGNED_IN below. Detect that case up front to distinguish it from an
  // already-existing session (e.g. a page refresh).
  justCameFromEmailLink = window.location.hash.includes('access_token')
    || new URLSearchParams(window.location.search).has('code');

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      if (justCameFromEmailLink) {
        justCameFromEmailLink = false;
        // Clean the tokens out of the URL bar.
        window.history.replaceState({}, '', window.location.pathname);
        showRegisterPrompt();
      } else {
        showApp();
      }
    } else if (event === 'SIGNED_OUT') {
      showAuthScreen();
    }
  });

  const { data: { session } } = await sb.auth.getSession();
  if (session && !justCameFromEmailLink) {
    await showApp();
  } else if (!justCameFromEmailLink) {
    showAuthScreen();
  }
  // If justCameFromEmailLink is true, wait for onAuthStateChange to fire
  // SIGNED_IN once supabase-js finishes processing the URL.
}

function setDefaultDatetime() {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  const local = new Date(now - tzOffset).toISOString().slice(0, 16);
  document.getElementById('datetimeInput').value = local;
}

// -----------------------------------------------------------------------------
// Month navigation
// -----------------------------------------------------------------------------

function populateMonthSelect(months, current) {
  const select = document.getElementById('monthSelect');
  let list = months && months.length ? months : [current];
  if (!list.includes(current)) list = [current, ...list];
  list = [...new Set(list)].sort().reverse();

  select.innerHTML = list.map(ym => `<option value="${ym}">${monthLabel(ym)}</option>`).join('');
  select.value = current;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function changeMonth(newMonth) {
  state.currentMonth = newMonth;
  const select = document.getElementById('monthSelect');
  if (![...select.options].some(o => o.value === newMonth)) {
    const opt = document.createElement('option');
    opt.value = newMonth;
    opt.textContent = monthLabel(newMonth);
    select.appendChild(opt);
    select.value = newMonth;
    // keep sorted desc
    const opts = [...select.options].sort((a, b) => b.value.localeCompare(a.value));
    select.innerHTML = '';
    opts.forEach(o => select.appendChild(o));
    select.value = newMonth;
  } else {
    select.value = newMonth;
  }
  await refreshAll();
}

// -----------------------------------------------------------------------------
// Refresh everything for current month
// -----------------------------------------------------------------------------

async function refreshAll() {
  const [summary, transactions] = await Promise.all([
    getSummary(state.currentMonth),
    getTransactions(state.currentMonth),
  ]);
  state.summary = summary;
  state.transactions = transactions;

  renderSummary();
  renderChart();
  renderLegend();
  renderTrend();
  renderLedgerTable();
}

// -----------------------------------------------------------------------------
// Summary strip
// -----------------------------------------------------------------------------

function renderSummary() {
  const { total_income, total_expense, net } = state.summary;
  document.getElementById('totalIncome').textContent = fmt(total_income);
  document.getElementById('totalExpense').textContent = fmt(total_expense);
  const netEl = document.getElementById('totalNet');
  netEl.textContent = fmt(net);
  netEl.classList.remove('positive', 'negative');
  netEl.classList.add(net >= 0 ? 'positive' : 'negative');
  document.getElementById('chartMonthLabel').textContent = monthLabel(state.currentMonth);
  document.getElementById('entryCount').textContent =
    `${state.transactions.length} entr${state.transactions.length === 1 ? 'y' : 'ies'}`;
}

// -----------------------------------------------------------------------------
// Pie chart — hand-drawn on canvas, no external chart library needed
// -----------------------------------------------------------------------------

let pieChartData = null; // cached geometry, reused by drawPie() + hover hit-testing

function renderChart() {
  const canvas = document.getElementById('categoryChart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  // Size the canvas off its actual container box (.chart-wrap) rather than a
  // fixed 280px — .chart-wrap shrinks on narrow phone screens via CSS media
  // queries, and the canvas needs to track that or it overflows its box and
  // the absolutely-centered "total spent" label ends up misaligned.
  const wrap = canvas.parentElement;
  const size = Math.round((wrap && wrap.clientWidth) || 280);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const data = state.summary.by_category.filter(c => c.total > 0);
  const total = data.reduce((s, c) => s + c.total, 0);

  const cx = size / 2, cy = size / 2;
  // Radii scaled proportionally to size, using the original 280px design
  // (outerR 122, innerR 76) as the reference ratio.
  const outerR = size * (122 / 280), innerR = size * (76 / 280);

  // Precompute each slice's angular range once, in the same coordinate
  // space atan2() returns, so hover hit-testing is a cheap lookup later.
  const slices = [];
  if (data.length && total > 0) {
    let startAngle = -Math.PI / 2;
    data.forEach(cat => {
      const sweep = (cat.total / total) * Math.PI * 2;
      const endAngle = startAngle + sweep;
      slices.push({ start: startAngle, end: endAngle });
      startAngle = endAngle;
    });
  }

  pieChartData = { ctx, size, cx, cy, outerR, innerR, data, total, slices };

  drawPie(-1);
  updateChartCenter(-1);
}

// Redraws the donut. hoverIndex >= 0 dims every other slice slightly and
// traces a thin ring around the hovered one — deliberately subtle so it
// reads as a highlight, not an animation.
function drawPie(hoverIndex) {
  if (!pieChartData) return;
  const { ctx, size, cx, cy, outerR, innerR, data, total, slices } = pieChartData;
  ctx.clearRect(0, 0, size, size);

  if (!data.length || total === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.strokeStyle = '#DDD7C7';
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }

  data.forEach((cat, i) => {
    const { start, end } = slices[i];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, start, end);
    ctx.closePath();
    ctx.globalAlpha = (hoverIndex === -1 || hoverIndex === i) ? 1 : 0.45;
    ctx.fillStyle = cat.category_color || '#1F6F5C';
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // donut hole, painted in paper color to create the ring + center label space
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = '#FAF8F3';
  ctx.fill();

  // hairline separators between slices
  ctx.strokeStyle = 'rgba(250,248,243,0.9)';
  ctx.lineWidth = 2;
  slices.forEach(s => {
    ctx.beginPath();
    ctx.moveTo(cx + innerR * Math.cos(s.start), cy + innerR * Math.sin(s.start));
    ctx.lineTo(cx + outerR * Math.cos(s.start), cy + outerR * Math.sin(s.start));
    ctx.stroke();
  });

  if (hoverIndex >= 0 && slices[hoverIndex]) {
    const s = slices[hoverIndex];
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + 3, s.start, s.end);
    ctx.strokeStyle = data[hoverIndex].category_color || '#1C1F26';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// Swaps the donut's center label between "total spent" and the hovered
// category — no floating tooltip box, so nothing extra sits on the chart.
function updateChartCenter(hoverIndex) {
  const amtEl = document.getElementById('chartCenterAmount');
  const labelEl = document.getElementById('chartCenterLabel');
  if (!pieChartData) return;
  const { data, total } = pieChartData;

  if (hoverIndex < 0 || !data[hoverIndex]) {
    amtEl.textContent = fmt(total);
    amtEl.style.color = '';
    labelEl.textContent = total > 0 ? 'total spent' : 'no expenses yet';
    return;
  }

  const cat = data[hoverIndex];
  const pct = total > 0 ? Math.round((cat.total / total) * 100) : 0;
  amtEl.textContent = fmt(cat.total);
  amtEl.style.color = cat.category_color || '';
  labelEl.textContent = `${cat.category_name} · ${pct}%`;
}

// Hover hit-testing: figure out which slice (if any) the cursor sits over,
// using the cached angle ranges from the last render — no per-move recompute.
function initPieHover() {
  const canvas = document.getElementById('categoryChart');
  let hoverIndex = -1;

  const angleInPieSpace = (dx, dy) => {
    let a = Math.atan2(dy, dx);
    const twoPi = Math.PI * 2;
    while (a < -Math.PI / 2) a += twoPi;
    while (a >= -Math.PI / 2 + twoPi) a -= twoPi;
    return a;
  };

  canvas.addEventListener('mousemove', (e) => {
    if (!pieChartData || !pieChartData.slices.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { cx, cy, innerR, outerR, slices } = pieChartData;
    const dx = x - cx, dy = y - cy;
    const dist = Math.hypot(dx, dy);

    let idx = -1;
    if (dist >= innerR && dist <= outerR) {
      const a = angleInPieSpace(dx, dy);
      idx = slices.findIndex(s => a >= s.start && a < s.end);
    }

    if (idx !== hoverIndex) {
      hoverIndex = idx;
      drawPie(hoverIndex);
      updateChartCenter(hoverIndex);
      canvas.style.cursor = idx >= 0 ? 'pointer' : 'default';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (hoverIndex !== -1) {
      hoverIndex = -1;
      drawPie(-1);
      updateChartCenter(-1);
    }
    canvas.style.cursor = 'default';
  });
}

// -----------------------------------------------------------------------------
// Legend (category breakdown list)
// -----------------------------------------------------------------------------

function renderLegend() {
  const ul = document.getElementById('categoryLegend');
  const data = state.summary.by_category.filter(c => c.total > 0);
  const total = data.reduce((s, c) => s + c.total, 0);

  if (!data.length) {
    ul.innerHTML = '<li class="legend-empty">No expenses logged this month yet.</li>';
    return;
  }

  ul.innerHTML = data.map(cat => {
    const pct = total > 0 ? Math.round((cat.total / total) * 100) : 0;
    return `
      <li class="legend-item">
        <span class="legend-swatch" style="background:${cat.category_color}"></span>
        <span class="legend-name">${escapeHtml(cat.category_name)}</span>
        <span class="legend-amount">${fmt(cat.total)}</span>
        <span class="legend-pct">${pct}%</span>
      </li>`;
  }).join('');
}

// -----------------------------------------------------------------------------
// Trend bars (recent months, expense totals)
// -----------------------------------------------------------------------------

function renderTrend() {
  const wrap = document.getElementById('trendBars');
  const trend = state.summary.trend.slice(-6); // last 6 months with data
  if (!trend.length) {
    wrap.innerHTML = '<span class="legend-empty">Not enough history yet.</span>';
    return;
  }
  const maxVal = Math.max(...trend.map(t => t.expense), 1);

  wrap.innerHTML = trend.map(t => {
    const h = Math.max(2, Math.round((t.expense / maxVal) * 62));
    const isCurrent = t.ym === state.currentMonth;
    const barColor = isCurrent ? '#1F6F5C' : '#B3552E';
    return `
      <div class="trend-bar-col">
        <span class="trend-bar-value" style="color:${isCurrent ? barColor : ''}">${fmtCompact(t.expense)}</span>
        <div class="trend-bar" style="height:${h}px; background:${barColor}"></div>
        <span class="trend-bar-label">${t.ym.split('-')[1]}</span>
      </div>`;
  }).join('');
}

// -----------------------------------------------------------------------------
// Ledger table (transaction list)
// -----------------------------------------------------------------------------

function renderLedgerTable() {
  const tbody = document.getElementById('ledgerBody');
  const emptyState = document.getElementById('emptyState');

  if (!state.transactions.length) {
    tbody.innerHTML = '';
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  // "Big ticket" marker: expense entries above 2x the median expense this month
  const expenseAmounts = state.transactions.filter(t => t.type === 'expense').map(t => t.amount).sort((a, b) => a - b);
  const median = expenseAmounts.length ? expenseAmounts[Math.floor(expenseAmounts.length / 2)] : 0;
  const bigTicketThreshold = median * 2.5;

  tbody.innerHTML = state.transactions.map(tx => {
    if (state.editingId === tx.id) {
      return renderEditRow(tx);
    }

    const dt = new Date(tx.occurred_at);
    const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const isIncome = tx.type === 'income';
    const isBig = !isIncome && bigTicketThreshold > 0 && tx.amount > bigTicketThreshold;

    return `
      <tr data-row-id="${tx.id}">
        <td class="tx-date">${dateStr}, ${timeStr}</td>
        <td>
          <span class="tx-category">
            <span class="tx-cat-dot" style="background:${tx.category_color || '#9A9DA6'}"></span>
            ${escapeHtml(tx.category_name || 'Uncategorized')}
          </span>
        </td>
        <td class="tx-note" title="${escapeHtml(tx.note || '')}">${escapeHtml(tx.note || '—')}</td>
        <td class="tx-amount ${isIncome ? 'income' : 'expense'} ${isBig ? 'big-ticket' : ''}">
          ${isIncome ? '+' : ''}${fmtPrecise(tx.amount)}
        </td>
        <td class="tx-actions">
          <button class="tx-edit" data-id="${tx.id}" aria-label="Edit entry">Edit</button>
          <button class="tx-delete" data-id="${tx.id}" aria-label="Delete entry">✕</button>
        </td>
      </tr>`;
  }).join('');

  bindLedgerRowHandlers();
}

function renderEditRow(tx) {
  const dt = new Date(tx.occurred_at);
  const tzOffset = dt.getTimezoneOffset() * 60000;
  const localValue = new Date(dt - tzOffset).toISOString().slice(0, 16);

  const catOptions = state.categories.map(c =>
    `<option value="${c.id}" ${c.id === tx.category_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');

  return `
    <tr data-row-id="${tx.id}" class="editing-row">
      <td>
        <input type="datetime-local" class="edit-datetime" value="${localValue}" />
      </td>
      <td>
        <select class="edit-category">${catOptions}</select>
      </td>
      <td>
        <input type="text" class="edit-note" value="${escapeHtml(tx.note || '')}" maxlength="200" placeholder="Note" />
      </td>
      <td>
        <div class="edit-amount-wrap">
          <span class="edit-currency">₹</span>
          <input type="number" class="edit-amount" value="${tx.amount}" step="0.01" min="0.01" />
        </div>
      </td>
      <td class="tx-actions">
        <button class="tx-save" data-id="${tx.id}">Save</button>
        <button class="tx-cancel" data-id="${tx.id}">Cancel</button>
      </td>
    </tr>`;
}

function bindLedgerRowHandlers() {
  document.querySelectorAll('.tx-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      state.editingId = Number(btn.dataset.id);
      renderLedgerTable();
    });
  });

  document.querySelectorAll('.tx-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      state.editingId = null;
      renderLedgerTable();
    });
  });

  document.querySelectorAll('.tx-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const row = document.querySelector(`tr[data-row-id="${id}"]`);

      const amount = row.querySelector('.edit-amount').value;
      const categoryId = row.querySelector('.edit-category').value;
      const occurredAt = row.querySelector('.edit-datetime').value;
      const note = row.querySelector('.edit-note').value;

      if (!amount || Number(amount) <= 0) {
        toast('Enter a valid amount');
        return;
      }
      if (!occurredAt) {
        toast('Date & time is required');
        return;
      }

      try {
        await updateTransaction(id, {
          amount: Number(amount),
          category_id: Number(categoryId),
          occurred_at: occurredAt,
          note,
        });
        state.editingId = null;
        toast('Entry updated');

        const entryMonth = occurredAt.slice(0, 7);
        if (entryMonth !== state.currentMonth) {
          const summary = await getSummary();
          populateMonthSelect(summary.available_months, entryMonth);
          await changeMonth(entryMonth);
        } else {
          await refreshAll();
        }
      } catch (err) {
        toast(err.message || 'Could not update entry');
      }
    });
  });

  document.querySelectorAll('.tx-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const ok = confirm('Delete this entry? This cannot be undone.');
      if (!ok) return;
      await deleteTransaction(id);
      toast('Entry deleted');
      await refreshAll();
    });
  });
}

// -----------------------------------------------------------------------------
// Category select (in add form) + category manager modal
// -----------------------------------------------------------------------------

function renderCategorySelect() {
  const select = document.getElementById('categorySelect');
  const type = document.getElementById('txType').value;

  if (type === 'income') {
    select.innerHTML = state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  } else {
    // For expenses, hide nothing — user manages all categories themselves
    select.innerHTML = state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }

  if (!state.categories.length) {
    select.innerHTML = '<option value="">No categories yet — add one below</option>';
  }
}

function renderCategoryManageList() {
  const ul = document.getElementById('categoryManageList');
  if (!state.categories.length) {
    ul.innerHTML = '<li class="legend-empty">No categories yet. Add your first one below.</li>';
    return;
  }
  ul.innerHTML = state.categories.map(c => `
    <li class="category-manage-item">
      <input type="color" class="cat-color-dot" value="${c.color}" data-id="${c.id}" data-role="color" />
      <span class="cat-name-text">${escapeHtml(c.name)}</span>
      <button class="cat-delete-btn" data-id="${c.id}">Remove</button>
    </li>
  `).join('');

  ul.querySelectorAll('[data-role="color"]').forEach(input => {
    input.addEventListener('input', async () => {
      await updateCategory(input.dataset.id, { color: input.value });
      state.categories = await getCategories();
      renderCategorySelect();
      await refreshAll();
    });
  });

  ul.querySelectorAll('.cat-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = confirm('Remove this category? Past entries will keep their amounts but lose the category label.');
      if (!ok) return;
      await deleteCategory(btn.dataset.id);
      state.categories = await getCategories();
      renderCategorySelect();
      renderCategoryManageList();
      await refreshAll();
    });
  });
}

// -----------------------------------------------------------------------------
// Event bindings
// -----------------------------------------------------------------------------

function bindStaticHandlers() {
  // Month nav
  document.getElementById('prevMonth').addEventListener('click', () => {
    changeMonth(shiftMonth(state.currentMonth, -1));
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    changeMonth(shiftMonth(state.currentMonth, 1));
  });
  document.getElementById('monthSelect').addEventListener('change', (e) => {
    changeMonth(e.target.value);
  });

  // Type toggle (expense / income)
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('txType').value = btn.dataset.type;
      renderCategorySelect();
    });
  });

  // Add transaction form
  document.getElementById('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('txType').value;
    const amount = document.getElementById('amountInput').value;
    const categoryId = document.getElementById('categorySelect').value;
    const occurredAt = document.getElementById('datetimeInput').value;
    const note = document.getElementById('noteInput').value;

    if (!categoryId) {
      toast('Add a category first');
      return;
    }

    try {
      await createTransaction({
        type,
        amount,
        category_id: Number(categoryId),
        occurred_at: occurredAt,
        note,
      });
      toast(type === 'income' ? 'Income logged' : 'Expense logged');

      document.getElementById('amountInput').value = '';
      document.getElementById('noteInput').value = '';
      setDefaultDatetime();

      // If entry is in a different month than currently viewed, jump there
      const entryMonth = occurredAt.slice(0, 7);
      if (entryMonth !== state.currentMonth) {
        const summary = await getSummary();
        populateMonthSelect(summary.available_months, entryMonth);
        await changeMonth(entryMonth);
      } else {
        await refreshAll();
      }
    } catch (err) {
      toast(err.message || 'Could not add entry');
    }
  });

  // Category modal
  document.getElementById('manageCategoriesBtn').addEventListener('click', () => {
    renderCategoryManageList();
    document.getElementById('categoryModalOverlay').hidden = false;
  });
  document.getElementById('closeCategoryModal').addEventListener('click', closeCategoryModal);
  document.getElementById('categoryModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'categoryModalOverlay') closeCategoryModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('categoryModalOverlay').hidden) {
      closeCategoryModal();
    }
  });

  document.getElementById('newCategoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('newCategoryName');
    const colorInput = document.getElementById('newCategoryColor');
    const name = nameInput.value.trim();
    if (!name) return;

    try {
      await createCategory(name, colorInput.value);
      nameInput.value = '';
      state.categories = await getCategories();
      renderCategorySelect();
      renderCategoryManageList();
      toast('Category added');
    } catch (err) {
      toast(err.message || 'Could not add category');
    }
  });
}

function closeCategoryModal() {
  document.getElementById('categoryModalOverlay').hidden = true;
}



// =============================================================================
// TRANSACTION SHEET MODAL
// =============================================================================

let sheetSort = { field: 'date', dir: 'desc' };

function openSheetModal() {
  renderSheetModal();
  document.getElementById('sheetModalOverlay').hidden = false;
}

function closeSheetModal() {
  document.getElementById('sheetModalOverlay').hidden = true;
}

function getSheetRows() {
  const typeFilter = document.getElementById('sheetTypeFilter').value;
  const catFilter  = document.getElementById('sheetCatFilter').value;

  let rows = state.transactions.filter(tx => {
    if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
    if (catFilter  !== 'all' && String(tx.category_id) !== catFilter)  return false;
    return true;
  });

  rows = rows.slice().sort((a, b) => {
    if (sheetSort.field === 'date') {
      const diff = new Date(a.occurred_at) - new Date(b.occurred_at);
      return sheetSort.dir === 'asc' ? diff : -diff;
    } else {
      const diff = a.amount - b.amount;
      return sheetSort.dir === 'asc' ? diff : -diff;
    }
  });

  return rows;
}

function renderSheetModal() {
  // Populate category filter
  const catSel = document.getElementById('sheetCatFilter');
  const prevCat = catSel.value;
  catSel.innerHTML = '<option value="all">All categories</option>';
  state.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    catSel.appendChild(opt);
  });
  if (prevCat) catSel.value = prevCat;

  const rows = getSheetRows();
  const totalIncome  = rows.filter(r => r.type === 'income' ).reduce((s, r) => s + r.amount, 0);
  const totalExpense = rows.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const net = totalIncome - totalExpense;

  // Summary bar
  document.getElementById('sheetSummaryBar').innerHTML = `
    <div class="sheet-stat">
      <span class="sheet-stat-label">Showing</span>
      <span class="sheet-stat-value">${rows.length} entries</span>
    </div>
    <div class="sheet-stat">
      <span class="sheet-stat-label">Income</span>
      <span class="sheet-stat-value income">${fmt(totalIncome)}</span>
    </div>
    <div class="sheet-stat">
      <span class="sheet-stat-label">Spent</span>
      <span class="sheet-stat-value expense">${fmt(totalExpense)}</span>
    </div>
    <div class="sheet-stat">
      <span class="sheet-stat-label">Net</span>
      <span class="sheet-stat-value ${net >= 0 ? 'income' : 'expense'}">${fmt(net)}</span>
    </div>
  `;

  const tbody = document.getElementById('sheetBody');
  const emptyEl = document.getElementById('sheetEmpty');

  if (!rows.length) {
    tbody.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  // Update sort arrows
  document.querySelectorAll('.sheet-table thead th.sortable').forEach(th => {
    const s = th.dataset.sort;
    const arrow = th.querySelector('.sort-arrow');
    th.classList.toggle('sort-active', s === sheetSort.field);
    if (s === sheetSort.field) {
      arrow.textContent = sheetSort.dir === 'asc' ? '↑' : '↓';
    } else {
      arrow.textContent = '↕';
    }
  });

  tbody.innerHTML = rows.map(tx => {
    const dt = new Date(tx.occurred_at);
    const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const isIncome = tx.type === 'income';

    return `<tr>
      <td class="tx-date">${dateStr}, ${timeStr}</td>
      <td><span class="sheet-type-badge ${tx.type}">${tx.type}</span></td>
      <td>
        <span class="tx-category">
          <span class="tx-cat-dot" style="background:${tx.category_color || '#9A9DA6'}"></span>
          ${escapeHtml(tx.category_name || 'Uncategorized')}
        </span>
      </td>
      <td class="tx-note" title="${escapeHtml(tx.note || '')}">${escapeHtml(tx.note || '—')}</td>
      <td class="tx-amount ${isIncome ? 'income' : 'expense'}" style="text-align:right">
        ${isIncome ? '+' : ''}${fmtPrecise(tx.amount)}
      </td>
    </tr>`;
  }).join('');
}

function exportSheetCSV() {
  const rows = getSheetRows();
  const headers = ['Date', 'Time', 'Type', 'Category', 'Note', 'Amount'];
  const lines = [headers.join(',')];
  rows.forEach(tx => {
    const dt = new Date(tx.occurred_at);
    const date = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const amount = tx.type === 'income' ? tx.amount : -tx.amount;
    lines.push([
      date, time, tx.type,
      `"${(tx.category_name || 'Uncategorized').replace(/"/g, '""')}"`,
      `"${(tx.note || '').replace(/"/g, '""')}"`,
      amount.toFixed(2)
    ].join(','));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ledger-${state.currentMonth}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported');
}

function bindSheetHandlers() {
  document.getElementById('openSheetBtn').addEventListener('click', openSheetModal);
  document.getElementById('closeSheetModal').addEventListener('click', closeSheetModal);
  document.getElementById('sheetModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'sheetModalOverlay') closeSheetModal();
  });

  ['sheetTypeFilter', 'sheetCatFilter'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderSheetModal);
  });

  document.getElementById('sheetSortSelect').addEventListener('change', (e) => {
    const [field, dir] = e.target.value.split('-');
    sheetSort = { field, dir };
    renderSheetModal();
  });

  document.querySelectorAll('.sheet-table thead th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (sheetSort.field === field) {
        sheetSort.dir = sheetSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sheetSort = { field, dir: field === 'date' ? 'desc' : 'desc' };
      }
      renderSheetModal();
    });
  });

  document.getElementById('exportCsvBtn').addEventListener('click', exportSheetCSV);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('sheetModalOverlay').hidden) {
      closeSheetModal();
    }
  });
}

// =============================================================================
// COMPARISON CHART MODAL
// =============================================================================

const compareState = {
  months: 6,
  activeCats: new Set(['all']),  // 'all' means no filter
  chartInstance: null,
  data: null,
};

function openCompareModal() {
  document.getElementById('compareModalOverlay').hidden = false;
  loadAndRenderCompare();
}

function closeCompareModal() {
  document.getElementById('compareModalOverlay').hidden = true;
}

async function loadAndRenderCompare() {
  const catIds = compareState.activeCats.has('all')
    ? null
    : [...compareState.activeCats].map(Number);

  compareState.data = await getTrends(compareState.months, catIds);
  renderCompareCatChips();
  renderCompareChart();
  renderCompareTable();
}

function renderCompareCatChips() {
  const wrap = document.getElementById('compareCatFilters');
  const cats = compareState.data.all_categories;

  const allActive = compareState.activeCats.has('all');

  let html = `<button class="cat-chip all-chip ${allActive ? 'active' : ''}" data-id="all">All</button>`;
  html += cats.map(c => {
    const isActive = !allActive && compareState.activeCats.has(String(c.id));
    return `<button class="cat-chip ${isActive ? 'active' : ''}" data-id="${c.id}" style="${isActive ? 'border-color:' + c.color + ';color:' + c.color : ''}">
      <span class="cat-chip-dot" style="background:${c.color}"></span>${escapeHtml(c.name)}
    </button>`;
  }).join('');

  wrap.innerHTML = html;

  wrap.querySelectorAll('.cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.id;
      if (id === 'all') {
        compareState.activeCats = new Set(['all']);
      } else {
        compareState.activeCats.delete('all');
        if (compareState.activeCats.has(id)) {
          compareState.activeCats.delete(id);
          if (compareState.activeCats.size === 0) compareState.activeCats.add('all');
        } else {
          compareState.activeCats.add(id);
        }
      }
      loadAndRenderCompare();
    });
  });
}

function renderCompareChart() {
  const canvas = document.getElementById('compareChart');
  const { months, by_category, overall } = compareState.data;

  // Build dataset per category (stacked bars)
  const catMap = {};
  by_category.forEach(r => {
    const key = r.category_id;
    if (!catMap[key]) {
      catMap[key] = { label: r.category_name, color: r.category_color, data: {} };
    }
    catMap[key].data[r.ym] = r.total;
  });

  // Month labels
  const labels = months.map(ym => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  });

  // Datasets: one bar per category (stacked), plus a line for income
  const datasets = Object.values(catMap).map(cat => ({
    type: 'bar',
    label: cat.label,
    data: months.map(ym => cat.data[ym] || 0),
    backgroundColor: cat.color + 'cc',
    borderColor: cat.color,
    borderWidth: 1,
    stack: 'expenses',
  }));

  // Income line overlay
  const incomeData = months.map(ym => {
    const row = overall.find(r => r.ym === ym);
    return row ? row.income : 0;
  });
  datasets.push({
    type: 'line',
    label: 'Income',
    data: incomeData,
    borderColor: '#1F6F5C',
    backgroundColor: 'transparent',
    borderWidth: 2,
    pointBackgroundColor: '#1F6F5C',
    pointRadius: 4,
    tension: 0.3,
    stack: undefined,
    order: -1,
  });

  // Destroy old chart
  if (compareState.chartInstance) {
    compareState.chartInstance.destroy();
    compareState.chartInstance = null;
  }

  // Load Chart.js dynamically if not already loaded
  function buildChart() {
    const ctx = canvas.getContext('2d');
    const currentYm = state.currentMonth;

    compareState.chartInstance = new Chart(ctx, {
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { family: "'Inter', sans-serif", size: 11 },
              padding: 14,
              boxWidth: 12,
              boxHeight: 12,
            }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: { color: '#DDD7C7' },
            ticks: { font: { family: "'JetBrains Mono', monospace", size: 11 } }
          },
          y: {
            stacked: true,
            grid: { color: '#DDD7C7' },
            ticks: {
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              callback: (v) => fmt(v)
            }
          }
        }
      }
    });

    // Highlight the currently viewed month bar
    const currentIdx = months.indexOf(currentYm);
    if (currentIdx >= 0) {
      // Apply a subtle highlight via afterDraw plugin — just mark it in the label
      labels[currentIdx] = labels[currentIdx] + ' ◀';
      compareState.chartInstance.data.labels = labels;
      compareState.chartInstance.update('none');
    }
  }

  if (window.Chart) {
    buildChart();
  } else {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    script.onload = buildChart;
    document.head.appendChild(script);
  }
}

function renderCompareTable() {
  const wrap = document.getElementById('compareTableWrap');
  const { months, by_category, overall } = compareState.data;
  if (!months.length) { wrap.innerHTML = ''; return; }

  // Build: rows = categories, cols = months
  const catMap = {};
  by_category.forEach(r => {
    if (!catMap[r.category_id]) catMap[r.category_id] = { name: r.category_name, color: r.category_color, totals: {} };
    catMap[r.category_id].totals[r.ym] = r.total;
  });

  const currentYm = state.currentMonth;

  const colHeaders = months.map(ym => {
    const [y, m] = ym.split('-').map(Number);
    const label = new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    const isCurrent = ym === currentYm;
    return `<th class="${isCurrent ? 'highlight-col' : ''}">${label}${isCurrent ? ' ◀' : ''}</th>`;
  }).join('');

  const catRows = Object.values(catMap).map(cat => {
    const cells = months.map(ym => {
      const v = cat.totals[ym] || 0;
      const isCurrent = ym === currentYm;
      return `<td class="${isCurrent ? 'highlight-col' : ''}">${v > 0 ? fmt(v) : '—'}</td>`;
    }).join('');
    return `<tr>
      <td>
        <span style="display:inline-flex;align-items:center;gap:6px">
          <span style="width:8px;height:8px;border-radius:50%;background:${cat.color};flex-shrink:0;display:inline-block"></span>
          ${escapeHtml(cat.name)}
        </span>
      </td>
      ${cells}
    </tr>`;
  }).join('');

  // Totals row
  const totalCells = months.map(ym => {
    const row = overall.find(r => r.ym === ym);
    const v = row ? row.expense : 0;
    const isCurrent = ym === currentYm;
    return `<td class="${isCurrent ? 'highlight-col' : ''}" style="font-weight:700">${v > 0 ? fmt(v) : '—'}</td>`;
  }).join('');

  wrap.innerHTML = `
    <table class="compare-summary-table">
      <thead><tr><th>Category</th>${colHeaders}</tr></thead>
      <tbody>
        ${catRows}
        <tr style="border-top:2px solid var(--rule-strong)">
          <td style="font-weight:700">Total spent</td>
          ${totalCells}
        </tr>
      </tbody>
    </table>`;
}

function bindCompareHandlers() {
  document.getElementById('openCompareBtn').addEventListener('click', openCompareModal);
  document.getElementById('closeCompareModal').addEventListener('click', closeCompareModal);
  document.getElementById('compareModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'compareModalOverlay') closeCompareModal();
  });

  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      compareState.months = Number(btn.dataset.months);
      loadAndRenderCompare();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('compareModalOverlay').hidden) {
      closeCompareModal();
    }
  });
}

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

initAuth().catch(err => {
  console.error(err);
  toast('Could not load — check the console for errors');
});