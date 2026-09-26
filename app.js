window.ROSTER_VERSION = '4.7.2';
const $ = (id) => document.getElementById(id);
const TZ = 'Asia/Taipei';
const WEEKDAYS = ['週日','週一','週二','週三','週四','週五','週六'];
const APPDATA_FILENAME = 'roster-calendar-v4.2.json'; // 保留舊檔名以相容 v4.2/v4.1 資料
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.appdata';
const PIN_VERIFIER_CACHE_KEY = 'roster_pin_verifier_v46';
const PIN_ITERATIONS = 150000;

const SHIFT_TYPES = {
  morning: '早診', afternoon: '午診', evening: '晚診', support: '支援',
  health: '健檢', midmonth: '月中', vaccine: '疫苗', other: '其他'
};
const DEFAULT_TYPE_COLORS = {
  morning: '#64748b', afternoon: '#a16207', evening: '#475569', support: '#0f766e',
  health: '#7c3aed', midmonth: '#b45309', vaccine: '#0369a1', other: '#6b7280'
};

const state = {
  shifts: [],
  cursor: new Date(),
  tokenClient: null,
  googleToken: null,
  pendingGoogleAction: null,
  appDataFileId: null,
  cloudLoaded: false,
  cloudConfig: null,
  driveStatus: 'idle',
  driveLastError: '',
  batchDeleteMode: false,
  selectedShiftIds: new Set(),
  pinUnlocked: false,
  pinCloudReady: false,
  typeColors: { ...DEFAULT_TYPE_COLORS }
};

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function monthKey(date = state.cursor) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`; }
function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function toNum(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function money(value) { return `NT$ ${Math.round(toNum(value)).toLocaleString('zh-TW')}`; }
function localDate(dateStr, time='00:00') { return new Date(`${dateStr}T${time}:00+08:00`); }
function nextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function showToast(message) {
  const el = $('toast'); el.textContent = message; el.classList.remove('hidden');
  clearTimeout(showToast._t); showToast._t = setTimeout(() => el.classList.add('hidden'), 3000);
}
const MODAL_TRANSITION_MS = 180;
function openModal(id) {
  document.querySelectorAll('.modal-backdrop').forEach(el => {
    if (el.id !== id) {
      el.classList.add('hidden');
      el.classList.remove('modal-visible','modal-closing');
    }
  });
  const target = $(id);
  clearTimeout(target._closeTimer);
  target.classList.remove('hidden','modal-closing');
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => requestAnimationFrame(() => target.classList.add('modal-visible')));
}
function closeModal(id) {
  const target = $(id);
  if (!target || target.classList.contains('hidden')) return;
  clearTimeout(target._closeTimer);
  target.classList.remove('modal-visible');
  target.classList.add('modal-closing');
  const finish = () => {
    target.classList.add('hidden');
    target.classList.remove('modal-closing');
    if (![...document.querySelectorAll('.modal-backdrop')].some(el => !el.classList.contains('hidden'))) {
      document.body.classList.remove('modal-open');
    }
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
  else target._closeTimer = setTimeout(finish, MODAL_TRANSITION_MS);
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
function typeLabel(shift) { return shift.type === 'other' && shift.customType ? shift.customType : (SHIFT_TYPES[shift.type] || '其他'); }
function shiftColor(shift) { return state.typeColors[shift?.type] || state.typeColors.other || DEFAULT_TYPE_COLORS.other; }
function timeRange(s) { return `${s.start}–${s.end}`; }
function syncTypeUi(prefix='') {
  const bulk = prefix === 'bulk';
  const typeEl = $(bulk ? 'bulkTypeInput' : 'typeInput');
  const custom = $(bulk ? 'bulkCustomTypeLabel' : 'customTypeLabel');
  custom.classList.toggle('hidden', typeEl.value !== 'other');
}

function defaultCloudConfig() {
  return {
    schemaVersion: 2,
    googleClientId: '',
    calendarId: '',
    appleIcsUrl: '',
    typeColors: { ...DEFAULT_TYPE_COLORS },
    incomeSettings: {},
    security: { pin: null },
    updatedAt: null
  };
}
function readJsonStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; }
}
function cachedCloudConfig() { return readJsonStorage('roster_appdata_cache_v42', null); }
function legacyIncomeSettings() {
  const result = {};
  for (let i=0; i<localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !/^roster_income_\d{4}-\d{2}$/.test(key)) continue;
    const month = key.replace('roster_income_', '');
    const data = readJsonStorage(key, null);
    if (data) result[month] = { license: toNum(data.license), support: toNum(data.support), insurance: toNum(data.insurance) };
  }
  return result;
}
function localMigrationConfig() {
  const cached = cachedCloudConfig() || {};
  const legacyColors = readJsonStorage('roster_type_colors', {});
  return mergeCloudConfig({
    ...cached,
    googleClientId: localStorage.getItem('roster_google_client_id') || cached.googleClientId || '',
    calendarId: localStorage.getItem('roster_google_calendar_id') || cached.calendarId || '',
    appleIcsUrl: localStorage.getItem('roster_apple_ics_url') || cached.appleIcsUrl || '',
    typeColors: { ...(cached.typeColors || {}), ...legacyColors },
    incomeSettings: { ...(cached.incomeSettings || {}), ...legacyIncomeSettings() }
  });
}
function mergeCloudConfig(input={}) {
  const base = defaultCloudConfig();
  return {
    ...base,
    ...input,
    typeColors: { ...DEFAULT_TYPE_COLORS, ...(input.typeColors || {}) },
    incomeSettings: { ...(input.incomeSettings || {}) },
    security: { ...(base.security || {}), ...(input.security || {}) }
  };
}
function cacheCloudConfigLocally(config) {
  const safeCache = {
    schemaVersion: config.schemaVersion,
    googleClientId: config.googleClientId || '',
    calendarId: config.calendarId || '',
    appleIcsUrl: config.appleIcsUrl || '',
    typeColors: config.typeColors || {},
    incomeSettings: config.incomeSettings || {},
    updatedAt: config.updatedAt || null
  };
  localStorage.setItem('roster_appdata_cache_v42', JSON.stringify(safeCache));
  if (config.googleClientId) localStorage.setItem('roster_google_client_id', config.googleClientId);
}
function applyCloudConfig(config) {
  state.cloudConfig = mergeCloudConfig(config);
  cachePinVerifierFromConfig(state.cloudConfig);
  state.typeColors = { ...state.cloudConfig.typeColors };
  cacheCloudConfigLocally(state.cloudConfig);
  renderAll();
}
function getBootstrapClientId() {
  return localStorage.getItem('roster_google_client_id') || state.cloudConfig?.googleClientId || '';
}
function getCalendarId() { return state.cloudConfig?.calendarId || ''; }
function getAppleIcsUrl() { return state.cloudConfig?.appleIcsUrl || ''; }
function getIncomeSettings(key=monthKey()) {
  const d = state.cloudConfig?.incomeSettings?.[key] || {};
  return { license: toNum(d.license), support: toNum(d.support), insurance: toNum(d.insurance) };
}
function cacheKey() { return `roster_cache_${getCalendarId() || 'unset'}`; }
function saveShiftCache() { localStorage.setItem(cacheKey(), JSON.stringify(state.shifts)); }
function loadShiftCache() {
  try { state.shifts = JSON.parse(localStorage.getItem(cacheKey()) || '[]'); } catch { state.shifts = []; }
}

function getFrequentShiftValues(field, limit=16) {
  const counts = new Map();
  for (const shift of state.shifts) {
    const value = String(shift?.[field] || '').trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'))
    .slice(0, limit)
    .map(([value]) => value);
}
function updateCommonSuggestions() {
  const titleList = $('titleSuggestions');
  const locationList = $('locationSuggestions');
  if (titleList) titleList.innerHTML = getFrequentShiftValues('title').map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
  if (locationList) locationList.innerHTML = getFrequentShiftValues('location').map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
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
      ${(toNum(s.fee)||toNum(s.ppf)) ? `<div class="shift-fee">${toNum(s.fee) ? `節費 ${money(s.fee)}` : ''}${toNum(s.fee)&&toNum(s.ppf) ? ' · ' : ''}${toNum(s.ppf) ? `PPF ${money(s.ppf)}` : ''}</div>` : ''}
    </button>`).join('') : '<div class="empty">今天沒有排班</div>';
}
function monthShifts() {
  const key = monthKey();
  return state.shifts.filter(s => s.date.startsWith(key));
}
function renderIncome() {
  const key = monthKey();
  const [year, month] = key.split('-').map(Number);
  const settings = getIncomeSettings(key);
  const shifts = monthShifts();
  const shiftFees = shifts.reduce((sum,s) => sum + toNum(s.fee), 0);
  const shiftPpf = shifts.reduce((sum,s) => sum + toNum(s.ppf), 0);
  const total = settings.license + shiftFees + shiftPpf + settings.support - settings.insurance;
  $('incomeTitle').textContent = `${year} 年 ${month} 月預估收入`;
  $('incomeTotal').textContent = money(total);
  $('incomeLicense').textContent = money(settings.license);
  $('incomeShiftFees').textContent = money(shiftFees);
  $('incomePpf').textContent = money(shiftPpf);
  $('incomeSupport').textContent = money(settings.support);
  $('incomeInsurance').textContent = `− ${money(settings.insurance)}`;
  $('incomeFormula').textContent = `${money(settings.license)} + ${money(shiftFees)} + ${money(shiftPpf)} + ${money(settings.support)} − ${money(settings.insurance)}`;
}


