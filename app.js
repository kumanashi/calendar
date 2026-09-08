const $ = (id) => document.getElementById(id);
const TZ = 'Asia/Taipei';
const WEEKDAYS = ['週日','週一','週二','週三','週四','週五','週六'];
const SHIFT_TYPES = {
  morning: '早診',
  afternoon: '午診',
  evening: '晚診',
  support: '支援',
  health: '健檢',
  midmonth: '月中',
  vaccine: '疫苗',
  other: '其他'
};
const TYPE_COLORS = {
  morning: '#64748b',
  afternoon: '#a16207',
  evening: '#475569',
  support: '#0f766e',
  health: '#7c3aed',
  midmonth: '#b45309',
  vaccine: '#0369a1',
  other: '#6b7280'
};
const state = {
  shifts: [],
  cursor: new Date(),
  tokenClient: null,
  googleToken: null,
  pendingGoogleAction: null
};

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function monthKey(date = state.cursor) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}
function escapeHtml(s='') {
  return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function money(value) {
  return `NT$ ${Math.round(toNum(value)).toLocaleString('zh-TW')}`;
}
function normalizeType(type, session='') {
  if (SHIFT_TYPES[type]) return type;
  const text = String(session || '').trim();
  if (text.includes('早')) return 'morning';
  if (text.includes('午')) return 'afternoon';
  if (text.includes('晚')) return 'evening';
  if (type === 'holiday' || type === 'support') return 'support';
  return 'other';
}
function typeLabel(shift) {
  return shift.type === 'other' && shift.customType ? shift.customType : (SHIFT_TYPES[shift.type] || '其他');
}
function shiftColor(shift) {
  return /^#[0-9a-f]{6}$/i.test(shift?.color || '') ? shift.color : (TYPE_COLORS[shift?.type] || TYPE_COLORS.other);
}
function syncTypeUi(prefix='') {
  const isBulk = prefix === 'bulk';
  const typeEl = $(isBulk ? 'bulkTypeInput' : 'typeInput');
  const customLabel = $(isBulk ? 'bulkCustomTypeLabel' : 'customTypeLabel');
  const colorEl = $(isBulk ? 'bulkColorInput' : 'colorInput');
  const colorValue = $(isBulk ? 'bulkColorValue' : 'colorValue');
  if (!typeEl || !customLabel || !colorEl) return;
  customLabel.classList.toggle('hidden', typeEl.value !== 'other');
  if (colorValue) colorValue.textContent = colorEl.value.toUpperCase();
}
function timeRange(s) { return `${s.start}–${s.end}`; }
function localDate(dateStr, time='00:00') { return new Date(`${dateStr}T${time}:00+08:00`); }
function getCalendarId() { return localStorage.getItem('roster_google_calendar_id') || ''; }
function cacheKey() { return `roster_cache_${getCalendarId() || 'unset'}`; }
function saveCache() { localStorage.setItem(cacheKey(), JSON.stringify(state.shifts)); }
function loadCache() {
  try { state.shifts = JSON.parse(localStorage.getItem(cacheKey()) || '[]'); }
  catch { state.shifts = []; }
}
function showToast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 2700);
}
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

function getIncomeSettings(key = monthKey()) {
  try {
    return { license: 0, ppf: 0, support: 0, insurance: 0, ...JSON.parse(localStorage.getItem(`roster_income_${key}`) || '{}') };
  } catch {
    return { license: 0, ppf: 0, support: 0, insurance: 0 };
  }
}
function setIncomeSettings(key, data) {
  localStorage.setItem(`roster_income_${key}`, JSON.stringify(data));
}

function renderToday() {
  const now = new Date();
  $('todayTitle').textContent = `${now.getMonth()+1} 月 ${now.getDate()} 日 ${WEEKDAYS[now.getDay()]}`;
  const list = state.shifts.filter(s => s.date === ymd(now)).sort((a,b) => a.start.localeCompare(b.start));
  $('todayCount').textContent = `${list.length} 班`;
  $('todayShifts').innerHTML = list.length ? list.map(s => `
    <button class="today-shift" data-edit="${s.id}" type="button" style="--marker:${shiftColor(s)}">
      <div class="shift-title-row"><span class="color-dot"></span><div class="shift-title">${escapeHtml(s.title)}</div><span class="type-badge">${escapeHtml(typeLabel(s))}</span></div>
      <div class="shift-meta">${timeRange(s)}${s.location ? ` · ${escapeHtml(s.location)}` : ''}</div>
      ${toNum(s.fee) ? `<div class="shift-fee">節費 ${money(s.fee)}</div>` : ''}
    </button>`).join('') : '<div class="empty">今天沒有排班</div>';
}