function decorateCalendarForBatchDelete() {
  if (!state.batchDeleteMode) return;
  document.querySelectorAll('[data-shift-id]').forEach(el => {
    const id = el.dataset.shiftId;
    if (!id || el.querySelector('.batch-check')) return;
    const check = document.createElement('label');
    check.className = 'batch-check';
    check.innerHTML = `<input class="batch-select-checkbox" type="checkbox" ${state.selectedShiftIds.has(id) ? 'checked' : ''}><span></span>`;
    check.addEventListener('click', ev => ev.stopPropagation());
    const input = check.querySelector('input');
    input.addEventListener('change', ev => {
      ev.stopPropagation();
      toggleShiftSelection(id, ev.target.checked);
    });
    el.prepend(check);
  });
}

function updateBatchDeleteButton() {
  const btn = $('batchDeleteBtn');
  if (!btn) return;
  const count = state.selectedShiftIds.size;
  if (!state.batchDeleteMode) {
    btn.textContent = '☑ 批次刪除';
    btn.classList.remove('danger');
    btn.title = '批次刪除';
    return;
  }
  btn.classList.add('danger');
  btn.textContent = count > 0 ? `刪除已選 (${count})` : '取消批次刪除';
  btn.title = count > 0 ? `刪除 ${count} 筆事件` : '離開批次刪除模式';
}

function setBatchDeleteMode(enabled) {
  state.batchDeleteMode = !!enabled;
  if (!enabled) state.selectedShiftIds.clear();
  document.body.classList.toggle('batch-delete-mode', state.batchDeleteMode);
  updateBatchDeleteButton();
  renderCalendar();
  wireDynamic();
}

function toggleShiftSelection(id, checked) {
  if (checked) state.selectedShiftIds.add(id);
  else state.selectedShiftIds.delete(id);
  updateBatchDeleteButton();
}

function deleteSelectedShifts() {
  const ids = [...state.selectedShiftIds];
  if (!ids.length) {
    setBatchDeleteMode(false);
    return;
  }

  const shifts = state.shifts.filter(s => ids.includes(s.id));
  if (!shifts.length) {
    setBatchDeleteMode(false);
    return;
  }

  if (!confirm(`確定要刪除已選取的 ${shifts.length} 筆排班嗎？此動作會同步刪除 Google Calendar 事件。`)) return;

  const btn = $('batchDeleteBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = `刪除中 0/${shifts.length}`;
  }

  withGoogleAccess(async () => {
    try {
      await tryLoadAppDataConfig();
      const cal = getCalendarId();
      if (!cal) throw new Error('請先在同步設定輸入排班 Calendar ID');

      let done = 0;
      for (const shift of shifts) {
        await calendarRequest(`/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(shift.id)}`, {
          method: 'DELETE'
        });
        done += 1;
        if (btn) btn.textContent = `刪除中 ${done}/${shifts.length}`;
      }

      state.shifts = state.shifts.filter(s => !ids.includes(s.id));
      saveShiftCache();
      state.selectedShiftIds.clear();
      state.batchDeleteMode = false;
      document.body.classList.remove('batch-delete-mode');
      renderAll();
      updateBatchDeleteButton();
      showToast(`已刪除 ${shifts.length} 筆排班`);
    } finally {
      if (btn) {
        btn.disabled = false;
        updateBatchDeleteButton();
      }
    }
  });
}

function renderCalendar() {
  const y = state.cursor.getFullYear(), m = state.cursor.getMonth();
  $('monthTitle').textContent = `${y} 年 ${m+1} 月`;
  const first = new Date(y,m,1), start = new Date(y,m,1-first.getDay()), today = ymd(new Date());
  const cells=[];
  for (let i=0;i<42;i++) {
    const d=new Date(start); d.setDate(start.getDate()+i);
    const dateStr=ymd(d);
    const dayShifts=state.shifts.filter(s=>s.date===dateStr).sort((a,b)=>a.start.localeCompare(b.start));
    const shown=state.batchDeleteMode ? dayShifts : dayShifts.slice(0,3), outside=d.getMonth()!==m;
    cells.push(`<div class="day-cell ${outside?'outside':''} ${dateStr===today?'today':''}">
      <div class="day-head"><span class="day-number">${d.getDate()}</span><button class="day-add" data-add-date="${dateStr}" type="button" aria-label="新增班別">＋</button></div>
      ${shown.map(s=>`<button class="event-chip ${state.selectedShiftIds.has(s.id)?'selected-for-delete':''}" data-edit="${s.id}" data-shift-id="${s.id}" type="button" style="--marker:${shiftColor(s)}">
        ${state.batchDeleteMode?`<span class="batch-check" role="checkbox" aria-checked="${state.selectedShiftIds.has(s.id)?'true':'false'}"><span></span></span>`:''}
        <strong><i class="chip-dot"></i>${escapeHtml(typeLabel(s))} · ${escapeHtml(s.title)}</strong>
        <span>${timeRange(s)}${toNum(s.fee)?` · ${money(s.fee).replace('NT$ ','$')}`:''}${toNum(s.ppf)?` · PPF ${money(s.ppf).replace('NT$ ','$')}`:''}</span>
      </button>`).join('')}
      ${!state.batchDeleteMode && dayShifts.length>3?`<div class="more-chip">＋${dayShifts.length-3} 班</div>`:''}
    </div>`);
  }
  $('calendarGrid').innerHTML=cells.join('');
}

function renderAll() { renderToday(); renderCalendar(); renderIncome(); updateCommonSuggestions(); wireDynamic(); }
function wireDynamic() {
  document.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>{
    const shift=state.shifts.find(s=>s.id===el.dataset.edit);
    if(!shift) return;
    if(state.batchDeleteMode){
      const next=!state.selectedShiftIds.has(shift.id);
      toggleShiftSelection(shift.id,next);
      renderCalendar();
      wireDynamic();
      return;
    }
    openShiftModal(shift);
  });
  document.querySelectorAll('[data-add-date]').forEach(el=>el.onclick=(e)=>{
    e.stopPropagation();
    if(state.batchDeleteMode) return;
    openShiftModal(null,el.dataset.addDate);
  });
}

function openShiftModal(shift=null,date=null) {
  updateCommonSuggestions();
  $('shiftForm').reset();
  $('shiftId').value=shift?.id||'';
  $('shiftModalTitle').textContent=shift?'編輯排班':'新增單次排班';
  $('titleInput').value=shift?.title||'';
  $('locationInput').value=shift?.location||'';
  $('dateInput').value=shift?.date||date||ymd(new Date());
  const type=normalizeType(shift?.type||'morning',shift?.session||'');
  $('typeInput').value=type;
  $('startInput').value=shift?.start||'09:00';
  $('endInput').value=shift?.end||'12:00';
  $('feeInput').value=toNum(shift?.fee)||'';
  $('shiftPpfInput').value=toNum(shift?.ppf)||'';
  $('customTypeInput').value=shift?.customType||'';
  $('noteInput').value=shift?.note||'';
  syncTypeUi('');
  $('deleteShiftBtn').classList.toggle('hidden',!shift);
  openModal('shiftModal');
}
function addMonthsPreserveDate(date,months) {
  const result=new Date(date.getFullYear(),date.getMonth()+months,1);
  const last=new Date(result.getFullYear(),result.getMonth()+1,0).getDate();
  result.setDate(Math.min(date.getDate(),last)); return result;
}
function bulkDates() {
  const from=$('bulkFromInput').value; if(!from) return [];
  const start=localDate(from); const preset=$('bulkRangePreset').value; let end;
  if(preset==='custom') { if(!$('bulkToInput').value) return []; end=localDate($('bulkToInput').value,'23:59'); }
  else { end=addMonthsPreserveDate(start,Number(preset)); end.setDate(end.getDate()-1); end.setHours(23,59,59,999); }
  if(end<start) return [];
  const weekdays=new Set([...document.querySelectorAll('input[name="bulkWeekday"]:checked')].map(el=>Number(el.value)));
  if(!weekdays.size) return [];
  const dates=[]; for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)) if(weekdays.has(d.getDay())) dates.push(ymd(d));
  return dates;
}
function updateBulkPreview() {
  $('bulkToLabel').classList.toggle('hidden',$('bulkRangePreset').value!=='custom');
  const dates=bulkDates();
  $('bulkPreview').innerHTML=dates.length?`預計建立 <strong>${dates.length}</strong> 班：${dates.slice(0,4).join('、')}${dates.length>4?`… 到 ${dates.at(-1)}`:''}`:'請選擇星期與期間。';
}
function openBulkModal() {
  updateCommonSuggestions();
  $('bulkForm').reset(); $('bulkTypeInput').value='evening'; $('bulkStartInput').value='18:00'; $('bulkEndInput').value='21:00';
  $('bulkRangePreset').value='2'; $('bulkFromInput').value=ymd(new Date());
  const todayWeekday=document.querySelector(`input[name="bulkWeekday"][value="${new Date().getDay()}"]`); if(todayWeekday) todayWeekday.checked=true;
  syncTypeUi('bulk'); updateBulkPreview(); openModal('bulkModal');
}
function openIncomeModal() {
  const key=monthKey(), [year,month]=key.split('-'); const s=getIncomeSettings(key);
  $('incomeModalTitle').textContent=`${year} 年 ${Number(month)} 月收入設定`;
  $('licenseFeeInput').value=s.license||''; $('supportIncomeInput').value=s.support||''; $('insuranceCostInput').value=s.insurance||'';
  updateIncomeEquation(); openModal('incomeModal');
}
function updateIncomeEquation() {
  const license=toNum($('licenseFeeInput').value), support=toNum($('supportIncomeInput').value), insurance=toNum($('insuranceCostInput').value);
  const shifts=monthShifts(), fees=shifts.reduce((a,s)=>a+toNum(s.fee),0), ppf=shifts.reduce((a,s)=>a+toNum(s.ppf),0);
  $('incomeEquation').innerHTML=`${money(license)} + ${money(fees)} 節費 + ${money(ppf)} PPF + ${money(support)} − ${money(insurance)} = <strong>${money(license+fees+ppf+support-insurance)}</strong>`;
}