function renderIncome() {
  const key = monthKey();
  const [year, month] = key.split('-').map(Number);
  const settings = getIncomeSettings(key);
  const monthlyShifts = state.shifts.filter(s => {
    const d = localDate(s.date);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  });
  const shiftFees = monthlyShifts.reduce((sum, s) => sum + toNum(s.fee), 0);
  const total = toNum(settings.license) + shiftFees + toNum(settings.ppf) + toNum(settings.support) - toNum(settings.insurance);
  $('incomeTitle').textContent = `${year} 年 ${month} 月預估收入`;
  $('incomeTotal').textContent = money(total);
  $('incomeLicense').textContent = money(settings.license);
  $('incomeShiftFees').textContent = money(shiftFees);
  $('incomePpf').textContent = money(settings.ppf);
  $('incomeSupport').textContent = money(settings.support);
  $('incomeInsurance').textContent = `− ${money(settings.insurance)}`;
  $('incomeFormula').textContent = `${money(settings.license)} + ${money(shiftFees)} + ${money(settings.ppf)} + ${money(settings.support)} − ${money(settings.insurance)}`;
}

function renderCalendar() {
  const y = state.cursor.getFullYear();
  const m = state.cursor.getMonth();
  $('monthTitle').textContent = `${y} 年 ${m+1} 月`;
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());
  const today = ymd(new Date());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = ymd(d);
    const dayShifts = state.shifts.filter(s => s.date === dateStr).sort((a,b) => a.start.localeCompare(b.start));
    const shown = dayShifts.slice(0, 3);
    const outside = d.getMonth() !== m;
    cells.push(`<div class="day-cell ${outside ? 'outside' : ''} ${dateStr === today ? 'today' : ''}">
      <div class="day-head"><span class="day-number">${d.getDate()}</span><button class="day-add" data-add-date="${dateStr}" type="button" aria-label="新增班別">＋</button></div>
      ${shown.map(s => `<button class="event-chip" data-edit="${s.id}" type="button" style="--marker:${shiftColor(s)}"><strong><i class="chip-dot"></i>${escapeHtml(typeLabel(s))} · ${escapeHtml(s.title)}</strong><span>${timeRange(s)}${toNum(s.fee) ? ` · ${money(s.fee).replace('NT$ ','$')}` : ''}</span></button>`).join('')}
      ${dayShifts.length > 3 ? `<div class="more-chip">＋${dayShifts.length-3} 班</div>` : ''}
    </div>`);
  }
  $('calendarGrid').innerHTML = cells.join('');
}

function renderAll() {
  renderToday();
  renderIncome();
  renderCalendar();
  wireDynamic();
}
function wireDynamic() {
  document.querySelectorAll('[data-edit]').forEach(el => {
    el.onclick = () => openShiftModal(state.shifts.find(s => s.id === el.dataset.edit));
  });
  document.querySelectorAll('[data-add-date]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      openShiftModal(null, el.dataset.addDate);
    };
  });
}

function openShiftModal(shift = null, date = null) {
  $('shiftForm').reset();
  $('shiftId').value = shift?.id || '';
  $('shiftModalTitle').textContent = shift ? '編輯排班' : '新增單次排班';
  $('titleInput').value = shift?.title || '';
  $('locationInput').value = shift?.location || '';
  $('dateInput').value = shift?.date || date || ymd(new Date());
  const normalizedType = normalizeType(shift?.type || 'morning', shift?.session || '');
  $('typeInput').value = normalizedType;
  $('startInput').value = shift?.start || '09:00';
  $('endInput').value = shift?.end || '12:00';
  $('feeInput').value = toNum(shift?.fee) || '';
  $('customTypeInput').value = shift?.customType || (normalizedType === 'other' && shift?.session && !['其他','門診','假日班'].includes(shift.session) ? shift.session : '');
  $('colorInput').value = shiftColor({ ...shift, type: normalizedType });
  $('noteInput').value = shift?.note || '';
  syncTypeUi('');
  $('deleteShiftBtn').classList.toggle('hidden', !shift);
  openModal('shiftModal');
  setTimeout(() => $('titleInput').focus(), 20);
}