function taipeiParts(dateTime) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(dateTime));
  const o=Object.fromEntries(parts.map(p=>[p.type,p.value])); return {date:`${o.year}-${o.month}-${o.day}`,time:`${o.hour}:${o.minute}`};
}
function googleEventToShift(ev) {
  if(!ev?.id||ev.status==='cancelled') return null;
  const p=ev.extendedProperties?.private||{};
  if(p.rosterMeta==='income') return null; // v4 legacy special event
  if(!ev.start?.dateTime && !ev.start?.date) return null;
  let date,start,end;
  if(ev.start.dateTime) { const a=taipeiParts(ev.start.dateTime), b=taipeiParts(ev.end?.dateTime||ev.start.dateTime); date=a.date; start=a.time; end=b.time; }
  else { date=ev.start.date; start='00:00'; end='23:59'; }
  return {
    id:ev.id, title:ev.summary||'(未命名班別)', location:ev.location||'', date,start,end,
    type:normalizeType(p.rosterType||'other',p.rosterSession||''), fee:toNum(p.rosterFee), ppf:toNum(p.rosterPpf),
    session:p.rosterSession||'', customType:p.rosterCategoryLabel||'', note:ev.description||''
  };
}
function googleEventPayload(s) {
  const endDate=s.end<=s.start?nextDay(s.date):s.date;
  return {
    summary:s.title, location:s.location||undefined, description:s.note||undefined,
    start:{dateTime:`${s.date}T${s.start}:00+08:00`,timeZone:TZ}, end:{dateTime:`${endDate}T${s.end}:00+08:00`,timeZone:TZ},
    extendedProperties:{private:{
      rosterType:s.type, rosterFee:String(toNum(s.fee)), rosterPpf:String(toNum(s.ppf)), rosterSession:typeLabel(s),
      rosterCategoryLabel:s.type==='other'?(s.customType||''):'', rosterApp:'github-pages-roster-v4.2'
    }}
  };
}



function pinBytesToB64(bytes) {
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}
function pinB64ToBytes(b64) {
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
async function derivePinHash(pin, saltB64, iterations=PIN_ITERATIONS) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: pinB64ToBytes(saltB64),
    iterations,
    hash: 'SHA-256'
  }, key, 256);
  return pinBytesToB64(new Uint8Array(bits));
}
async function createPinVerifier(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = pinBytesToB64(salt);
  const hash = await derivePinHash(pin, saltB64, PIN_ITERATIONS);
  return {
    algorithm: 'PBKDF2-SHA256',
    salt: saltB64,
    hash,
    iterations: PIN_ITERATIONS,
    updatedAt: new Date().toISOString()
  };
}
function getLocalPinVerifier() {
  try {
    const v = JSON.parse(localStorage.getItem(PIN_VERIFIER_CACHE_KEY) || 'null');
    return v && v.salt && v.hash ? v : null;
  } catch {
    return null;
  }
}
function cachePinVerifier(verifier) {
  if (!verifier?.salt || !verifier?.hash) return;
  localStorage.setItem(PIN_VERIFIER_CACHE_KEY, JSON.stringify({
    algorithm: verifier.algorithm || 'PBKDF2-SHA256',
    salt: verifier.salt,
    hash: verifier.hash,
    iterations: Number(verifier.iterations) || PIN_ITERATIONS,
    updatedAt: verifier.updatedAt || null
  }));
}
function cachePinVerifierFromConfig(config) {
  const verifier = config?.security?.pin;
  if (verifier?.salt && verifier?.hash) cachePinVerifier(verifier);
}
async function verifyPin(pin, verifier) {
  if (!verifier?.salt || !verifier?.hash) return false;
  const candidate = await derivePinHash(pin, verifier.salt, Number(verifier.iterations) || PIN_ITERATIONS);
  if (candidate.length !== verifier.hash.length) return false;
  let diff = 0;
  for (let i=0; i<candidate.length; i++) diff |= candidate.charCodeAt(i) ^ verifier.hash.charCodeAt(i);
  return diff === 0;
}
function validPin(pin) { return /^[0-9]{4,8}$/.test(String(pin || '')); }

function pinShowStep(id) {
  ['pinGateLoading','pinUnlockForm','pinCloudStep','pinSetupForm'].forEach(stepId => {
    const el = $(stepId);
    if (el) el.classList.toggle('hidden', stepId !== id);
  });
}
function pinSetError(id, message='') {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}
function unlockRoster() {
  state.pinUnlocked = true;
  document.body.classList.remove('app-locked');
  $('pinGate')?.classList.add('hidden');
  setTimeout(() => $('pinUnlockInput')?.blur(), 0);
}
function showPinUnlock(verifier=getLocalPinVerifier()) {
  if (!verifier) {
    showPinCloudBootstrap();
    return;
  }
  pinShowStep('pinUnlockForm');
  pinSetError('pinUnlockError', '');
  const input = $('pinUnlockInput');
  input.value = '';
  setTimeout(() => input.focus(), 40);
}
function showPinCloudBootstrap(message='') {
  pinShowStep('pinCloudStep');
  pinSetError('pinCloudError', message);
  const hasClient = !!getBootstrapClientId();
  $('pinClientIdLabel')?.classList.toggle('hidden', hasClient);
  if (!hasClient) $('pinClientIdInput').value = '';
}
function showPinSetup() {
  pinShowStep('pinSetupForm');
  pinSetError('pinSetupError', '');
  $('pinSetupInput').value = '';
  $('pinSetupConfirm').value = '';
  setTimeout(() => $('pinSetupInput').focus(), 40);
}

function initPinGate() {
  document.body.classList.add('app-locked');
  const localVerifier = getLocalPinVerifier();
  if (localVerifier) showPinUnlock(localVerifier);
  else showPinCloudBootstrap();
}

async function loadPinConfigFromDrive() {
  const button = $('pinLoadCloudBtn');
  const inputClient = $('pinClientIdInput')?.value.trim();

  if (!getBootstrapClientId()) {
    if (!inputClient) {
      pinSetError('pinCloudError', '請先輸入 Google OAuth Client ID。');
      return;
    }
    localStorage.setItem('roster_google_client_id', inputClient);
    state.tokenClient = null;
    state.googleToken = null;
  }

  button.disabled = true;
  button.textContent = '載入中…';
  pinSetError('pinCloudError', '');

  withGoogleAccess(async () => {
    try {
      const result = await tryLoadAppDataConfig({force:true});
      if (!result.ok) {
        pinSetError('pinCloudError', result.info?.message || '無法讀取 Drive App Data。');
        return;
      }
      state.pinCloudReady = true;
      const verifier = state.cloudConfig?.security?.pin;
      if (verifier?.salt && verifier?.hash) {
        cachePinVerifier(verifier);
        showPinUnlock(verifier);
      } else {
        showPinSetup();
      }
    } finally {
      button.disabled = false;
      button.textContent = '連線 Google 並載入';
    }
  }, {forceConsent:false});
}

async function saveFirstPin(pin) {
  if (!state.googleToken) throw new Error('尚未取得 Google 授權，請重新載入安全設定。');
  const verifier = await createPinVerifier(pin);
  const next = mergeCloudConfig(state.cloudConfig || localMigrationConfig());
  next.security = { ...(next.security || {}), pin: verifier };
  await saveAppDataConfig(next);
  cachePinVerifier(verifier);
  state.pinCloudReady = true;
  return verifier;
}

function wirePinGate() {
  $('pinLoadCloudBtn')?.addEventListener('click', loadPinConfigFromDrive);

  $('pinUnlockForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('pinUnlockInput');
    const pin = input.value.trim();
    const verifier = getLocalPinVerifier();
    if (!validPin(pin)) {
      pinSetError('pinUnlockError', '請輸入 4–8 位數字 PIN。');
      return;
    }
    const button = event.submitter || $('pinUnlockForm').querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = '驗證中…';
    try {
      const ok = await verifyPin(pin, verifier);
      if (!ok) {
        pinSetError('pinUnlockError', 'PIN 不正確。');
        input.select();
        return;
      }
      pinSetError('pinUnlockError', '');
      unlockRoster();
    } catch (err) {
      pinSetError('pinUnlockError', `PIN 驗證失敗：${err.message}`);
    } finally {
      button.disabled = false;
      button.textContent = '解鎖';
    }
  });

  $('pinSetupForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const pin = $('pinSetupInput').value.trim();
    const confirmPin = $('pinSetupConfirm').value.trim();
    if (!validPin(pin)) {
      pinSetError('pinSetupError', 'PIN 必須是 4–8 位數字。');
      return;
    }
    if (pin !== confirmPin) {
      pinSetError('pinSetupError', '兩次輸入的 PIN 不一致。');
      return;
    }
    const button = event.submitter || $('pinSetupForm').querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = '儲存中…';
    try {
      await saveFirstPin(pin);
      pinSetError('pinSetupError', '');
      unlockRoster();
      showToast('PIN 已安全儲存至 Drive App Data');
    } catch (err) {
      pinSetError('pinSetupError', `PIN 儲存失敗：${err.message}`);
    } finally {
      button.disabled = false;
      button.textContent = '儲存 PIN 並進入';
    }
  });
}

function projectNumberFromClientId() {
  const m = String(getBootstrapClientId() || '').match(/^(\d+)-/);
  return m ? m[1] : '';
}
function driveEnableUrl() {
  const p = projectNumberFromClientId();
  return p
    ? `https://console.cloud.google.com/apis/library/drive.googleapis.com?project=${encodeURIComponent(p)}`
    : 'https://console.cloud.google.com/apis/library/drive.googleapis.com';
}
function classifyDriveError(err) {
  const text = String(err?.message || err || '');
  if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED|API has not been used/i.test(text)) {
    return { kind:'disabled', label:'API 未啟用', message:'Google Drive API 尚未啟用。Calendar 排班仍可使用；App Data 設定先保存在本機。' };
  }
  if (/insufficient authentication scopes|insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(text)) {
    return { kind:'auth', label:'需要授權', message:'目前 Google 權杖沒有 Drive App Data 權限，請按「重新授權」。' };
  }
  if (err?.status === 401 || /invalid credentials|login required|unauth/i.test(text)) {
    return { kind:'auth', label:'需要授權', message:'Google 授權已失效，請重新連線或按「重新授權」。' };
  }
  return { kind:'error', label:'讀取失敗', message:`Drive App Data 讀取失敗：${text || '未知錯誤'}。Calendar 排班仍可繼續使用。` };
}
function setAppDataStatus(kind, message='') {
  state.driveStatus = kind;
  state.driveLastError = message || '';
  const badge = $('appDataBadge');
  const text = $('appDataStatus');
  const link = $('enableDriveApiLink');
  if (!badge || !text || !link) return;
  const map = {
    idle:['尚未檢查','neutral'],
    loading:['讀取中','neutral'],
    ready:['已同步','success'],
    cached:['本機快取','warning'],
    auth:['需要授權','warning'],
    disabled:['API 未啟用','danger'],
    error:['讀取失敗','danger']
  };
  const [label, cls] = map[kind] || map.idle;
  badge.textContent = label;
  badge.className = `status-badge ${cls}`;
  text.textContent = message || {
    idle:'尚未檢查雲端設定。Google Calendar 可獨立使用；App Data 若暫時不可用，設定會先保存在本機。',
    loading:'正在讀取 Google Drive App Data…',
    ready:'Drive App Data 已載入，跨裝置設定同步正常。',
    cached:'目前使用本機快取。Calendar 排班可正常使用，雲端設定待稍後補同步。',
    auth:'需要重新取得 Drive App Data 授權。',
    disabled:'Google Drive API 尚未啟用。Calendar 排班仍可使用；App Data 設定先保存在本機。',
    error:'Drive App Data 暫時無法讀取。Calendar 排班仍可繼續使用。'
  }[kind];
  link.href = driveEnableUrl();
  link.classList.toggle('hidden', kind !== 'disabled');
}
function saveCloudConfigLocalOnly(config) {
  const next = mergeCloudConfig({...config, updatedAt: new Date().toISOString()});
  applyCloudConfig(next);
  setAppDataStatus('cached', '設定已先保存在本機；Drive App Data 尚未同步。Calendar 排班不受影響。');
  return next;
}
async function tryLoadAppDataConfig({force=false}={}) {
  setAppDataStatus('loading');
  try {
    const cfg = await loadAppDataConfig({force});
    setAppDataStatus('ready', 'Drive App Data 已載入，跨裝置設定同步正常。');
    return { ok:true, config:cfg };
  } catch (err) {
    const info = classifyDriveError(err);
    setAppDataStatus(info.kind, info.message);
    return { ok:false, error:err, info };
  }
}
async function trySaveAppDataConfig(config=state.cloudConfig) {
  setAppDataStatus('loading', '正在同步設定到 Drive App Data…');
  try {
    const cfg = await saveAppDataConfig(config);
    setAppDataStatus('ready', '設定已同步至 Drive App Data。');
    return { ok:true, config:cfg };
  } catch (err) {
    const info = classifyDriveError(err);
    saveCloudConfigLocalOnly(config);
    setAppDataStatus(info.kind, info.message);
    return { ok:false, error:err, info };
  }
}