function addMonthsPreserveDate(date, months) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const targetMonth = d.getMonth() + months;
  const day = d.getDate();
  const result = new Date(d.getFullYear(), targetMonth, 1);
  const last = new Date(result.getFullYear(), result.getMonth()+1, 0).getDate();
  result.setDate(Math.min(day, last));
  return result;
}
function bulkDates() {
  const fromValue = $('bulkFromInput').value;
  if (!fromValue) return [];
  const start = localDate(fromValue);
  const preset = $('bulkRangePreset').value;
  let end;
  if (preset === 'custom') {
    if (!$('bulkToInput').value) return [];
    end = localDate($('bulkToInput').value, '23:59');
  } else {
    end = addMonthsPreserveDate(start, Number(preset));
    end.setDate(end.getDate() - 1);
    end.setHours(23,59,59,999);
  }
  if (end < start) return [];
  const weekdays = new Set([...document.querySelectorAll('input[name="bulkWeekday"]:checked')].map(el => Number(el.value)));
  if (!weekdays.size) return [];
  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
    if (weekdays.has(d.getDay())) dates.push(ymd(d));
  }
  return dates;
}
function updateBulkPreview() {
  const dates = bulkDates();
  const preset = $('bulkRangePreset').value;
  $('bulkToLabel').classList.toggle('hidden', preset !== 'custom');
  if (!dates.length) {
    $('bulkPreview').textContent = '請選擇至少一個星期，並確認排班期間。';
    return;
  }
  $('bulkPreview').innerHTML = `預計建立 <strong>${dates.length}</strong> 班：${dates.slice(0,4).join('、')}${dates.length > 4 ? `… 到 ${dates.at(-1)}` : ''}`;
}
function openBulkModal() {
  $('bulkForm').reset();
  $('bulkTypeInput').value = 'evening';
  $('bulkStartInput').value = '18:00';
  $('bulkEndInput').value = '21:00';
  $('bulkColorInput').value = TYPE_COLORS.evening;
  $('bulkCustomTypeInput').value = '';
  $('bulkRangePreset').value = '2';
  $('bulkFromInput').value = ymd(new Date());
  document.querySelector(`input[name="bulkWeekday"][value="${new Date().getDay()}"]`).checked = true;
  syncTypeUi('bulk');
  updateBulkPreview();
  openModal('bulkModal');
}

function openIncomeModal() {
  const key = monthKey();
  const [year, month] = key.split('-');
  const settings = getIncomeSettings(key);
  $('incomeModalTitle').textContent = `${year} 年 ${Number(month)} 月收入設定`;
  $('licenseFeeInput').value = toNum(settings.license) || '';
  $('ppfInput').value = toNum(settings.ppf) || '';
  $('supportIncomeInput').value = toNum(settings.support) || '';
  $('insuranceCostInput').value = toNum(settings.insurance) || '';
  updateIncomeEquation();
  openModal('incomeModal');
}
function currentMonthShiftFees() {
  const key = monthKey();
  return state.shifts.filter(s => s.date.startsWith(key)).reduce((sum, s) => sum + toNum(s.fee), 0);
}
function updateIncomeEquation() {
  const license = toNum($('licenseFeeInput').value);
  const ppf = toNum($('ppfInput').value);
  const support = toNum($('supportIncomeInput').value);
  const insurance = toNum($('insuranceCostInput').value);
  const fees = currentMonthShiftFees();
  const total = license + fees + ppf + support - insurance;
  $('incomeEquation').innerHTML = `${money(license)} + ${money(fees)} 節費 + ${money(ppf)} + ${money(support)} − ${money(insurance)} = <strong>${money(total)}</strong>`;
}

function taipeiParts(dateTime) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false
  }).formatToParts(new Date(dateTime));
  const o = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}` };
}
function googleEventToShift(ev) {
  if (!ev?.id || ev.status === 'cancelled') return null;
  const privateProps = ev.extendedProperties?.private || {};
  if (privateProps.rosterMeta === 'income') return null;
  if (ev.start?.dateTime) {
    const start = taipeiParts(ev.start.dateTime);
    const end = taipeiParts(ev.end?.dateTime || ev.start.dateTime);
    return {
      id: ev.id,
      title: ev.summary || '(未命名班別)',
      location: ev.location || '',
      date: start.date,
      start: start.time,
      end: end.time,
      type: normalizeType(privateProps.rosterType || 'other', privateProps.rosterSession || ''),
      fee: toNum(privateProps.rosterFee),
      session: privateProps.rosterSession || '',
      customType: privateProps.rosterCategoryLabel || '',
      color: privateProps.rosterColor || '',
      note: ev.description || ''
    };
  }
  if (ev.start?.date) {
    return {
      id: ev.id,
      title: ev.summary || '(全天事件)',
      location: ev.location || '',
      date: ev.start.date,
      start: '00:00',
      end: '23:59',
      type: normalizeType(privateProps.rosterType || 'other', privateProps.rosterSession || ''),
      fee: toNum(privateProps.rosterFee),
      session: privateProps.rosterSession || '',
      customType: privateProps.rosterCategoryLabel || '',
      color: privateProps.rosterColor || '',
      note: ev.description || ''
    };
  }
  return null;
}
function nextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate()+1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function googleEventPayload(s) {
  const endDate = s.end <= s.start ? nextDay(s.date) : s.date;
  return {
    summary: s.title,
    location: s.location || undefined,
    description: s.note || undefined,
    start: { dateTime: `${s.date}T${s.start}:00+08:00`, timeZone: TZ },
    end: { dateTime: `${endDate}T${s.end}:00+08:00`, timeZone: TZ },
    extendedProperties: {
      private: {
        rosterType: s.type,
        rosterFee: String(toNum(s.fee)),
        rosterSession: typeLabel(s),
        rosterCategoryLabel: s.type === 'other' ? (s.customType || '') : '',
        rosterColor: shiftColor(s),
        rosterApp: 'github-pages-roster-v3'
      }
    }
  };
}

async function googleFetch(path, options = {}) {
  if (!state.googleToken) throw new Error('尚未取得 Google 授權');
  const url = path.startsWith('http') ? path : `https://www.googleapis.com/calendar/v3${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.googleToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch {}
    if (res.status === 401) state.googleToken = null;
    throw new Error(detail || `Google API ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function fetchAllEvents() {
  const calendarId = getCalendarId();
  if (!calendarId) throw new Error('請先設定排班 Calendar ID');
  let pageToken = '';
  const all = [];
  do {
    const qs = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      timeZone: TZ,
      timeMin: `${new Date().getFullYear()-1}-01-01T00:00:00+08:00`,
      timeMax: `${new Date().getFullYear()+2}-12-31T23:59:59+08:00`
    });
    if (pageToken) qs.set('pageToken', pageToken);
    const data = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${qs}`);
    all.push(...(data.items || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  state.shifts = all.map(googleEventToShift).filter(Boolean).sort((a,b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));
  saveCache();
  renderAll();
  $('syncStatus').textContent = `已連線 · ${state.shifts.length} 筆排班 · ${new Date().toLocaleTimeString('zh-TW', {hour:'2-digit', minute:'2-digit'})} 更新`;
}

function initGoogleTokenClient() {
  const clientId = localStorage.getItem('roster_google_client_id') || '';
  if (!clientId) throw new Error('請先設定 Google OAuth Client ID');
  if (!window.google?.accounts?.oauth2) throw new Error('Google 登入元件尚未載入，請稍後再試');
  if (state.tokenClient) return;
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    callback: async (resp) => {
      if (resp.error) {
        showToast(`Google 授權失敗：${resp.error}`);
        state.pendingGoogleAction = null;
        return;
      }
      state.googleToken = resp.access_token;
      const action = state.pendingGoogleAction;
      state.pendingGoogleAction = null;
      if (action) {
        try { await action(); }
        catch (err) {
          showToast(err.message);
          $('syncStatus').textContent = `同步失敗：${err.message}`;
        }
      }
    }
  });
}
function withGoogleAccess(action) {
  const clientId = localStorage.getItem('roster_google_client_id') || '';
  const calendarId = getCalendarId();
  if (!clientId || !calendarId) {
    openSettings();
    showToast('請先完成 Google 同步設定');
    return;
  }
  if (state.googleToken) {
    action().catch(err => {
      showToast(err.message);
      $('syncStatus').textContent = `同步失敗：${err.message}`;
    });
    return;
  }
  try {
    initGoogleTokenClient();
    state.pendingGoogleAction = action;
    state.tokenClient.requestAccessToken({ prompt: 'consent' });
  } catch (err) {
    showToast(err.message);
  }
}