async function googleRequest(url,options={}) {
  if(!state.googleToken) throw new Error('尚未取得 Google 授權');
  const headers={Authorization:`Bearer ${state.googleToken}`,...(options.headers||{})};
  if(options.body && !headers['Content-Type']) headers['Content-Type']='application/json';
  const res=await fetch(url,{...options,headers});
  if(!res.ok) {
    let detail=''; try { const j=await res.json(); detail=j.error?.message||j.error_description||''; } catch {}
    if(res.status===401) state.googleToken=null;
    const err = new Error(detail||`Google API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if(res.status===204) return null;
  const ct=res.headers.get('content-type')||'';
  return ct.includes('application/json') ? res.json() : res.text();
}
function calendarRequest(path,options={}) { return googleRequest(`https://www.googleapis.com/calendar/v3${path}`,options); }
function driveRequest(path,options={}) { return googleRequest(`https://www.googleapis.com${path}`,options); }

async function findAppDataFile() {
  const qs=new URLSearchParams({spaces:'appDataFolder',q:`name='${APPDATA_FILENAME}' and trashed=false`,fields:'files(id,name,modifiedTime)',pageSize:'10'});
  const data=await driveRequest(`/drive/v3/files?${qs}`);
  const file=(data.files||[])[0]||null; state.appDataFileId=file?.id||null; return file;
}
async function readAppDataFile(id) {
  const raw=await driveRequest(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
  if(typeof raw==='object') return raw;
  try { return JSON.parse(raw); } catch { throw new Error('Drive App Data 設定檔格式錯誤'); }
}
async function createAppDataFile(config) {
  const boundary=`roster_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata={name:APPDATA_FILENAME,parents:['appDataFolder'],mimeType:'application/json'};
  const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(config)}\r\n--${boundary}--`;
  const data=await driveRequest('/upload/drive/v3/files?uploadType=multipart&fields=id,name',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
  state.appDataFileId=data.id; return data;
}
async function updateAppDataFile(id,config) {
  return driveRequest(`/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=id,name`,{method:'PATCH',headers:{'Content-Type':'application/json; charset=UTF-8'},body:JSON.stringify(config)});
}
async function saveAppDataConfig(config=state.cloudConfig) {
  const next=mergeCloudConfig({...config,updatedAt:new Date().toISOString()});
  if(!state.appDataFileId) await findAppDataFile();
  if(state.appDataFileId) await updateAppDataFile(state.appDataFileId,next); else await createAppDataFile(next);
  applyCloudConfig(next); state.cloudLoaded=true;
  setAppDataStatus('ready', `已同步至 Drive App Data · ${new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}`);
  return next;
}
async function loadAppDataConfig({force=false}={}) {
  if(state.cloudLoaded&&!force) return state.cloudConfig;
  const legacy=localMigrationConfig();
  const file=await findAppDataFile();
  if(file) {
    const remote=mergeCloudConfig(await readAppDataFile(file.id));
    // 僅補齊舊版沒有的空欄位，不覆寫既有雲端資料
    if(!remote.googleClientId) remote.googleClientId=legacy.googleClientId;
    if(!remote.calendarId) remote.calendarId=legacy.calendarId;
    if(!remote.appleIcsUrl) remote.appleIcsUrl=legacy.appleIcsUrl;
    remote.typeColors={...DEFAULT_TYPE_COLORS,...remote.typeColors};
    remote.incomeSettings={...legacy.incomeSettings,...remote.incomeSettings};
    applyCloudConfig(remote); state.cloudLoaded=true;
    setAppDataStatus('ready', `已載入 Drive App Data${file.modifiedTime?` · ${new Date(file.modifiedTime).toLocaleString('zh-TW')}`:''}`);
    return remote;
  }
  const migrated=mergeCloudConfig(legacy);
  await saveAppDataConfig(migrated);
  cleanupLegacyStorage();
  setAppDataStatus('ready', '已建立 Drive App Data，並搬移舊版設定');
  return state.cloudConfig;
}
function cleanupLegacyStorage() {
  localStorage.removeItem('roster_google_calendar_id');
  localStorage.removeItem('roster_apple_ics_url');
  localStorage.removeItem('roster_type_colors');
  const keys=[]; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(k&&/^roster_income_\d{4}-\d{2}$/.test(k)) keys.push(k);} keys.forEach(k=>localStorage.removeItem(k));
}

async function fetchAllEvents({refreshCloud=true}={}) {
  if (refreshCloud) await tryLoadAppDataConfig({force:true});
  const calendarId=getCalendarId(); if(!calendarId) throw new Error('Drive App Data 中尚未設定排班 Calendar ID');
  let pageToken='', all=[];
  do {
    const qs=new URLSearchParams({singleEvents:'true',orderBy:'startTime',maxResults:'2500',timeZone:TZ,timeMin:`${new Date().getFullYear()-1}-01-01T00:00:00+08:00`,timeMax:`${new Date().getFullYear()+2}-12-31T23:59:59+08:00`});
    if(pageToken) qs.set('pageToken',pageToken);
    const data=await calendarRequest(`/calendars/${encodeURIComponent(calendarId)}/events?${qs}`); all.push(...(data.items||[])); pageToken=data.nextPageToken||'';
  } while(pageToken);
  state.shifts=all.map(googleEventToShift).filter(Boolean).sort((a,b)=>`${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));
  saveShiftCache(); renderAll();
  $('syncStatus').textContent=`已連線 · ${state.shifts.length} 筆排班 · App Data 已同步 · ${new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}`;
}

function initGoogleTokenClient() {
  const clientId=getBootstrapClientId();
  if(!clientId) throw new Error('新裝置第一次使用，請先在同步設定輸入 Google OAuth Client ID');
  if(!window.google?.accounts?.oauth2) throw new Error('Google 登入元件尚未載入，請稍後再試');
  if(state.tokenClient) return;
  state.tokenClient=google.accounts.oauth2.initTokenClient({
    client_id:clientId, scope:OAUTH_SCOPES,
    callback:async(resp)=>{
      if(resp.error){showToast(`Google 授權失敗：${resp.error}`); state.pendingGoogleAction=null; return;}
      state.googleToken=resp.access_token; const action=state.pendingGoogleAction; state.pendingGoogleAction=null;
      if(action){try{await action();}catch(err){showToast(err.message);}}
    }
  });
}
function withGoogleAccess(action,{forceConsent=false}={}) {
  if(!getBootstrapClientId()){openSettings(); showToast('新裝置第一次使用請先輸入 Google OAuth Client ID'); return;}
  if(state.googleToken){Promise.resolve(action()).catch(err=>{showToast(err.message);}); return;}
  try { initGoogleTokenClient(); state.pendingGoogleAction=action; state.tokenClient.requestAccessToken({prompt:forceConsent?'consent':''}); }
  catch(err){showToast(err.message);}
}

$('shiftForm').addEventListener('submit',(e)=>{
  e.preventDefault(); const id=$('shiftId').value;
  const payload={title:$('titleInput').value.trim(),location:$('locationInput').value.trim(),date:$('dateInput').value,type:$('typeInput').value,start:$('startInput').value,end:$('endInput').value,fee:toNum($('feeInput').value),ppf:toNum($('shiftPpfInput').value),customType:$('typeInput').value==='other'?$('customTypeInput').value.trim():'',note:$('noteInput').value.trim()};
  withGoogleAccess(async()=>{
    await tryLoadAppDataConfig(); const cal=getCalendarId(); if(!cal) throw new Error('請先在同步設定輸入排班 Calendar ID');
    const path=`/calendars/${encodeURIComponent(cal)}/events${id?`/${encodeURIComponent(id)}`:''}`;
    await calendarRequest(path,{method:id?'PATCH':'POST',body:JSON.stringify(googleEventPayload(payload))});
    closeModal('shiftModal'); await fetchAllEvents(); showToast(id?'班表已更新':'班表已新增');
  });
});
$('deleteShiftBtn').onclick=()=>{
  const id=$('shiftId').value; if(!id||!confirm('確定刪除這個班別？Google Calendar 中的事件也會一起刪除。')) return;
  withGoogleAccess(async()=>{await tryLoadAppDataConfig(); const cal=getCalendarId(); if(!cal) throw new Error('請先在同步設定輸入排班 Calendar ID'); await calendarRequest(`/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(id)}`,{method:'DELETE'}); closeModal('shiftModal'); await fetchAllEvents(); showToast('班表已刪除');});
};
$('bulkForm').addEventListener('submit',(e)=>{
  e.preventDefault(); const dates=bulkDates(); if(!dates.length){showToast('請選擇星期與有效的日期範圍');return;} if(dates.length>200){showToast('一次最多建立 200 班，請縮短日期範圍');return;}
  const base={title:$('bulkTitleInput').value.trim(),location:$('bulkLocationInput').value.trim(),type:$('bulkTypeInput').value,start:$('bulkStartInput').value,end:$('bulkEndInput').value,fee:toNum($('bulkFeeInput').value),ppf:toNum($('bulkPpfInput').value),customType:$('bulkTypeInput').value==='other'?$('bulkCustomTypeInput').value.trim():'',note:$('bulkNoteInput').value.trim()};
  withGoogleAccess(async()=>{
    await tryLoadAppDataConfig(); const cal=getCalendarId(); if(!cal) throw new Error('請先在同步設定輸入排班 Calendar ID'); $('bulkSubmitBtn').disabled=true;
    try { for(let i=0;i<dates.length;i++){ $('bulkSubmitBtn').textContent=`建立中 ${i+1}/${dates.length}`; await calendarRequest(`/calendars/${encodeURIComponent(cal)}/events`,{method:'POST',body:JSON.stringify(googleEventPayload({...base,date:dates[i]}))}); } closeModal('bulkModal'); await fetchAllEvents(); showToast(`已建立 ${dates.length} 班固定排班`); }
    finally { $('bulkSubmitBtn').disabled=false; $('bulkSubmitBtn').textContent='建立固定排班'; }
  });
});
$('incomeForm').addEventListener('submit',(e)=>{
  e.preventDefault();
  const key=monthKey();
  const data={license:toNum($('licenseFeeInput').value),support:toNum($('supportIncomeInput').value),insurance:toNum($('insuranceCostInput').value)};
  const localNext=mergeCloudConfig(state.cloudConfig||localMigrationConfig());
  localNext.incomeSettings={...(localNext.incomeSettings||{}),[key]:data};
  saveCloudConfigLocalOnly(localNext);
  closeModal('incomeModal'); renderIncome();
  showToast(`${key} 收入設定已儲存`);
  withGoogleAccess(async()=>{
    const loaded=await tryLoadAppDataConfig({force:true});
    const base=loaded.ok ? state.cloudConfig : localNext;
    base.incomeSettings={...(base.incomeSettings||{}),[key]:data};
    const saved=await trySaveAppDataConfig(base);
    if(saved.ok) showToast(`${key} 收入設定已同步到 Drive App Data`);
  });
});

function animateMonthChange(direction, updateCursor) {
  const grid = $('calendarGrid');
  const income = document.querySelector('.income-card');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !grid?.animate) {
    updateCursor(); renderCalendar(); renderIncome(); wireDynamic(); return;
  }
  const sign = direction === 'next' ? -1 : 1;
  const outgoing = [grid, income].filter(Boolean).map((el, index) => el.animate([
    {opacity:1, transform:'translateX(0)'},
    {opacity:0, transform:`translateX(${sign * 18}px)`}
  ], {duration:120, easing:'ease-in', fill:'forwards', delay:index*10}));
  Promise.all(outgoing.map(a => a.finished.catch(()=>{}))).then(() => {
    updateCursor();
    renderCalendar(); renderIncome(); wireDynamic();
    [grid, income].filter(Boolean).forEach((el,index) => {
      el.getAnimations().forEach(a=>a.cancel());
      el.animate([
        {opacity:0, transform:`translateX(${-sign * 18}px)`},
        {opacity:1, transform:'translateX(0)'}
      ], {duration:190, easing:'cubic-bezier(.2,.8,.2,1)', fill:'both', delay:index*12});
    });
  });
}

$('prevMonth').onclick=()=>animateMonthChange('prev',()=>{state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth()-1,1);});
$('nextMonth').onclick=()=>animateMonthChange('next',()=>{state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth()+1,1);});
$('todayBtn').onclick=()=>animateMonthChange(state.cursor > new Date() ? 'prev' : 'next',()=>{state.cursor=new Date();});
$('addShiftBtn').onclick=()=>openShiftModal(); $('bulkShiftBtn').onclick=openBulkModal; $('incomeSettingsBtn').onclick=openIncomeModal;
$('refreshBtn').onclick=()=>withGoogleAccess(async()=>{await tryLoadAppDataConfig({force:true});await fetchAllEvents({refreshCloud:false});});
$('googleSyncBtn').onclick=()=>withGoogleAccess(async()=>{
  $('syncStatus').textContent='正在同步 Google Calendar…';
  const cloud=await tryLoadAppDataConfig({force:true});
  try {
    await fetchAllEvents({refreshCloud:false});
    $('syncStatus').textContent=`Google Calendar 已同步 · ${state.shifts.length} 筆排班${cloud.ok?' · App Data 已同步':' · App Data 使用本機快取'}`;
    showToast(cloud.ok?'Google Calendar 與 App Data 已更新':'Google Calendar 已更新；App Data 待修復後補同步');
  } catch(err) {
    $('syncStatus').textContent=`Calendar 同步失敗：${err.message}`;
    throw err;
  }
});

document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>closeModal(el.dataset.close));
document.querySelectorAll('.modal-backdrop').forEach(el=>el.addEventListener('click',e=>{if(e.target===el)closeModal(el.id);}));
document.querySelectorAll('input[name="bulkWeekday"]').forEach(el=>el.addEventListener('change',updateBulkPreview));
['bulkRangePreset','bulkFromInput','bulkToInput'].forEach(id=>$(id).addEventListener('change',updateBulkPreview));
['licenseFeeInput','supportIncomeInput','insuranceCostInput'].forEach(id=>$(id).addEventListener('input',updateIncomeEquation));
$('typeInput').addEventListener('change',()=>syncTypeUi('')); $('bulkTypeInput').addEventListener('change',()=>syncTypeUi('bulk'));

function openSettings() {
  const c=state.cloudConfig||localMigrationConfig();
  $('googleClientId').value=getBootstrapClientId()||c.googleClientId||'';
  $('googleCalendarId').value=c.calendarId||'';
  $('appleIcsUrl').value=c.appleIcsUrl||'';
  document.querySelectorAll('[data-type-color]').forEach(el=>el.value=(c.typeColors||DEFAULT_TYPE_COLORS)[el.dataset.typeColor]||DEFAULT_TYPE_COLORS[el.dataset.typeColor]);
  if(state.cloudLoaded) setAppDataStatus('ready','Drive App Data 已載入；儲存會同步到雲端。');
  else if(state.driveStatus==='idle') setAppDataStatus('cached','尚未載入雲端設定，目前使用本機快取；Calendar 排班仍可正常操作。');
  openModal('settingsModal');
}

function handleBatchDeleteAction() {
  if (!state.batchDeleteMode) {
    setBatchDeleteMode(true);
    showToast('批次刪除模式：點選月曆事件即可勾選');
    return;
  }

  if (state.selectedShiftIds.size === 0) {
    setBatchDeleteMode(false);
    showToast('已取消批次刪除');
    return;
  }

  deleteSelectedShifts();
}

// 使用事件委派，避免 GitHub Pages 更新後 DOM / 快取造成新按鈕沒有 handler。
const floatingActions = document.querySelector('.floating-actions');
if (floatingActions) {
  floatingActions.addEventListener('click', (event) => {
    const button = event.target.closest('#batchDeleteBtn');
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    handleBatchDeleteAction();
  });
}

$('settingsBtn').onclick=openSettings;
$('saveSettingsBtn').onclick=()=>{
  const clientId=$('googleClientId').value.trim();
  if(!clientId){showToast('請輸入 Google OAuth Client ID');return;}
  const oldClient=getBootstrapClientId();
  localStorage.setItem('roster_google_client_id',clientId);
  if(oldClient&&oldClient!==clientId){
    state.tokenClient=null; state.googleToken=null; state.cloudLoaded=false; state.appDataFileId=null;
  }
  const draft={
    googleClientId:clientId,
    calendarId:$('googleCalendarId').value.trim(),
    appleIcsUrl:$('appleIcsUrl').value.trim(),
    typeColors:{}
  };
  document.querySelectorAll('[data-type-color]').forEach(el=>draft.typeColors[el.dataset.typeColor]=el.value);
  const localNext=mergeCloudConfig({...state.cloudConfig,...draft,typeColors:{...(state.cloudConfig?.typeColors||{}),...draft.typeColors}});
  saveCloudConfigLocalOnly(localNext);
  cleanupLegacyStorage();
  closeModal('settingsModal');
  loadShiftCache(); renderAll();
  showToast('設定已儲存；正在嘗試同步 Drive App Data');

  withGoogleAccess(async()=>{
    const loaded=await tryLoadAppDataConfig({force:true});
    const remoteBase=loaded.ok ? state.cloudConfig : localNext;
    const next=mergeCloudConfig({
      ...remoteBase,
      ...draft,
      incomeSettings:{...(remoteBase.incomeSettings||{}),...(localNext.incomeSettings||{})},
      typeColors:{...(remoteBase.typeColors||{}),...draft.typeColors}
    });
    const saved=await trySaveAppDataConfig(next);
    if(saved.ok) showToast('同步設定已儲存到 Drive App Data');
  },{forceConsent:oldClient!==clientId});
};
$('retryAppDataBtn').onclick=()=>withGoogleAccess(async()=>{
  const result=await tryLoadAppDataConfig({force:true});
  if(result.ok){ renderAll(); showToast('Drive App Data 已載入'); }
  else showToast(result.info?.message || 'App Data 讀取失敗');
});
$('reauthDriveBtn').onclick=()=>withGoogleAccess(async()=>{
  const result=await tryLoadAppDataConfig({force:true});
  if(result.ok){ renderAll(); showToast('Drive App Data 授權完成'); }
},{forceConsent:true});

$('appleSubscribeBtn').onclick=()=>{
  const url=getAppleIcsUrl();
  if(!url){showToast('請先連線 Google，載入 Drive App Data 中的 Apple iCal URL');return;}
  const webcal=url.replace(/^https?:\/\//i,'webcal://'); window.location.href=webcal;
};

// Startup: use non-secret local cache for layout/income until Google App Data is loaded.
state.cloudConfig=mergeCloudConfig(localMigrationConfig());
state.typeColors={...state.cloudConfig.typeColors};
loadShiftCache(); renderAll();
setAppDataStatus('cached','尚未載入 Drive App Data，目前使用本機快取；Calendar 排班可獨立操作。');
if(getBootstrapClientId()) $('syncStatus').textContent=`顯示本機快取 · ${state.shifts.length} 筆；按「連線 Google Calendar」取得最新 App Data 與排班`;
wirePinGate();
initPinGate();