$('shiftForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('shiftId').value;
  const payload = {
    title: $('titleInput').value.trim(),
    location: $('locationInput').value.trim(),
    date: $('dateInput').value,
    type: $('typeInput').value,
    start: $('startInput').value,
    end: $('endInput').value,
    fee: toNum($('feeInput').value),
    customType: $('typeInput').value === 'other' ? $('customTypeInput').value.trim() : '',
    color: $('colorInput').value,
    note: $('noteInput').value.trim()
  };
  withGoogleAccess(async () => {
    const calendarId = getCalendarId();
    if (id) {
      await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(googleEventPayload(payload))
      });
    } else {
      await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: 'POST',
        body: JSON.stringify(googleEventPayload(payload))
      });
    }
    closeModal('shiftModal');
    await fetchAllEvents();
    showToast(id ? '班表已更新' : '班表已新增');
  });
});

$('deleteShiftBtn').onclick = () => {
  const id = $('shiftId').value;
  if (!id || !confirm('確定刪除這個班別？Google Calendar 中的事件也會一起刪除。')) return;
  withGoogleAccess(async () => {
    const calendarId = getCalendarId();
    await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
    closeModal('shiftModal');
    await fetchAllEvents();
    showToast('班表已刪除');
  });
};

$('bulkForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const dates = bulkDates();
  if (!dates.length) {
    showToast('請選擇星期與有效的日期範圍');
    return;
  }
  if (dates.length > 200) {
    showToast('一次最多建立 200 班，請縮短日期範圍');
    return;
  }
  const base = {
    title: $('bulkTitleInput').value.trim(),
    location: $('bulkLocationInput').value.trim(),
    type: $('bulkTypeInput').value,
    start: $('bulkStartInput').value,
    end: $('bulkEndInput').value,
    fee: toNum($('bulkFeeInput').value),
    customType: $('bulkTypeInput').value === 'other' ? $('bulkCustomTypeInput').value.trim() : '',
    color: $('bulkColorInput').value,
    note: $('bulkNoteInput').value.trim()
  };
  withGoogleAccess(async () => {
    const calendarId = getCalendarId();
    $('bulkSubmitBtn').disabled = true;
    try {
      for (let i = 0; i < dates.length; i++) {
        $('bulkSubmitBtn').textContent = `建立中 ${i+1}/${dates.length}`;
        await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
          method: 'POST',
          body: JSON.stringify(googleEventPayload({ ...base, date: dates[i] }))
        });
      }
      closeModal('bulkModal');
      await fetchAllEvents();
      showToast(`已建立 ${dates.length} 班固定排班`);
    } finally {
      $('bulkSubmitBtn').disabled = false;
      $('bulkSubmitBtn').textContent = '建立固定排班';
    }
  });
});

$('incomeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const key = monthKey();
  setIncomeSettings(key, {
    license: toNum($('licenseFeeInput').value),
    ppf: toNum($('ppfInput').value),
    support: toNum($('supportIncomeInput').value),
    insurance: toNum($('insuranceCostInput').value)
  });
  closeModal('incomeModal');
  renderIncome();
  showToast(`${key} 收入設定已儲存`);
});

$('prevMonth').onclick = () => {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth()-1, 1);
  renderCalendar();
  renderIncome();
  wireDynamic();
};
$('nextMonth').onclick = () => {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth()+1, 1);
  renderCalendar();
  renderIncome();
  wireDynamic();
};
$('todayBtn').onclick = () => {
  state.cursor = new Date();
  renderCalendar();
  renderIncome();
  wireDynamic();
};
$('addShiftBtn').onclick = () => openShiftModal();
$('bulkShiftBtn').onclick = openBulkModal;
$('incomeSettingsBtn').onclick = openIncomeModal;
$('settingsBtn').onclick = openSettings;
$('refreshBtn').onclick = () => withGoogleAccess(fetchAllEvents);

document.querySelectorAll('[data-close]').forEach(el => {
  el.onclick = () => closeModal(el.dataset.close);
});
document.querySelectorAll('.modal-backdrop').forEach(el => {
  el.addEventListener('click', e => {
    if (e.target === el) closeModal(el.id);
  });
});
document.querySelectorAll('input[name="bulkWeekday"]').forEach(el => el.addEventListener('change', updateBulkPreview));
['bulkRangePreset','bulkFromInput','bulkToInput'].forEach(id => $(id).addEventListener('change', updateBulkPreview));
['licenseFeeInput','ppfInput','supportIncomeInput','insuranceCostInput'].forEach(id => $(id).addEventListener('input', updateIncomeEquation));
$('typeInput').addEventListener('change', () => {
  const defaultColor = TYPE_COLORS[$('typeInput').value] || TYPE_COLORS.other;
  $('colorInput').value = defaultColor;
  syncTypeUi('');
});
$('bulkTypeInput').addEventListener('change', () => {
  const defaultColor = TYPE_COLORS[$('bulkTypeInput').value] || TYPE_COLORS.other;
  $('bulkColorInput').value = defaultColor;
  syncTypeUi('bulk');
});
$('colorInput').addEventListener('input', () => syncTypeUi(''));
$('bulkColorInput').addEventListener('input', () => syncTypeUi('bulk'));

function openSettings() {
  $('googleClientId').value = localStorage.getItem('roster_google_client_id') || '';
  $('googleCalendarId').value = localStorage.getItem('roster_google_calendar_id') || '';
  $('appleIcsUrl').value = localStorage.getItem('roster_apple_ics_url') || '';
  openModal('settingsModal');
}
$('saveSettingsBtn').onclick = () => {
  const oldCalendarId = getCalendarId();
  const clientId = $('googleClientId').value.trim();
  const calendarId = $('googleCalendarId').value.trim();
  const appleIcs = $('appleIcsUrl').value.trim();
  if (clientId) localStorage.setItem('roster_google_client_id', clientId); else localStorage.removeItem('roster_google_client_id');
  if (calendarId) localStorage.setItem('roster_google_calendar_id', calendarId); else localStorage.removeItem('roster_google_calendar_id');
  if (appleIcs) localStorage.setItem('roster_apple_ics_url', appleIcs); else localStorage.removeItem('roster_apple_ics_url');
  state.tokenClient = null;
  state.googleToken = null;
  if (oldCalendarId !== calendarId) loadCache();
  renderAll();
  closeModal('settingsModal');
  showToast('設定已儲存');
};
$('googleSyncBtn').onclick = () => withGoogleAccess(async () => {
  $('syncStatus').textContent = '正在讀取 Google Calendar…';
  await fetchAllEvents();
  showToast('Google Calendar 已更新');
});
$('appleSubscribeBtn').onclick = () => {
  const url = localStorage.getItem('roster_apple_ics_url') || '';
  if (!url) {
    openSettings();
    showToast('請先貼上 Google Calendar 的 Secret iCal URL');
    return;
  }
  if (!/^https:\/\//i.test(url)) {
    showToast('Secret iCal URL 格式不正確');
    return;
  }
  location.href = url.replace(/^https:/i, 'webcal:');
};

loadCache();
renderAll();
if (getCalendarId() && state.shifts.length) {
  $('syncStatus').textContent = `顯示上次同步快取 · ${state.shifts.length} 筆；可按重新整理更新 Google`;
}
