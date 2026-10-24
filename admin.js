/**
 * استبيان العتبة الحسينية المقدسة - قسم الشؤون الدينية
 * لوحة تحكم المشرف العام (الحساب الرئيسي) - Admin JS
 */

// ================= STORAGE KEYS =================
const STORAGE_KEYS = {
  RESPONSES: 'shrine_survey_responses_v1',
  USERS: 'shrine_survey_users_v1',
  CURRENT_USER: 'shrine_survey_current_user_v1',
  ADMIN_SESSION: 'shrine_survey_admin_auth_v1',
  ADMIN_USER_PROFILE: 'shrine_survey_admin_user_profile_v1',
  SUPERVISORS_CACHE: 'shrine_survey_supervisors_cache_v1'
};

const DEFAULT_ADMIN = {
  username: 'admin',
  password: 'admin123',
  fullName: 'المشرف العام - قسم الشؤون الدينية',
  role: 'ADMIN',
  province: 'كربلاء المقدسة'
};

// ================= STATE =================
let responsesData = [];
let supervisorsList = [];
let chartSatisfaction = null;
let chartAxes = null;
let chartProvinces = null;
let lastKnownStorageValue = null;

// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', () => {
  loadResponses();
  checkAdminAuth();
  initAutoSync();
});

// ================= API URL HELPER =================
function getApiUrl(action, params = {}) {
  const url = new URL('api.php', window.location.href);
  if (action) url.searchParams.set('action', action);
  url.searchParams.set('_t', Date.now().toString());
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.href;
}

// ================= REAL-TIME AUTO SYNC =================
function initAutoSync() {
  // 1. Listen for storage changes from other tabs on same device
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEYS.RESPONSES) {
      const saved = localStorage.getItem(STORAGE_KEYS.RESPONSES);
      if (saved) {
        try {
          responsesData = JSON.parse(saved);
          renderAdminDashboard();
        } catch (err) {}
      }
    }
  });

  // 2. Active Server Background Polling every 3.5 seconds
  // Guarantees real-time sync with visitor submissions from phones and external devices!
  setInterval(async () => {
    if (localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION) !== 'true') return;

    try {
      const res = await fetch(getApiUrl('get'), { cache: 'no-store' });
      if (res.ok) {
        const fresh = await res.json();
        if (Array.isArray(fresh)) {
          const freshStr = JSON.stringify(fresh);
          const currentStr = JSON.stringify(responsesData);
          
          if (freshStr !== currentStr) {
            const isNewResponse = fresh.length > responsesData.length;
            responsesData = fresh;
            saveResponses();
            updateServerStatusBadge(true, responsesData.length);
            renderAdminDashboard();

            if (isNewResponse) {
              const newest = fresh[0];
              const name = newest ? escapeHtml(newest.participantName) : 'زائر كريم';
              showToast(`🔔 استلام استبيان جديد من: (${name}) وتحديث اللوحة تلقائياً!`, 'success');
            }
          } else {
            updateServerStatusBadge(true, responsesData.length);
          }
        }
      } else {
        updateServerStatusBadge(false, responsesData.length);
      }
    } catch (err) {
      updateServerStatusBadge(false, responsesData.length);
    }
  }, 3500);
}

async function syncDataNow() {
  const icon = document.getElementById('syncIcon');
  if (icon) icon.classList.add('fa-spin');
  const data = await loadResponses();
  if (icon) icon.classList.remove('fa-spin');
  showToast(`تمت مزامنة البيانات مع السيرفر بنجاح! (${responsesData.length} مشاركة مسجلة)`, 'success');
}

// ================= AUTHENTICATION =================
function checkAdminAuth() {
  const isAuth = localStorage.getItem(STORAGE_KEYS.ADMIN_SESSION) === 'true';
  const loginView = document.getElementById('adminLoginView');
  const dashboardView = document.getElementById('adminDashboardView');
  const statusText = document.getElementById('adminStatusText');
  const btnLogout = document.getElementById('btnAdminLogout');
  const btnSettings = document.getElementById('btnNavAdminSettings');

  let profile = DEFAULT_ADMIN;
  try {
    const savedProf = localStorage.getItem(STORAGE_KEYS.ADMIN_USER_PROFILE);
    if (savedProf) profile = JSON.parse(savedProf);
  } catch (err) {}

  if (isAuth) {
    if (loginView) loginView.style.display = 'none';
    if (dashboardView) dashboardView.style.display = 'block';

    const roleName = profile.role === 'ADMIN' ? 'مشرف عام' : 'مشرف متابعة';
    if (statusText) {
      statusText.innerHTML = `<strong>المشرف:</strong> ${escapeHtml(profile.fullName || profile.username)} <span style="font-size:0.75rem; background:rgba(10,77,52,0.18); color:#0a4d34; font-weight:800; padding:0.12rem 0.5rem; border-radius:4px; margin-right:4px;">${roleName}</span>`;
    }
    if (btnLogout) btnLogout.style.display = 'inline-flex';
    if (btnSettings) btnSettings.style.display = 'inline-flex';

    // Update active user in change password display
    const myUserDisp = document.getElementById('myCurrentUsernameDisplay');
    if (myUserDisp) myUserDisp.textContent = profile.username || 'admin';

    renderAdminDashboard();
    loadSupervisorsList();
  } else {
    if (loginView) loginView.style.display = 'block';
    if (dashboardView) dashboardView.style.display = 'none';
    if (statusText) statusText.innerHTML = `المشرف: بانتظار تسجيل الدخول`;
    if (btnLogout) btnLogout.style.display = 'none';
    if (btnSettings) btnSettings.style.display = 'none';
  }
}

function normalizeInputString(str) {
  if (!str) return '';
  const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  let res = str.toString().trim();
  for (let i = 0; i < 10; i++) {
    res = res.split(arabicDigits[i]).join(i.toString());
  }
  return res;
}

async function handleAdminLoginSubmit(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('adminUsernameInput');
  const passwordInput = document.getElementById('adminPasswordInput');
  const rawUser = usernameInput ? usernameInput.value.trim() : '';
  const rawPass = passwordInput ? passwordInput.value.trim() : '';

  if (!rawUser || !rawPass) {
    showToast('يرجى إدخال اسم المستخدم وكلمة المرور.', 'error');
    return;
  }

  const normUser = normalizeInputString(rawUser).toLowerCase();
  const normPass = normalizeInputString(rawPass);

  const isMatchUser = (u) => {
    const cleanU = normalizeInputString(u).toLowerCase();
    return cleanU === normUser || (['admin', 'مشرف', 'مدير', 'المشرف'].includes(normUser) && cleanU === 'admin');
  };

  const isMatchPass = (p, admUser) => {
    const cleanP = normalizeInputString(p);
    if (cleanP === normPass || p === rawPass) return true;
    if (admUser && admUser.toLowerCase() === 'admin') {
      return ['admin123', 'admin'].includes(normPass) || ['admin123', 'admin'].includes(normPass.toLowerCase());
    }
    return false;
  };

  // Direct login for default admin credentials or file protocol
  if (isMatchUser(DEFAULT_ADMIN.username) && isMatchPass(DEFAULT_ADMIN.password, 'admin')) {
    localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION, 'true');
    localStorage.setItem(STORAGE_KEYS.ADMIN_USER_PROFILE, JSON.stringify(DEFAULT_ADMIN));
    checkAdminAuth();
    showToast(`مرحباً بكم يا ${DEFAULT_ADMIN.fullName}، تم تسجيل الدخول بنجاح!`, 'success');
    return;
  }

  // Quick fallback if opened directly from local filesystem (file:// protocol)
  if (window.location.protocol === 'file:') {
    let cachedAdmins = [DEFAULT_ADMIN];
    try {
      const c = localStorage.getItem(STORAGE_KEYS.SUPERVISORS_CACHE);
      if (c) cachedAdmins = JSON.parse(c);
    } catch (err) {}

    const matched = cachedAdmins.find(a => isMatchUser(a.username) && isMatchPass(a.password, a.username));
    if (matched) {
      localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION, 'true');
      localStorage.setItem(STORAGE_KEYS.ADMIN_USER_PROFILE, JSON.stringify(matched));
      checkAdminAuth();
      showToast(`مرحباً بكم يا ${matched.fullName || rawUser} (تم تسجيل الدخول في الوضع المحلي)`, 'success');
      return;
    }

    showToast('بيانات الدخول غير صحيحة. يرجى التأكد من اسم المستخدم وكلمة المرور.', 'error');
    return;
  }

  // Show loading on submit button
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحقق من بيانات المشرف...';
  }

  try {
    const res = await fetch(getApiUrl('admin_login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: normUser, password: normPass })
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data && data.status === 'success') {
      localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION, 'true');
      if (data.user) {
        localStorage.setItem(STORAGE_KEYS.ADMIN_USER_PROFILE, JSON.stringify(data.user));
      }
      checkAdminAuth();
      showToast(`مرحباً بكم يا ${data.user?.fullName || rawUser}، تم تسجيل الدخول بنجاح!`, 'success');
      return;
    } else {
      // Check cached supervisors as fallback
      let cachedAdmins = [DEFAULT_ADMIN];
      try {
        const c = localStorage.getItem(STORAGE_KEYS.SUPERVISORS_CACHE);
        if (c) cachedAdmins = JSON.parse(c);
      } catch (err) {}

      const matched = cachedAdmins.find(a => isMatchUser(a.username) && isMatchPass(a.password, a.username));
      if (matched) {
        localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION, 'true');
        localStorage.setItem(STORAGE_KEYS.ADMIN_USER_PROFILE, JSON.stringify(matched));
        checkAdminAuth();
        showToast(`مرحباً بكم يا ${matched.fullName || rawUser}، تم تسجيل الدخول بنجاح!`, 'success');
        return;
      }

      const errMsg = (data && data.message) ? data.message : 'بيانات الدخول غير صحيحة. يرجى التأكد من اسم المستخدم وكلمة المرور.';
      showToast(errMsg, 'error');
    }
  } catch (netErr) {
    // Offline / fallback verification if server cannot be reached
    let cachedAdmins = [DEFAULT_ADMIN];
    try {
      const c = localStorage.getItem(STORAGE_KEYS.SUPERVISORS_CACHE);
      if (c) cachedAdmins = JSON.parse(c);
    } catch (err) {}

    const matched = cachedAdmins.find(a => isMatchUser(a.username) && isMatchPass(a.password, a.username));
    if (matched) {
      localStorage.setItem(STORAGE_KEYS.ADMIN_SESSION, 'true');
      localStorage.setItem(STORAGE_KEYS.ADMIN_USER_PROFILE, JSON.stringify(matched));
      checkAdminAuth();
      showToast(`مرحباً بكم يا ${matched.fullName || rawUser} (تم تسجيل الدخول في الوضع غير المتصل)`, 'success');
      return;
    }

    showToast('بيانات الدخول غير صحيحة. يرجى التأكد من اسم المستخدم وكلمة المرور.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }
}

function handleAdminLogout() {
  if (confirm('هل ترغب بتسجيل الخروج من لوحة الإدارة؟')) {
    localStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION);
    localStorage.removeItem(STORAGE_KEYS.ADMIN_USER_PROFILE);
    checkAdminAuth();
    showToast('تم تسجيل الخروج من لوحة الإدارة بنجاح.', 'info');
  }
}

// ================= LOAD & SAVE DATA =================
function updateServerStatusBadge(connected, count) {
  const badge = document.getElementById('serverStatusBadge');
  const dot = document.getElementById('serverStatusDot');
  const text = document.getElementById('serverStatusText');
  if (!badge || !dot || !text) return;

  if (connected) {
    badge.style.background = '#ecfdf5';
    badge.style.borderColor = '#a7f3d0';
    badge.style.color = '#065f46';
    dot.style.background = '#10b981';
    text.textContent = `متصل بالسيرفر السحابي (${count} مشاركة مسجلة)`;
  } else {
    badge.style.background = '#fffbeb';
    badge.style.borderColor = '#fde68a';
    badge.style.color = '#92400e';
    dot.style.background = '#f59e0b';
    text.textContent = `العمل بنمط الحفظ المحلي (${count} مشاركة)`;
  }
}

async function loadResponses() {
  const isCleared = localStorage.getItem('shrine_survey_cleared') === 'true';
  let serverData = null;
  let serverConnected = false;

  // 1. Try reading from api.php first
  try {
    const res = await fetch(getApiUrl('get'), { cache: 'no-store' });
    if (res.ok) {
      const parsed = await res.json();
      if (Array.isArray(parsed)) {
        serverData = parsed;
        serverConnected = true;
      }
    }
  } catch (e) {
    console.warn('[Cloud Sync] تعذر الاتصال بـ api.php:', e);
  }

  // When server is reachable, it is the single source of truth for all devices
  if (serverConnected && Array.isArray(serverData)) {
    responsesData = serverData;
    localStorage.setItem(STORAGE_KEYS.RESPONSES, JSON.stringify(serverData));
    lastKnownStorageValue = JSON.stringify(serverData);
    updateServerStatusBadge(true, responsesData.length);
    renderAdminDashboard();
    return serverData;
  }

  // 2. Fallback to localStorage ONLY if server is offline/unreachable
  const saved = localStorage.getItem(STORAGE_KEYS.RESPONSES);
  if (saved !== null) {
    try {
      responsesData = JSON.parse(saved);
    } catch (e) {
      responsesData = [];
    }
  } else if (!isCleared) {
    seedSampleData(false);
  } else {
    responsesData = [];
  }

  updateServerStatusBadge(false, responsesData.length);
  lastKnownStorageValue = localStorage.getItem(STORAGE_KEYS.RESPONSES);
  renderAdminDashboard();
  return responsesData;
}

function saveResponses() {
  const json = JSON.stringify(responsesData);
  localStorage.setItem(STORAGE_KEYS.RESPONSES, json);
  lastKnownStorageValue = json;
}

// ================= DASHBOARD & CHARTS =================
function renderAdminDashboard() {
  updateKPIs();
  renderCharts();
  renderResponsesTable();
}

function updateKPIs() {
  const total = responsesData.length;
  document.getElementById('kpiTotalResponses').textContent = total;

  if (total === 0) {
    document.getElementById('kpiSatisfactionRate').textContent = '0%';
    document.getElementById('kpiRegisteredCount').textContent = '0';
    document.getElementById('kpiSuggestionsCount').textContent = '0';
    return;
  }

  const sumOverall = responsesData.reduce((acc, r) => acc + ((r && r.ratings && r.ratings.q_overall_rating) ? r.ratings.q_overall_rating : 0), 0);
  const avgSatisfaction = Math.round((sumOverall / (total * 5)) * 100);
  document.getElementById('kpiSatisfactionRate').textContent = `${avgSatisfaction}%`;

  const regCount = responsesData.filter(r => r.isRegistered).length;
  document.getElementById('kpiRegisteredCount').textContent = `${regCount} (${Math.round((regCount / total) * 100)}%)`;

  const suggCount = responsesData.filter(r => r.suggestions && r.suggestions.length > 2).length;
  document.getElementById('kpiSuggestionsCount').textContent = suggCount;
}

function renderCharts() {
  if (typeof Chart === 'undefined') return;
  const total = responsesData.length;

  // 1. Satisfaction Doughnut Chart
  const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  responsesData.forEach(r => {
    const val = (r && r.ratings && r.ratings.q_overall_rating) ? r.ratings.q_overall_rating : 5;
    if (counts[val] !== undefined) counts[val]++;
  });

  const pieCtx = document.getElementById('satisfactionPieChart');
  if (pieCtx) {
    if (chartSatisfaction) chartSatisfaction.destroy();
    
    const pieData = total > 0 
      ? [counts[5], counts[4], counts[3], counts[2], counts[1]]
      : [0, 0, 0, 0, 0];

    chartSatisfaction = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: ['راضي تماماً (ممتاز)', 'راضي جداً', 'راضي إلى حد ما', 'غير راضٍ', 'غير راضٍ إطلاقاً'],
        datasets: [{
          data: pieData,
          backgroundColor: ['#0a4d34', '#15803d', '#eab308', '#f97316', '#ef4444'],
          borderColor: '#ffffff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            rtl: true,
            labels: { font: { family: 'Cairo' } }
          }
        }
      }
    });
  }

  // 2. Axes Comparison Bar Chart
  const calcAvg = (keys) => {
    if (total === 0) return 0;
    let sum = 0;
    let count = 0;
    responsesData.forEach(r => {
      keys.forEach(k => {
        if (r.ratings[k]) {
          sum += r.ratings[k];
          count++;
        }
      });
    });
    return count > 0 ? (sum / count).toFixed(1) : 0;
  };

  const avgMinbar = calcAvg(['q_minbar_topics', 'q_minbar_timing', 'q_minbar_scholars']);
  const avgFatwa = calcAvg(['q_fatwa_access', 'q_fatwa_clarity', 'q_fatwa_online']);
  const avgCourses = calcAvg(['q_courses_youth', 'q_pub_quality', 'q_digital_content']);
  const avgOverall = calcAvg(['q_overall_rating']);

  const axesCtx = document.getElementById('axesBarChart');
  if (axesCtx) {
    if (chartAxes) chartAxes.destroy();
    chartAxes = new Chart(axesCtx, {
      type: 'bar',
      data: {
        labels: ['المنبر والمحاضرات', 'الاستفتاءات الشرعية', 'الدورات والإصدارات', 'التقييم العام للقسم'],
        datasets: [{
          label: 'متوسط التقييم (من 5)',
          data: [avgMinbar, avgFatwa, avgCourses, avgOverall],
          backgroundColor: ['#0a4d34', '#c59b27', '#0284c7', '#10b981'],
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: 5,
            ticks: { stepSize: 1, font: { family: 'Cairo' } }
          },
          x: {
            ticks: { font: { family: 'Cairo', weight: '600' } }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }

  // 3. Provinces Distribution Bar Chart
  const provCount = {};
  responsesData.forEach(r => {
    const prov = r.province || 'أخرى';
    provCount[prov] = (provCount[prov] || 0) + 1;
  });

  const hasProvinces = Object.keys(provCount).length > 0;
  const provLabels = hasProvinces ? Object.keys(provCount).slice(0, 8) : ['لا توجد مشاركات'];
  const provValues = hasProvinces ? provLabels.map(l => provCount[l]) : [0];

  const provCtx = document.getElementById('provincesBarChart');
  if (provCtx) {
    if (chartProvinces) chartProvinces.destroy();
    chartProvinces = new Chart(provCtx, {
      type: 'bar',
      data: {
        labels: provLabels,
        datasets: [{
          label: 'عدد المشاركين',
          data: provValues,
          backgroundColor: '#c59b27',
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { stepSize: 1, font: { family: 'Cairo' } } },
          y: { ticks: { font: { family: 'Cairo', weight: '600' } } }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }
}

// ================= RESPONSES TABLE =================
function renderResponsesTable() {
  const tbody = document.getElementById('responsesTableBody');
  if (!tbody) return;

  const searchKeyword = (document.getElementById('tableSearchInput')?.value || '').trim().toLowerCase();
  const typeFilter = document.getElementById('tableTypeFilter')?.value || 'ALL';

  let filtered = responsesData.filter(item => {
    if (typeFilter === 'REGISTERED' && !item.isRegistered) return false;
    if (typeFilter === 'GUEST' && item.isRegistered) return false;

    if (searchKeyword) {
      const matchName = (item.participantName || '').toLowerCase().includes(searchKeyword);
      const matchProv = (item.province || '').toLowerCase().includes(searchKeyword);
      const matchId = (item.id || '').toLowerCase().includes(searchKeyword);
      return matchName || matchProv || matchId;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding: 2.5rem; color:#94a3b8;">
          <i class="fa-solid fa-folder-open" style="font-size:2rem; margin-bottom:0.5rem; display:block;"></i>
          لا توجد مشاركات مسجلة حالياً
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((r) => {
    const overallVal = (r && r.ratings && r.ratings.q_overall_rating) ? r.ratings.q_overall_rating : 5;
    let badgeClass = 'badge-rating-high';
    let ratingLabel = 'ممتاز (5/5)';
    if (overallVal === 4) { badgeClass = 'badge-rating-high'; ratingLabel = 'جيد جداً (4/5)'; }
    else if (overallVal === 3) { badgeClass = 'badge-rating-mid'; ratingLabel = 'جيد (3/5)'; }
    else if (overallVal <= 2) { badgeClass = 'badge-rating-low'; ratingLabel = `مقبول / تطوير (${overallVal}/5)`; }

    const userBadge = r.isRegistered 
      ? '<span class="badge badge-user"><i class="fa-solid fa-check"></i> حساب مسجل</span>'
      : '<span class="badge badge-guest"><i class="fa-solid fa-user"></i> زائر</span>';

    return `
      <tr>
        <td style="font-weight:700; color:#64748b;">${r.id}</td>
        <td>
          <strong>${escapeHtml(r.participantName)}</strong>
          ${r.suggestions ? '<i class="fa-solid fa-comment-dots" style="color:var(--gold); margin-right:4px;" title="يوجد مقترح مكتوب"></i>' : ''}
        </td>
        <td>${userBadge}</td>
        <td>${escapeHtml(r.province)}</td>
        <td><span style="font-size:0.85rem; color:#475569;">${escapeHtml(r.ageGroup || '-')}</span></td>
        <td><span class="badge ${badgeClass}">${ratingLabel}</span></td>
        <td style="font-size:0.8rem; color:#64748b;">${r.displayDate || (r.timestamp ? r.timestamp.slice(0, 10) : '')}</td>
        <td style="white-space:nowrap; min-width:230px; text-align:center;">
          <div class="table-actions-group">
            <button type="button" class="btn-action btn-action-view" onclick="viewResponseDetails('${r.id}')" title="عرض كافة تفاصيل الاستبيان">
              <i class="fa-solid fa-eye"></i> التفاصيل
            </button>
            <button type="button" class="btn-action btn-action-edit" onclick="openEditResponseModal('${r.id}')" title="تعديل بيانات هذا الاستبيان">
              <i class="fa-solid fa-pen-to-square"></i> تعديل
            </button>
            <button type="button" class="btn-action btn-action-delete" onclick="deleteResponse('${r.id}')" title="حذف هذا الاستبيان نهائياً">
              <i class="fa-solid fa-trash-can"></i> حذف
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterResponsesTable() {
  renderResponsesTable();
}

// Single Response Inspection Modal
function viewResponseDetails(id) {
  const item = responsesData.find(r => r.id === id);
  if (!item) return;

  const modal = document.getElementById('responseDetailModal');
  const body = document.getElementById('responseDetailBody');

  const ratingNames = {
    5: 'ممتاز جداً (5)',
    4: 'جيد جداً (4)',
    3: 'جيد (3)',
    2: 'مقبول (2)',
    1: 'بحاجة لتطوير (1)'
  };

  const getRatStr = (val) => ratingNames[val] || `${val}/5`;

  body.innerHTML = `
    <!-- Top Quick Action Bar for Immediate Edit & Delete -->
    <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:0.75rem 1.2rem; margin-bottom:1.2rem; flex-wrap:wrap; gap:0.6rem;">
      <span style="font-size:0.92rem; font-weight:700; color:#334155;">
        <i class="fa-solid fa-bolt" style="color:var(--gold);"></i> إجراءات سريعة على هذا الاستبيان:
      </span>
      <div style="display:flex; gap:0.6rem;">
        <button type="button" class="btn btn-sm btn-gold" onclick="closeResponseDetailModal(); openEditResponseModal('${item.id}');" style="font-weight:700;">
          <i class="fa-solid fa-pen-to-square"></i> تعديل هذا الاستبيان
        </button>
        <button type="button" class="btn btn-sm btn-outline" onclick="closeResponseDetailModal(); deleteResponse('${item.id}');" style="color:#ef4444; border-color:#fca5a5; background:#fff; font-weight:700;">
          <i class="fa-solid fa-trash-can"></i> حذف هذا الاستبيان
        </button>
      </div>
    </div>
    <div class="detail-item-grid">
      <div class="detail-field">
        <label>رقم الاستبيان</label>
        <span>${item.id}</span>
      </div>
      <div class="detail-field">
        <label>اسم المشارك</label>
        <span>${escapeHtml(item.participantName)}</span>
      </div>
      <div class="detail-field">
        <label>نوع الحساب</label>
        <span>${item.userType}</span>
      </div>
      <div class="detail-field">
        <label>المحافظة / الإقامة</label>
        <span>${escapeHtml(item.province)}</span>
      </div>
      <div class="detail-field">
        <label>الفئة العمرية</label>
        <span>${escapeHtml(item.ageGroup || '-')}</span>
      </div>
      <div class="detail-field">
        <label>معدل الزيارة</label>
        <span>${escapeHtml(item.visitFrequency || '-')}</span>
      </div>
      <div class="detail-field">
        <label>تاريخ الإرسال</label>
        <span>${item.displayDate}</span>
      </div>
      <div class="detail-field">
        <label>توصية الأهل والمعارف</label>
        <span>${escapeHtml(item.recommend || '-')}</span>
      </div>
    </div>

    <h4 style="margin: 1.2rem 0 0.8rem; color:var(--primary); font-size:1.05rem;">
      <i class="fa-solid fa-list-check"></i> تفاصيل تقييم الأسئلة:
    </h4>

    <div class="detail-answers-list">
      <div class="detail-answer-row">
        <div class="q-text">1. ملاءمة مواضيع المحاضرات الدينية لمعالجة قضايا المجتمع والشباب:</div>
        <div class="a-val">${getRatStr(item.ratings.q_minbar_topics)}</div>
      </div>
      <div class="detail-answer-row">
        <div class="q-text">2. ملاءمة أوقات وأماكن إقامة المحاضرات في الصحن الشريف:</div>
        <div class="a-val">${getRatStr(item.ratings.q_minbar_timing)}</div>
      </div>
      <div class="detail-answer-row">
        <div class="q-text">3. كفاءة الخطباء والمبلغين وأسلوبهم الإرشادي:</div>
        <div class="a-val">${getRatStr(item.ratings.q_minbar_scholars)}</div>
      </div>
      <div class="detail-answer-row">
        <div class="q-text">4. سهولة الاستدلال والوصول لمحطات الاستفتاءات الشرعية:</div>
        <div class="a-val">${getRatStr(item.ratings.q_fatwa_access)}</div>
      </div>
      <div class="detail-answer-row">
        <div class="q-text">5. رحابة صدر المشايخ الأفاضل ودقة ووضوح إجاباتهم:</div>
        <div class="a-val">${getRatStr(item.ratings.q_fatwa_clarity)}</div>
      </div>
      <div class="detail-answer-row">
        <div class="q-text">6. تقييم خدمة الاستفتاءات الشرعية الإلكترونية والهاتفية:</div>
        <div class="a-val">${getRatStr(item.ratings.q_fatwa_online)}</div>
      </div>
      <div class="detail-answer-row">
        <div class="q-text">7. برامج ودورات رعاية الشباب والفتية:</div>
        <div class="a-val">${getRatStr(item.ratings.q_courses_youth)}</div>
      </div>
      <div class="detail-answer-row">
        <div class="q-text">8. جودة وتنوع الإصدارات المطبوعة والكتيبات الدينية:</div>
        <div class="a-val">${getRatStr(item.ratings.q_pub_quality)}</div>
      </div>
      <div class="detail-answer-row">
        <div class="q-text">9. المحتوى الديني والتثقيفي المنشور عبر المنصات الرقمية:</div>
        <div class="a-val">${getRatStr(item.ratings.q_digital_content)}</div>
      </div>
      <div class="detail-answer-row">
        <div class="q-text">10. التقييم الإجمالي لخدمات قسم الشؤون الدينية:</div>
        <div class="a-val" style="color:var(--gold); font-size:1.05rem;">★ ${getRatStr(item.ratings.q_overall_rating)}</div>
      </div>
    </div>

    ${item.suggestions ? `
      <div style="margin-top: 1.5rem; background:#fefce8; border:1px solid #fde047; padding:1.2rem; border-radius:12px;">
        <h5 style="margin:0 0 0.5rem; color:#854d0e; font-size:0.95rem;">
          <i class="fa-solid fa-comment-dots"></i> مقترحات وملاحظات المشارك:
        </h5>
        <p style="margin:0; color:#1e293b; line-height:1.7;">${escapeHtml(item.suggestions)}</p>
      </div>
    ` : ''}

    <div style="display:flex; justify-content:flex-end; gap:0.6rem; margin-top:1.5rem; padding-top:1rem; border-top:1px solid #e2e8f0; flex-wrap:wrap;">
      <button type="button" class="btn btn-outline" onclick="closeResponseDetailModal()">إغلاق</button>
      <button type="button" class="btn btn-gold" onclick="closeResponseDetailModal(); openEditResponseModal('${item.id}');">
        <i class="fa-solid fa-pen-to-square"></i> تعديل بيانات هذا الاستبيان
      </button>
      <button type="button" class="btn btn-outline" onclick="closeResponseDetailModal(); deleteResponse('${item.id}');" style="color:var(--danger); border-color:#fee2e2;">
        <i class="fa-solid fa-trash"></i> حذف هذا الاستبيان
      </button>
    </div>
  `;

  modal.classList.add('active');
}

function closeResponseDetailModal() {
  const modal = document.getElementById('responseDetailModal');
  if (modal) modal.classList.remove('active');
}

// ================= EDIT RESPONSE HANDLERS =================
function openEditResponseModal(id) {
  const item = responsesData.find(r => r.id === id);
  if (!item) {
    showToast('تعذر العثور على الاستبيان المحدد.', 'error');
    return;
  }

  document.getElementById('editResponseId').value = item.id;
  document.getElementById('displayEditId').value = item.id;
  document.getElementById('editParticipantName').value = item.participantName || '';
  document.getElementById('editUserType').value = item.userType || (item.isRegistered ? 'مستخدم مسجل' : 'زائر بدون حساب');
  document.getElementById('editProvince').value = item.province || 'كربلاء المقدسة';
  document.getElementById('editAgeGroup').value = item.ageGroup || '25 - 34 سنة';
  document.getElementById('editVisitFrequency').value = item.visitFrequency || 'شهرياً';
  document.getElementById('editRecommend').value = item.recommend || 'نعم بالتأكيد';
  document.getElementById('editSuggestions').value = item.suggestions || '';

  const ratings = item.ratings || {};
  document.getElementById('editOverallRating').value = ratings.q_overall_rating || 5;

  const qKeys = [
    'q_minbar_topics', 'q_minbar_timing', 'q_minbar_scholars',
    'q_fatwa_access', 'q_fatwa_clarity', 'q_fatwa_online',
    'q_courses_youth', 'q_pub_quality', 'q_digital_content'
  ];

  qKeys.forEach(k => {
    const el = document.getElementById('edit_' + k);
    if (el) {
      el.value = ratings[k] || 5;
    }
  });

  const modal = document.getElementById('editResponseModal');
  if (modal) modal.classList.add('active');
}

function closeEditResponseModal() {
  const modal = document.getElementById('editResponseModal');
  if (modal) modal.classList.remove('active');
}

async function saveEditedResponse(event) {
  event.preventDefault();

  const id = document.getElementById('editResponseId').value;
  const itemIndex = responsesData.findIndex(r => r.id === id);
  if (itemIndex === -1) {
    showToast('لم يتم العثور على الاستبيان المطلوب تعديله.', 'error');
    return;
  }

  const existingItem = responsesData[itemIndex];
  const userTypeVal = document.getElementById('editUserType').value;

  const qKeys = [
    'q_minbar_topics', 'q_minbar_timing', 'q_minbar_scholars',
    'q_fatwa_access', 'q_fatwa_clarity', 'q_fatwa_online',
    'q_courses_youth', 'q_pub_quality', 'q_digital_content'
  ];

  const updatedRatings = {
    q_overall_rating: parseInt(document.getElementById('editOverallRating').value, 10) || 5
  };

  qKeys.forEach(k => {
    const el = document.getElementById('edit_' + k);
    updatedRatings[k] = el ? (parseInt(el.value, 10) || 5) : 5;
  });

  const updatedItem = {
    ...existingItem,
    participantName: document.getElementById('editParticipantName').value.trim() || 'مشارك مجهول',
    userType: userTypeVal,
    isRegistered: userTypeVal === 'مستخدم مسجل',
    province: document.getElementById('editProvince').value,
    ageGroup: document.getElementById('editAgeGroup').value,
    visitFrequency: document.getElementById('editVisitFrequency').value,
    recommend: document.getElementById('editRecommend').value,
    suggestions: document.getElementById('editSuggestions').value.trim(),
    ratings: updatedRatings
  };

  responsesData[itemIndex] = updatedItem;
  saveResponses();
  renderAdminDashboard();
  closeEditResponseModal();

  // 1. Send update to Server API
  try {
    const res = await fetch(getApiUrl('update'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedItem)
    });
    if (res.ok) {
      showToast(`تم حفظ وتعديل استبيان رقم (${id}) على السيرفر بنجاح!`, 'success');
    } else {
      showToast(`تم التعديل محلياً (السيرفر أرجع رمز ${res.status})`, 'warning');
    }
  } catch (e) {
    showToast(`تم التعديل محلياً فقط (تعذر الاتصال بالسيرفر)`, 'warning');
  }
}

// ================= DELETE & CLEAR HANDLERS =================
async function deleteResponse(id) {
  if (!confirm(`هل أنت متأكد من حذف الاستبيان رقم (${id})؟ لا يمكن التراجع عن هذا الإجراء.`)) {
    return;
  }

  responsesData = responsesData.filter(r => r.id !== id);
  saveResponses();
  renderAdminDashboard();

  // Delete from server API
  try {
    const res = await fetch(getApiUrl('delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast(`تم حذف الاستبيان رقم (${id}) بنجاح من قاعدة بيانات السيرفر.`, 'info');
    } else {
      showToast(`تم الحذف محلياً (السيرفر أرجع رمز ${res.status})`, 'warning');
    }
  } catch (e) {
    showToast(`تم الحذف محلياً (تعذر الاتصال بالسيرفر)`, 'warning');
  }
}

// Reset / Zero-out All Survey Results
async function clearAllDataPrompt() {
  if (confirm('تنبيه هام للمشرف: هل أنت متأكد تماماً من تصفير وحذف جميع نتائج الاستبيانات؟ لا يمكن التراجع عن هذا الإجراء.')) {
    responsesData = [];
    localStorage.setItem(STORAGE_KEYS.RESPONSES, JSON.stringify([]));
    localStorage.setItem('shrine_survey_cleared', 'true');
    lastKnownStorageValue = JSON.stringify([]);
    renderAdminDashboard();

    // Clear server API
    try {
      const res = await fetch(getApiUrl('clear'), { method: 'POST' });
      if (res.ok) {
        showToast('تم تصفير وحذف جميع النتائج بنجاح من السيرفر وقاعدة البيانات!', 'success');
      } else {
        showToast(`تم التصفير محلياً (السيرفر أرجع رمز ${res.status})`, 'warning');
      }
    } catch (e) {
      showToast('تم التصفير محلياً (تعذر الاتصال بالسيرفر)', 'warning');
    }
  }
}

// ================= SERVER DIAGNOSTIC & REPAIR ENGINE =================
function openServerDiagModal() {
  const modal = document.getElementById('serverDiagModal');
  if (modal) modal.classList.add('active');
  runServerDiagnostic();
}

function closeServerDiagModal() {
  const modal = document.getElementById('serverDiagModal');
  if (modal) modal.classList.remove('active');
}

async function runServerDiagnostic() {
  const container = document.getElementById('serverDiagResults');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align:center; padding:1.5rem; color:#64748b;">
      <i class="fa-solid fa-spinner fa-spin" style="font-size:2rem; color:var(--primary); margin-bottom:0.75rem;"></i>
      <p style="margin:0; font-weight:600;">جاري فحص السيرفر السحابي وقاعدة البيانات وصلاحيات الملفات...</p>
    </div>
  `;

  try {
    const res = await fetch(getApiUrl('diagnostic'), { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`السيرفر استجاب برمز خطأ (${res.status})`);
    }

    const diag = await res.json();
    const isHealthy = diag.healthy || diag.status === 'ok';

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.9rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:0.8rem 1rem; border-radius:8px; background:${isHealthy ? '#ecfdf5' : '#fef2f2'}; border:1px solid ${isHealthy ? '#a7f3d0' : '#fca5a5'};">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <i class="fa-solid ${isHealthy ? 'fa-circle-check' : 'fa-circle-exclamation'}" style="font-size:1.3rem; color:${isHealthy ? '#10b981' : '#ef4444'};"></i>
            <div>
              <strong style="color:${isHealthy ? '#065f46' : '#991b1b'}; display:block; font-size:0.95rem;">
                ${isHealthy ? 'حالة السيرفر: متصل ويعمل بكفاءة' : 'تنبيه: السيرفر يحتاج مراجعة الأذونات'}
              </strong>
              <small style="color:${isHealthy ? '#047857' : '#b91c1c'};">${isHealthy ? 'الاستجابة ممتازة وقاعدة البيانات تقبل حفظ واسترجاع الاستبيانات' : 'قد تكون هناك قيود في كتابة الملفات'}</small>
            </div>
          </div>
          <span style="font-weight:700; font-size:0.8rem; background:#fff; padding:0.25rem 0.6rem; border-radius:6px; border:1px solid #cbd5e1;">PHP ${diag.phpVersion || 'OK'}</span>
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:0.85rem; background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
          <tbody>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:0.6rem 0.8rem; color:#64748b; width:40%;">محرك التخزين الفعّال</td>
              <td style="padding:0.6rem 0.8rem; font-weight:700; color:#0f172a;">${escapeHtml(diag.storageEngine || 'SQLite + JSON')}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:0.6rem 0.8rem; color:#64748b;">دعم قاعدة SQLite</td>
              <td style="padding:0.6rem 0.8rem; font-weight:700; color:${diag.sqliteActive ? '#15803d' : '#b45309'};">
                <i class="fa-solid ${diag.sqliteActive ? 'fa-check' : 'fa-minus'}"></i> ${diag.sqliteActive ? 'مفعلة وتعمل (ACID Safe)' : 'غير متوفرة، الاعتماد على ملف JSON'}
              </td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:0.6rem 0.8rem; color:#64748b;">صلاحيات ملف البيانات (JSON)</td>
              <td style="padding:0.6rem 0.8rem; font-weight:700; color:${diag.jsonWritable ? '#15803d' : '#dc2626'};">
                <i class="fa-solid ${diag.jsonWritable ? 'fa-check' : 'fa-xmark'}"></i> ${diag.jsonWritable ? 'قابلة للكتابة والحفظ (Writable 0666)' : 'غير قابلة للكتابة (يرجى النقر على إصلاح الأذونات)'}
              </td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:0.6rem 0.8rem; color:#64748b;">صلاحيات مجلد النظام</td>
              <td style="padding:0.6rem 0.8rem; font-weight:700; color:${diag.dirWritable ? '#15803d' : '#dc2626'};">
                <i class="fa-solid ${diag.dirWritable ? 'fa-check' : 'fa-xmark'}"></i> ${diag.dirWritable ? 'متاح للكتابة وإنشاء الملفات' : 'مقيد'}
              </td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:0.6rem 0.8rem; color:#64748b;">عدد الاستبيانات المسجلة بالسيرفر</td>
              <td style="padding:0.6rem 0.8rem; font-weight:700; color:var(--primary); font-size:1rem;">
                ${diag.count ?? 0} مشاركة
              </td>
            </tr>
            <tr>
              <td style="padding:0.6rem 0.8rem; color:#64748b;">وقت السيرفر السحابي</td>
              <td style="padding:0.6rem 0.8rem; font-weight:600; color:#334155; font-family:monospace;">${diag.serverTime || '-'}</td>
            </tr>
          </tbody>
        </table>

        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.4rem;">
          <button type="button" class="btn btn-outline btn-sm" onclick="repairServerPermissions()" style="flex:1; min-width:180px;">
            <i class="fa-solid fa-wrench"></i> إصلاح الأذونات تلقائياً (Auto-Repair)
          </button>
          <button type="button" class="btn btn-gold btn-sm" onclick="testCloudSubmission()" style="flex:1; min-width:180px;">
            <i class="fa-solid fa-paper-plane"></i> إرسال مشاركة تجريبية للتحقق
          </button>
        </div>
      </div>
    `;

    // Also update server badge
    updateServerStatusBadge(true, diag.count || 0);

  } catch (err) {
    container.innerHTML = `
      <div style="background:#fef2f2; border:1px solid #fca5a5; border-radius:8px; padding:1.2rem; text-align:center;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size:2rem; color:#ef4444; margin-bottom:0.6rem;"></i>
        <h4 style="color:#991b1b; margin:0 0 0.4rem 0;">تعذر الاتصال بملف السيرفر (api.php)</h4>
        <p style="color:#b91c1c; font-size:0.85rem; margin-bottom:1rem;">
          السبب المحتمل: ${escapeHtml(err.message)}.<br>
          يرجى التأكد من رفع ملف <code>api.php</code> في نفس مجلد الموقع والتأكد من دعم الاستضافة لـ PHP.
        </p>
        <button type="button" class="btn btn-outline btn-sm" onclick="runServerDiagnostic()">
          <i class="fa-solid fa-rotate"></i> إعادة المحاولة الآن
        </button>
      </div>
    `;
    updateServerStatusBadge(false, responsesData.length);
  }
}

async function repairServerPermissions() {
  const container = document.getElementById('serverDiagResults');
  if (container) {
    container.innerHTML = `
      <div style="text-align:center; padding:1.5rem; color:#64748b;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:2rem; color:var(--primary); margin-bottom:0.75rem;"></i>
        <p style="margin:0; font-weight:600;">جاري تعديل أذونات الملفات ومزامنة قاعدة البيانات...</p>
      </div>
    `;
  }

  try {
    const res = await fetch(getApiUrl('repair'), { method: 'POST' });
    if (res.ok) {
      showToast('تم إصلاح الأذونات وتأكيد سلامة قاعدة البيانات بنجاح!', 'success');
    }
  } catch (e) {}

  setTimeout(runServerDiagnostic, 600);
}

async function testCloudSubmission() {
  const testId = 'TEST-' + Math.floor(100000 + Math.random() * 900000);
  const testPayload = {
    id: testId,
    timestamp: new Date().toISOString(),
    displayDate: new Date().toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }),
    userType: 'فحص النظام السحابي',
    isRegistered: false,
    participantName: 'مشارك تجريبي (فحص الاتصال السحابي)',
    province: 'كربلاء المقدسة',
    ageGroup: '25 - 34 سنة',
    visitFrequency: 'أسبوعياً',
    ratings: {
      q_minbar_topics: 5, q_minbar_timing: 5, q_minbar_scholars: 5,
      q_fatwa_access: 5, q_fatwa_clarity: 5, q_fatwa_online: 5,
      q_courses_youth: 5, q_pub_quality: 5, q_digital_content: 5,
      q_overall_rating: 5
    },
    recommend: 'نعم بالتأكيد وبشدة',
    suggestions: 'تجربة اختبار الربط مع السيرفر السحابي بنجاح.'
  };

  try {
    const res = await fetch(getApiUrl('submit'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload)
    });

    if (res.ok) {
      const data = await res.json();
      showToast(`نجح الفحص السحابي! تم إرسال وحفظ الاستبيان (${testId}) وتوثيقه بنجاح على السيرفر.`, 'success', 6000);
      await loadResponses();
      runServerDiagnostic();
    } else {
      showToast(`فشل الفحص: أرجع السيرفر رمز (${res.status})`, 'error');
    }
  } catch (err) {
    showToast(`فشل الفحص: ${err.message}`, 'error');
  }
}

// ================= ADVANCED DATA EXPORT & STYLING ENGINE =================

let selectedExportFormat = 'xlsx';

function openExportModal() {
  const modal = document.getElementById('exportOptionsModal');
  if (modal) modal.classList.add('active');
}

function closeExportModal() {
  const modal = document.getElementById('exportOptionsModal');
  if (modal) modal.classList.remove('active');
}

function selectExportFormat(format) {
  selectedExportFormat = format;
  document.querySelectorAll('.format-option-card').forEach(el => el.classList.remove('selected'));
  if (format === 'xlsx') document.getElementById('optFormatXlsx')?.classList.add('selected');
  if (format === 'xls') document.getElementById('optFormatXls')?.classList.add('selected');
  if (format === 'csv') document.getElementById('optFormatCsv')?.classList.add('selected');

  const chkAnalytics = document.getElementById('lblIncludeAnalytics');
  if (chkAnalytics) {
    chkAnalytics.style.display = format === 'csv' ? 'none' : 'flex';
  }
}

function triggerCustomExport() {
  const sortKey = document.getElementById('exportSortSelect')?.value || 'date_desc';
  const scope = document.getElementById('exportScopeSelect')?.value || 'all';
  const includeAnalytics = document.getElementById('chkIncludeAnalytics')?.checked ?? true;

  const options = {
    sortBy: sortKey,
    scope: scope,
    includeAnalytics: includeAnalytics
  };

  closeExportModal();

  if (selectedExportFormat === 'xlsx') {
    exportToNativeExcel(options);
  } else if (selectedExportFormat === 'xls') {
    exportToStyledExcel(options);
  } else if (selectedExportFormat === 'csv') {
    exportResponsesToCSV(options);
  }
}

// Helpers for sorting and filtering responses
function getFilteredResponsesForExport(scope = 'all') {
  if (scope === 'filtered') {
    const searchVal = (document.getElementById('tableSearchInput')?.value || '').trim().toLowerCase();
    const typeVal = document.getElementById('tableTypeFilter')?.value || 'ALL';

    return responsesData.filter(r => {
      const matchSearch = !searchVal ||
        (r.participantName && r.participantName.toLowerCase().includes(searchVal)) ||
        (r.province && r.province.toLowerCase().includes(searchVal)) ||
        (r.id && r.id.toLowerCase().includes(searchVal));

      const matchType = (typeVal === 'ALL') ||
        (typeVal === 'REGISTERED' && r.isRegistered) ||
        (typeVal === 'GUEST' && !r.isRegistered);

      return matchSearch && matchType;
    });
  }
  return [...responsesData];
}

function getSortedResponses(dataList, sortKey = 'date_desc') {
  const list = [...dataList];
  switch (sortKey) {
    case 'date_desc':
      return list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    case 'date_asc':
      return list.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    case 'rating_desc':
      return list.sort((a, b) => (b.ratings?.q_overall_rating || 0) - (a.ratings?.q_overall_rating || 0));
    case 'rating_asc':
      return list.sort((a, b) => (a.ratings?.q_overall_rating || 0) - (b.ratings?.q_overall_rating || 0));
    case 'name_asc':
      return list.sort((a, b) => (a.participantName || '').localeCompare(b.participantName || '', 'ar'));
    case 'province_asc':
      return list.sort((a, b) => (a.province || '').localeCompare(b.province || '', 'ar'));
    default:
      return list;
  }
}

function getRatingLabel(val) {
  switch (parseInt(val, 10)) {
    case 5: return '5 (ممتاز)';
    case 4: return '4 (جيد جداً)';
    case 3: return '3 (جيد)';
    case 2: return '2 (مقبول)';
    case 1: return '1 (تطوير)';
    default: return val || '-';
  }
}

// Calculate comprehensive summary metrics
function calculateExportMetrics(list) {
  const total = list.length;
  if (total === 0) {
    return {
      total: 0,
      avgSatisfaction: 0,
      regCount: 0,
      guestCount: 0,
      suggCount: 0,
      avgAxis1: 0,
      avgAxis2: 0,
      avgAxis3: 0,
      avgOverall: 0,
      ratingDist: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      topProvince: '-',
      provincesList: []
    };
  }

  let sumOverall = 0, sumMinbar = 0, sumFatwa = 0, sumCourses = 0;
  let regCount = 0, suggCount = 0;
  const ratingDist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  const provMap = {};

  list.forEach(r => {
    const ov = r.ratings?.q_overall_rating || 0;
    sumOverall += ov;
    if (ratingDist[ov] !== undefined) ratingDist[ov]++;

    const m1 = (r.ratings?.q_minbar_topics || 0) + (r.ratings?.q_minbar_timing || 0) + (r.ratings?.q_minbar_scholars || 0);
    sumMinbar += m1 / 3;

    const m2 = (r.ratings?.q_fatwa_access || 0) + (r.ratings?.q_fatwa_clarity || 0) + (r.ratings?.q_fatwa_online || 0);
    sumFatwa += m2 / 3;

    const m3 = (r.ratings?.q_courses_youth || 0) + (r.ratings?.q_pub_quality || 0) + (r.ratings?.q_digital_content || 0);
    sumCourses += m3 / 3;

    if (r.isRegistered) regCount++;
    if (r.suggestions && r.suggestions.trim().length > 1) suggCount++;

    const prov = r.province || 'غير محدد';
    provMap[prov] = (provMap[prov] || 0) + 1;
  });

  const avgSatisfaction = Math.round((sumOverall / (total * 5)) * 100);
  const avgOverall = (sumOverall / total).toFixed(2);
  const avgAxis1 = (sumMinbar / total).toFixed(2);
  const avgAxis2 = (sumFatwa / total).toFixed(2);
  const avgAxis3 = (sumCourses / total).toFixed(2);

  const provincesList = Object.entries(provMap)
    .sort((a, b) => b[1] - a[1])
    .map(([prov, count]) => ({
      prov,
      count,
      pct: Math.round((count / total) * 100)
    }));

  const topProvince = provincesList[0] ? `${provincesList[0].prov} (${provincesList[0].pct}%)` : '-';

  return {
    total,
    avgSatisfaction,
    regCount,
    guestCount: total - regCount,
    suggCount,
    avgAxis1,
    avgAxis2,
    avgAxis3,
    avgOverall,
    ratingDist,
    topProvince,
    provincesList
  };
}

// -------------------------------------------------------------
// 1. NATIVE XLSX EXPORT WITH STYLING AND MULTI-SHEET ANALYTICS
// -------------------------------------------------------------
function exportToNativeExcel(customOptions = {}) {
  const options = {
    sortBy: 'date_desc',
    scope: 'all',
    includeAnalytics: true,
    ...customOptions
  };

  const rawList = getFilteredResponsesForExport(options.scope);
  if (rawList.length === 0) {
    showToast('لا توجد بيانات مطابقة للتصدير حالياً.', 'error');
    return;
  }

  const list = getSortedResponses(rawList, options.sortBy);
  const metrics = calculateExportMetrics(list);
  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-IQ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });

  // If XLSX library is not available, fallback to styled XML/HTML
  if (typeof XLSX === 'undefined') {
    console.warn('XLSX bundle not found, falling back to styled XML XLS');
    exportToStyledExcel(options);
    return;
  }

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  // ================= SHEET 1: DETAILED RESPONSES =================
  const ws1 = {};
  const merges1 = [];

  // Helper function to set cell with style
  function setC(ws, r, c, val, type, s) {
    const ref = XLSX.utils.encode_cell({ r, c });
    ws[ref] = {
      t: type || (typeof val === 'number' ? 'n' : 's'),
      v: val !== undefined && val !== null ? val : '',
      s: s || {}
    };
  }

  function mergeC(ws, merges, r1, c1, r2, c2, val, type, s) {
    merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        setC(ws, r, c, (r === r1 && c === c1) ? val : '', type, s);
      }
    }
  }

  const COLS_COUNT = 23; // Columns A to W

  // Style Definitions (RGB Hex without #)
  const borderThin = {
    top: { style: 'thin', color: { rgb: 'CBD5E1' } },
    bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
    left: { style: 'thin', color: { rgb: 'CBD5E1' } },
    right: { style: 'thin', color: { rgb: 'CBD5E1' } }
  };

  const stBanner1 = {
    fill: { fgColor: { rgb: '0A4D34' } },
    font: { name: 'Segoe UI', sz: 14, bold: true, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' }
  };

  const stBanner2 = {
    fill: { fgColor: { rgb: '05261B' } },
    font: { name: 'Segoe UI', sz: 10, bold: true, color: { rgb: 'FEF08A' } },
    alignment: { horizontal: 'center', vertical: 'center' }
  };

  const stBanner3 = {
    fill: { fgColor: { rgb: 'F8FAFC' } },
    font: { name: 'Segoe UI', sz: 9, color: { rgb: '475569' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { bottom: { style: 'thin', color: { rgb: 'CBD5E1' } } }
  };

  const stKpiTitle = {
    fill: { fgColor: { rgb: 'F1F5F9' } },
    font: { name: 'Segoe UI', sz: 9.5, bold: true, color: { rgb: '0A4D34' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: borderThin
  };

  const stKpiVal = (color) => ({
    fill: { fgColor: { rgb: 'FFFFFF' } },
    font: { name: 'Segoe UI', sz: 13, bold: true, color: { rgb: color || '0F172A' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: borderThin
  });

  const stGroupMain = {
    fill: { fgColor: { rgb: '0A4D34' } },
    font: { name: 'Segoe UI', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: borderThin
  };

  const stGroupGold = {
    fill: { fgColor: { rgb: 'C59B27' } },
    font: { name: 'Segoe UI', sz: 10, bold: true, color: { rgb: '03140E' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: borderThin
  };

  const stHeader = {
    fill: { fgColor: { rgb: '0F3D2E' } },
    font: { name: 'Segoe UI', sz: 9.5, bold: true, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: borderThin
  };

  const stHeaderGold = {
    fill: { fgColor: { rgb: 'C59B27' } },
    font: { name: 'Segoe UI', sz: 9.5, bold: true, color: { rgb: '03140E' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: borderThin
  };

  // Row 0: Shrine Title Banner
  mergeC(ws1, merges1, 0, 0, 0, COLS_COUNT - 1, 'الأمانة العامة للعتبة الحسينية المقدسة - قسم الشؤون الدينية', 's', stBanner1);

  // Row 1: Subtitle
  mergeC(ws1, merges1, 1, 0, 1, COLS_COUNT - 1, 'التقرير الإحصائي التراكمي لنتائج استبيان قياس رضا الزائرين الكرام', 's', stBanner2);

  // Row 2: Metadata
  mergeC(ws1, merges1, 2, 0, 2, COLS_COUNT - 1, `تاريخ استخراج التقرير: ${dateStr} - الساعة: ${timeStr} | إجمالي السجلات المصدرة: ${metrics.total} استبانة`, 's', stBanner3);

  // Row 3: Blank
  for (let c = 0; c < COLS_COUNT; c++) setC(ws1, 3, c, '', 's', {});

  // Row 4 & 5: KPI Summary Cards Block
  // Card 1: Total
  mergeC(ws1, merges1, 4, 0, 4, 3, 'إجمالي المشاركات', 's', stKpiTitle);
  mergeC(ws1, merges1, 5, 0, 5, 3, metrics.total, 'n', stKpiVal('0A4D34'));

  // Card 2: Satisfaction %
  mergeC(ws1, merges1, 4, 4, 4, 7, 'معدل الرضا العام الإجمالي', 's', stKpiTitle);
  mergeC(ws1, merges1, 5, 4, 5, 7, `${metrics.avgSatisfaction}%`, 's', stKpiVal('C59B27'));

  // Card 3: Registered
  mergeC(ws1, merges1, 4, 8, 4, 11, 'حسابات مسجلة', 's', stKpiTitle);
  mergeC(ws1, merges1, 5, 8, 5, 11, metrics.regCount, 'n', stKpiVal('0284C7'));

  // Card 4: Guests
  mergeC(ws1, merges1, 4, 12, 4, 15, 'زوار بدون حساب', 's', stKpiTitle);
  mergeC(ws1, merges1, 5, 12, 5, 15, metrics.guestCount, 'n', stKpiVal('64748B'));

  // Card 5: Suggestions
  mergeC(ws1, merges1, 4, 16, 4, 19, 'مقترحات نصية مدونة', 's', stKpiTitle);
  mergeC(ws1, merges1, 5, 16, 5, 19, metrics.suggCount, 'n', stKpiVal('D97706'));

  // Card 6: Top Province
  mergeC(ws1, merges1, 4, 20, 4, 22, 'المحافظة الأكثر تفاعلاً', 's', stKpiTitle);
  mergeC(ws1, merges1, 5, 20, 5, 22, metrics.topProvince, 's', stKpiVal('0F172A'));

  // Row 6: Blank
  for (let c = 0; c < COLS_COUNT; c++) setC(ws1, 6, c, '', 's', {});

  // Row 7: Group Headers
  mergeC(ws1, merges1, 7, 0, 7, 7, 'بيانات المشارك الأساسية والزيارة', 's', stGroupMain);
  mergeC(ws1, merges1, 7, 8, 7, 11, 'المحور الأول: المنبر الحسيني والمحاضرات', 's', stGroupMain);
  mergeC(ws1, merges1, 7, 12, 7, 15, 'المحور الثاني: الاستفتاءات الشرعية والإرشاد', 's', stGroupMain);
  mergeC(ws1, merges1, 7, 16, 7, 19, 'المحور الثالث: الدورات الثقافية والإصدارات', 's', stGroupMain);
  mergeC(ws1, merges1, 7, 20, 7, 22, 'التقييم الإجمالي والتوصيات والمقترحات', 's', stGroupGold);

  // Row 8: Column Headers
  const colHeaders = [
    'ت',
    'رقم الاستبيان',
    'تاريخ ووقت المشاركة',
    'اسم المشارك الكريم',
    'نوع الحساب',
    'المحافظة / الإقامة',
    'الفئة العمرية',
    'معدل وتيرة الزيارة',
    'مواضيع المحاضرات',
    'توقيت ومكان المحاضرات',
    'كفاءة الخطباء',
    'متوسط المنبر',
    'محطات الاستفتاءات',
    'رحابة صدر المشايخ',
    'الاستفتاءات الإلكترونية',
    'متوسط الاستفتاءات',
    'دورات الفتية والشباب',
    'جودة الإصدارات',
    'المحتوى الرقمي',
    'متوسط الدورات',
    'التقييم العام للقسم',
    'توصية الآخرين',
    'مقترحات وملاحظات المشارك'
  ];

  colHeaders.forEach((h, idx) => {
    setC(ws1, 8, idx, h, 's', idx === 20 ? stHeaderGold : stHeader);
  });

  // Rating cell style generator
  function getRatingStyle(val) {
    const n = parseInt(val, 10);
    let fill = 'FFFFFF', color = '1E293B';
    if (n === 5) { fill = 'DCFCE7'; color = '14532D'; }
    else if (n === 4) { fill = 'F0FDF4'; color = '166534'; }
    else if (n === 3) { fill = 'FEF9C3'; color = '854D0E'; }
    else if (n <= 2 && n > 0) { fill = 'FEE2E2'; color = '991B1B'; }

    return {
      fill: { fgColor: { rgb: fill } },
      font: { name: 'Segoe UI', sz: 9.5, bold: true, color: { rgb: color } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: borderThin
    };
  }

  // Row Data population
  const startRow = 9;
  list.forEach((r, idx) => {
    const rowIdx = startRow + idx;
    const isAlt = idx % 2 === 1;
    const bgRgb = isAlt ? 'F8FAFC' : 'FFFFFF';

    const cellRegular = (align = 'center', color = '1E293B', bold = false) => ({
      fill: { fgColor: { rgb: bgRgb } },
      font: { name: 'Segoe UI', sz: 9.5, bold: bold, color: { rgb: color } },
      alignment: { horizontal: align, vertical: 'center', wrapText: align === 'right' },
      border: borderThin
    });

    const m1_topics = r.ratings?.q_minbar_topics || 0;
    const m1_timing = r.ratings?.q_minbar_timing || 0;
    const m1_scholars = r.ratings?.q_minbar_scholars || 0;
    const avgM1 = Number(((m1_topics + m1_timing + m1_scholars) / 3).toFixed(1));

    const m2_access = r.ratings?.q_fatwa_access || 0;
    const m2_clarity = r.ratings?.q_fatwa_clarity || 0;
    const m2_online = r.ratings?.q_fatwa_online || 0;
    const avgM2 = Number(((m2_access + m2_clarity + m2_online) / 3).toFixed(1));

    const m3_courses = r.ratings?.q_courses_youth || 0;
    const m3_pub = r.ratings?.q_pub_quality || 0;
    const m3_digital = r.ratings?.q_digital_content || 0;
    const avgM3 = Number(((m3_courses + m3_pub + m3_digital) / 3).toFixed(1));

    const overall = r.ratings?.q_overall_rating || 0;

    const badgeUserStyle = r.isRegistered
      ? { fill: { fgColor: { rgb: 'EFF6FF' } }, font: { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: '1D4ED8' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: borderThin }
      : { fill: { fgColor: { rgb: 'F1F5F9' } }, font: { name: 'Segoe UI', sz: 9, color: { rgb: '475569' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: borderThin };

    const axisAvgStyle = {
      fill: { fgColor: { rgb: 'ECFDF5' } },
      font: { name: 'Segoe UI', sz: 9.5, bold: true, color: { rgb: '065F46' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: borderThin
    };

    const overallStyle = {
      fill: { fgColor: { rgb: 'FEF08A' } },
      font: { name: 'Segoe UI', sz: 10, bold: true, color: { rgb: '854D0E' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: borderThin
    };

    // A: Index
    setC(ws1, rowIdx, 0, idx + 1, 'n', cellRegular('center', '64748B', true));
    // B: ID
    setC(ws1, rowIdx, 1, r.id || '', 's', cellRegular('center', '0A4D34', true));
    // C: Date
    setC(ws1, rowIdx, 2, r.displayDate || (r.timestamp ? r.timestamp.slice(0, 16).replace('T', ' ') : '-'), 's', cellRegular('center', '64748B'));
    // D: Name
    setC(ws1, rowIdx, 3, r.participantName || 'زائر كريم', 's', cellRegular('right', '0F172A', true));
    // E: User Type
    setC(ws1, rowIdx, 4, r.isRegistered ? 'حساب مسجل رسمي' : 'زائر بدون حساب', 's', badgeUserStyle);
    // F: Province
    setC(ws1, rowIdx, 5, r.province || '-', 's', cellRegular('center'));
    // G: Age
    setC(ws1, rowIdx, 6, r.ageGroup || '-', 's', cellRegular('center'));
    // H: Frequency
    setC(ws1, rowIdx, 7, r.visitFrequency || '-', 's', cellRegular('center'));

    // I, J, K: Axis 1
    setC(ws1, rowIdx, 8, m1_topics, 'n', getRatingStyle(m1_topics));
    setC(ws1, rowIdx, 9, m1_timing, 'n', getRatingStyle(m1_timing));
    setC(ws1, rowIdx, 10, m1_scholars, 'n', getRatingStyle(m1_scholars));
    setC(ws1, rowIdx, 11, avgM1, 'n', axisAvgStyle);

    // M, N, O: Axis 2
    setC(ws1, rowIdx, 12, m2_access, 'n', getRatingStyle(m2_access));
    setC(ws1, rowIdx, 13, m2_clarity, 'n', getRatingStyle(m2_clarity));
    setC(ws1, rowIdx, 14, m2_online, 'n', getRatingStyle(m2_online));
    setC(ws1, rowIdx, 15, avgM2, 'n', axisAvgStyle);

    // Q, R, S: Axis 3
    setC(ws1, rowIdx, 16, m3_courses, 'n', getRatingStyle(m3_courses));
    setC(ws1, rowIdx, 17, m3_pub, 'n', getRatingStyle(m3_pub));
    setC(ws1, rowIdx, 18, m3_digital, 'n', getRatingStyle(m3_digital));
    setC(ws1, rowIdx, 19, avgM3, 'n', axisAvgStyle);

    // U: Overall Rating
    setC(ws1, rowIdx, 20, getRatingLabel(overall), 's', overallStyle);
    // V: Recommend
    setC(ws1, rowIdx, 21, r.recommend || '-', 's', cellRegular('center'));
    // W: Suggestions
    setC(ws1, rowIdx, 22, r.suggestions || '-', 's', cellRegular('right', '334155'));
  });

  // Bottom Summary Row (Averages)
  const lastRow = startRow + list.length;
  const stBottomTitle = {
    fill: { fgColor: { rgb: 'C59B27' } },
    font: { name: 'Segoe UI', sz: 10.5, bold: true, color: { rgb: '03140E' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: borderThin
  };

  const stBottomVal = {
    fill: { fgColor: { rgb: 'FEF3C7' } },
    font: { name: 'Segoe UI', sz: 10, bold: true, color: { rgb: '854D0E' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: borderThin
  };

  mergeC(ws1, merges1, lastRow, 0, lastRow, 7, 'المتوسط الحسابي الإجمالي للمحاور والخدمات (من 5):', 's', stBottomTitle);

  // Calculate averages per column
  const getColAvg = (key) => Number((list.reduce((acc, r) => acc + (r.ratings?.[key] || 0), 0) / list.length).toFixed(2));
  setC(ws1, lastRow, 8, getColAvg('q_minbar_topics'), 'n', stBottomVal);
  setC(ws1, lastRow, 9, getColAvg('q_minbar_timing'), 'n', stBottomVal);
  setC(ws1, lastRow, 10, getColAvg('q_minbar_scholars'), 'n', stBottomVal);
  setC(ws1, lastRow, 11, Number(metrics.avgAxis1), 'n', stBottomVal);

  setC(ws1, lastRow, 12, getColAvg('q_fatwa_access'), 'n', stBottomVal);
  setC(ws1, lastRow, 13, getColAvg('q_fatwa_clarity'), 'n', stBottomVal);
  setC(ws1, lastRow, 14, getColAvg('q_fatwa_online'), 'n', stBottomVal);
  setC(ws1, lastRow, 15, Number(metrics.avgAxis2), 'n', stBottomVal);

  setC(ws1, lastRow, 16, getColAvg('q_courses_youth'), 'n', stBottomVal);
  setC(ws1, lastRow, 17, getColAvg('q_pub_quality'), 'n', stBottomVal);
  setC(ws1, lastRow, 18, getColAvg('q_digital_content'), 'n', stBottomVal);
  setC(ws1, lastRow, 19, Number(metrics.avgAxis3), 'n', stBottomVal);

  setC(ws1, lastRow, 20, `${metrics.avgOverall} (${metrics.avgSatisfaction}%)`, 's', stBottomVal);
  mergeC(ws1, merges1, lastRow, 21, lastRow, 22, '-', 's', stBottomVal);

  // Set ranges and dimensions for Sheet 1
  ws1['!merges'] = merges1;
  ws1['!views'] = [{ RTL: true }];
  ws1['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: COLS_COUNT - 1 } });
  ws1['!cols'] = [
    { wch: 6 },   // A: Index
    { wch: 14 },  // B: ID
    { wch: 20 },  // C: Date
    { wch: 25 },  // D: Name
    { wch: 16 },  // E: Account Type
    { wch: 18 },  // F: Province
    { wch: 14 },  // G: Age
    { wch: 16 },  // H: Frequency
    { wch: 15 },  // I: Minbar topics
    { wch: 15 },  // J: Minbar timing
    { wch: 15 },  // K: Minbar scholars
    { wch: 15 },  // L: Axis 1 Avg
    { wch: 15 },  // M: Fatwa access
    { wch: 15 },  // N: Fatwa clarity
    { wch: 15 },  // O: Fatwa online
    { wch: 15 },  // P: Axis 2 Avg
    { wch: 15 },  // Q: Youth courses
    { wch: 15 },  // R: Publication quality
    { wch: 15 },  // S: Digital content
    { wch: 15 },  // T: Axis 3 Avg
    { wch: 18 },  // U: Overall Rating
    { wch: 16 },  // V: Recommend
    { wch: 40 }   // W: Suggestions
  ];

  XLSX.utils.book_append_sheet(wb, ws1, 'نتائج الاستبيان المفصلة');

  // ================= SHEET 2: ANALYTICS & STATS DASHBOARD =================
  if (options.includeAnalytics) {
    const ws2 = {};
    const merges2 = [];

    // Header Banners
    mergeC(ws2, merges2, 0, 0, 0, 6, 'الأمانة العامة للعتبة الحسينية المقدسة - قسم الشؤون الدينية', 's', stBanner1);
    mergeC(ws2, merges2, 1, 0, 1, 6, 'لوحة المؤشرات والتحليل الإحصائي التراكمي لنتائج الاستبيان', 's', stBanner2);
    mergeC(ws2, merges2, 2, 0, 2, 6, `تاريخ إعداد التحليل: ${dateStr} - إجمالي العينة: ${metrics.total} مشارك`, 's', stBanner3);

    // Section 1: General Metrics Table
    let curR = 4;
    mergeC(ws2, merges2, curR, 0, curR, 6, '1. ملخص المؤشرات العامة ومعدلات الرضا', 's', stGroupMain);
    curR++;

    const tbl1Headers = ['م', 'المؤشر الإحصائي', 'القيمة العددية', 'النسبة المئوية', 'التقييم اللفظي والملاحظات', '', ''];
    mergeC(ws2, merges2, curR, 0, curR, 0, 'م', 's', stHeader);
    mergeC(ws2, merges2, curR, 1, curR, 2, 'المؤشر الإحصائي', 's', stHeader);
    setC(ws2, curR, 3, 'القيمة / العدد', 's', stHeader);
    setC(ws2, curR, 4, 'النسبة المئوية', 's', stHeader);
    mergeC(ws2, merges2, curR, 5, curR, 6, 'التقييم والمستوى', 's', stHeader);
    curR++;

    const metricsRows = [
      { num: 1, name: 'إجمالي الاستبيانات المستلمة', val: metrics.total, pct: '100%', note: 'عينة الاستبيان المكتملة' },
      { num: 2, name: 'نسبة الرضا العام الإجمالي للخدمات', val: `${metrics.avgOverall} من 5`, pct: `${metrics.avgSatisfaction}%`, note: metrics.avgSatisfaction >= 85 ? 'ممتاز جداً' : 'جيد جداً' },
      { num: 3, name: 'المشاركون بحسابات مسجلة رسمية', val: metrics.regCount, pct: `${Math.round((metrics.regCount / metrics.total) * 100)}%`, note: 'مستخدمون يمتلكون ملفاً شخصياً' },
      { num: 4, name: 'المشاركون كزوار (بدون حساب)', val: metrics.guestCount, pct: `${Math.round((metrics.guestCount / metrics.total) * 100)}%`, note: 'مشاركات حرة من الزوار' },
      { num: 5, name: 'المقترحات والملاحظات المكتوبة', val: metrics.suggCount, pct: `${Math.round((metrics.suggCount / metrics.total) * 100)}%`, note: 'ملاحظات تفصيلية لتطوير الخدمات' }
    ];

    metricsRows.forEach(row => {
      const stRow = (align = 'center', bold = false) => ({
        fill: { fgColor: { rgb: 'FFFFFF' } },
        font: { name: 'Segoe UI', sz: 9.5, bold: bold, color: { rgb: '1E293B' } },
        alignment: { horizontal: align, vertical: 'center' },
        border: borderThin
      });
      setC(ws2, curR, 0, row.num, 'n', stRow('center', true));
      mergeC(ws2, merges2, curR, 1, curR, 2, row.name, 's', stRow('right', true));
      setC(ws2, curR, 3, row.val, 's', stRow('center', true));
      setC(ws2, curR, 4, row.pct, 's', stRow('center', true));
      mergeC(ws2, merges2, curR, 5, curR, 6, row.note, 's', stRow('center'));
      curR++;
    });

    curR += 1;

    // Section 2: Axes Breakdown Table
    mergeC(ws2, merges2, curR, 0, curR, 6, '2. تقييم محاور قسم الشؤون الدينية', 's', stGroupMain);
    curR++;

    mergeC(ws2, merges2, curR, 0, curR, 0, 'م', 's', stHeader);
    mergeC(ws2, merges2, curR, 1, curR, 2, 'محور التقييم', 's', stHeader);
    setC(ws2, curR, 3, 'المتوسط (من 5)', 's', stHeader);
    setC(ws2, curR, 4, 'النسبة المئوية', 's', stHeader);
    mergeC(ws2, merges2, curR, 5, curR, 6, 'مستوى الرضا', 's', stHeader);
    curR++;

    const axesRows = [
      { num: 1, name: 'المحور الأول: المنبر الحسيني والمحاضرات الدينية', avg: metrics.avgAxis1, pct: `${Math.round((metrics.avgAxis1 / 5) * 100)}%` },
      { num: 2, name: 'المحور الثاني: الاستفتاءات الشرعية والإرشاد الديني', avg: metrics.avgAxis2, pct: `${Math.round((metrics.avgAxis2 / 5) * 100)}%` },
      { num: 3, name: 'المحور الثالث: الدورات الثقافية والإصدارات الدينية', avg: metrics.avgAxis3, pct: `${Math.round((metrics.avgAxis3 / 5) * 100)}%` },
      { num: '★', name: 'التقييم العام الشامل لخدمات القسم', avg: metrics.avgOverall, pct: `${metrics.avgSatisfaction}%` }
    ];

    axesRows.forEach(row => {
      const isTotal = row.num === '★';
      const bg = isTotal ? 'FEF08A' : 'FFFFFF';
      const color = isTotal ? '854D0E' : '1E293B';
      const stRow = (align = 'center', bold = false) => ({
        fill: { fgColor: { rgb: bg } },
        font: { name: 'Segoe UI', sz: isTotal ? 10 : 9.5, bold: bold || isTotal, color: { rgb: color } },
        alignment: { horizontal: align, vertical: 'center' },
        border: borderThin
      });

      const grade = parseFloat(row.avg) >= 4.5 ? 'ممتاز' : (parseFloat(row.avg) >= 3.8 ? 'جيد جداً' : 'جيد');

      setC(ws2, curR, 0, row.num, 's', stRow('center', true));
      mergeC(ws2, merges2, curR, 1, curR, 2, row.name, 's', stRow('right', true));
      setC(ws2, curR, 3, `${row.avg} / 5`, 's', stRow('center', true));
      setC(ws2, curR, 4, row.pct, 's', stRow('center', true));
      mergeC(ws2, merges2, curR, 5, curR, 6, grade, 's', stRow('center', true));
      curR++;
    });

    curR += 1;

    // Section 3: Star Rating Distribution
    mergeC(ws2, merges2, curR, 0, curR, 6, '3. التوزيع التكراري لمستويات التقييم العام (النجوم)', 's', stGroupGold);
    curR++;

    mergeC(ws2, merges2, curR, 0, curR, 0, 'المستوى', 's', stHeader);
    mergeC(ws2, merges2, curR, 1, curR, 2, 'التقدير والنجوم', 's', stHeader);
    setC(ws2, curR, 3, 'عدد المشاركين', 's', stHeader);
    setC(ws2, curR, 4, 'النسبة المئوية', 's', stHeader);
    mergeC(ws2, merges2, curR, 5, curR, 6, 'التمثيل البياني الإحصائي', 's', stHeader);
    curR++;

    const starData = [
      { level: 5, label: 'ممتاز', stars: '⭐⭐⭐⭐⭐ (5 نجوم)', count: metrics.ratingDist[5], color: 'DCFCE7', text: '14532D' },
      { level: 4, label: 'جيد جداً', stars: '⭐⭐⭐⭐ (4 نجوم)', count: metrics.ratingDist[4], color: 'F0FDF4', text: '166534' },
      { level: 3, label: 'جيد', stars: '⭐⭐⭐ (3 نجوم)', count: metrics.ratingDist[3], color: 'FEF9C3', text: '854D0E' },
      { level: 2, label: 'مقبول', stars: '⭐⭐ (نجمتان)', count: metrics.ratingDist[2], color: 'FEE2E2', text: '991B1B' },
      { level: 1, label: 'يحتاج تطوير', stars: '⭐ (نجمة واحدة)', count: metrics.ratingDist[1], color: 'FEE2E2', text: '991B1B' }
    ];

    starData.forEach(item => {
      const pct = Math.round((item.count / metrics.total) * 100);
      const bar = '█'.repeat(Math.min(20, Math.round(pct / 5)));
      const stStar = {
        fill: { fgColor: { rgb: item.color } },
        font: { name: 'Segoe UI', sz: 9.5, bold: true, color: { rgb: item.text } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: borderThin
      };
      const stNorm = (align = 'center') => ({
        fill: { fgColor: { rgb: 'FFFFFF' } },
        font: { name: 'Segoe UI', sz: 9.5, color: { rgb: '1E293B' } },
        alignment: { horizontal: align, vertical: 'center' },
        border: borderThin
      });

      setC(ws2, curR, 0, item.level, 'n', stStar);
      mergeC(ws2, merges2, curR, 1, curR, 2, item.stars, 's', stNorm('right'));
      setC(ws2, curR, 3, item.count, 'n', stNorm('center'));
      setC(ws2, curR, 4, `${pct}%`, 's', stNorm('center'));
      mergeC(ws2, merges2, curR, 5, curR, 6, bar, 's', { ...stNorm('right'), font: { color: { rgb: item.text }, sz: 8 } });
      curR++;
    });

    curR += 1;

    // Section 4: Provinces Breakdown
    mergeC(ws2, merges2, curR, 0, curR, 6, '4. التوزيع الجغرافي للمشاركين حسب المحافظات والإقامة', 's', stGroupMain);
    curR++;

    mergeC(ws2, merges2, curR, 0, curR, 0, 'ت', 's', stHeader);
    mergeC(ws2, merges2, curR, 1, curR, 2, 'المحافظة أو بلد الإقامة', 's', stHeader);
    setC(ws2, curR, 3, 'عدد المشاركين', 's', stHeader);
    setC(ws2, curR, 4, 'النسبة المئوية', 's', stHeader);
    mergeC(ws2, merges2, curR, 5, curR, 6, 'الترتيب التنازلي', 's', stHeader);
    curR++;

    metrics.provincesList.slice(0, 10).forEach((p, idx) => {
      const stNorm = (align = 'center', bold = false) => ({
        fill: { fgColor: { rgb: idx % 2 === 1 ? 'F8FAFC' : 'FFFFFF' } },
        font: { name: 'Segoe UI', sz: 9.5, bold: bold, color: { rgb: '1E293B' } },
        alignment: { horizontal: align, vertical: 'center' },
        border: borderThin
      });

      setC(ws2, curR, 0, idx + 1, 'n', stNorm('center', true));
      mergeC(ws2, merges2, curR, 1, curR, 2, p.prov, 's', stNorm('right', true));
      setC(ws2, curR, 3, p.count, 'n', stNorm('center', true));
      setC(ws2, curR, 4, `${p.pct}%`, 's', stNorm('center'));
      mergeC(ws2, merges2, curR, 5, curR, 6, idx === 0 ? 'الأعلى مشاركة ★' : `المرتبة ${idx + 1}`, 's', stNorm('center'));
      curR++;
    });

    // Set dimensions and RTL for Sheet 2
    ws2['!merges'] = merges2;
    ws2['!views'] = [{ RTL: true }];
    ws2['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: curR + 1, c: 6 } });
    ws2['!cols'] = [
      { wch: 8 },   // A
      { wch: 18 },  // B
      { wch: 22 },  // C
      { wch: 18 },  // D
      { wch: 16 },  // E
      { wch: 16 },  // F
      { wch: 16 }   // G
    ];

    XLSX.utils.book_append_sheet(wb, ws2, 'لوحة المؤشرات والإحصائيات');
  }

  // Trigger File Download
  const dateStamp = now.toISOString().slice(0, 10);
  const fileName = `تقرير_استبيان_قسم_الشؤون_الدينية_العتبة_الحسينية_${dateStamp}.xlsx`;
  XLSX.writeFile(wb, fileName);

  showToast('تم تصدير ملف إكسل الحديث (.xlsx) بنجاح مع ورقة التحليل والتنسيق الكامل!', 'success');
}

// -------------------------------------------------------------
// 2. STYLED HTML/XML SPREADSHEET (.xls) (OFFICIAL SHRINE THEME)
// -------------------------------------------------------------
function exportToStyledExcel(customOptions = {}) {
  const options = {
    sortBy: 'date_desc',
    scope: 'all',
    ...customOptions
  };

  const rawList = getFilteredResponsesForExport(options.scope);
  if (rawList.length === 0) {
    showToast('لا توجد بيانات متاحة للتصدير حالياً.', 'error');
    return;
  }

  const list = getSortedResponses(rawList, options.sortBy);
  const metrics = calculateExportMetrics(list);
  const now = new Date();
  const exportDateStr = now.toLocaleDateString('ar-IQ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const exportTimeStr = now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });

  let html = `
  <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <!--[if gte mso 9]>
    <xml>
      <x:ExcelWorkbook>
        <x:ExcelWorksheets>
          <x:ExcelWorksheet>
            <x:Name>نتائج الاستبيان المنسقة</x:Name>
            <x:WorksheetOptions>
              <x:DisplayRightToLeft/>
              <x:Print>
                <x:ValidPrinterInfo/>
                <x:Orientation>Landscape</x:Orientation>
              </x:Print>
            </x:WorksheetOptions>
          </x:ExcelWorksheet>
        </x:ExcelWorksheets>
      </x:ExcelWorkbook>
    </xml>
    <![endif]-->
    <style>
      body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; text-align: right; }
      table { border-collapse: collapse; width: 100%; direction: rtl; }
      
      .banner-shrine {
        background-color: #0A4D34;
        color: #FFFFFF;
        font-size: 15pt;
        font-weight: bold;
        text-align: center;
        height: 46px;
        border: 2px solid #05261B;
      }
      .banner-dept {
        background-color: #05261B;
        color: #FEF08A;
        font-size: 12pt;
        font-weight: bold;
        text-align: center;
        height: 36px;
        border-bottom: 2px solid #C59B27;
      }
      .banner-sub {
        background-color: #F8FAFC;
        color: #334155;
        font-size: 9.5pt;
        text-align: center;
        height: 26px;
        border-bottom: 1px solid #CBD5E1;
      }

      .kpi-title {
        background-color: #F1F5F9;
        font-size: 9.5pt;
        font-weight: bold;
        color: #0A4D34;
        text-align: center;
        border: 1px solid #CBD5E1;
        height: 26px;
      }
      .kpi-val {
        background-color: #FFFFFF;
        font-size: 13pt;
        font-weight: bold;
        color: #0F172A;
        text-align: center;
        border: 1px solid #CBD5E1;
        height: 34px;
      }

      .th-group-main {
        background-color: #0A4D34;
        color: #FFFFFF;
        font-weight: bold;
        font-size: 10.5pt;
        text-align: center;
        border: 1px solid #05261B;
        height: 32px;
      }
      .th-group-gold {
        background-color: #C59B27;
        color: #03140E;
        font-weight: bold;
        font-size: 10.5pt;
        text-align: center;
        border: 1px solid #9A7B1C;
        height: 32px;
      }

      .th-header {
        background-color: #0F3D2E;
        color: #FFFFFF;
        font-weight: bold;
        font-size: 9.5pt;
        text-align: center;
        vertical-align: middle;
        border: 1px solid #05261B;
        height: 40px;
        white-space: normal;
      }

      .td-regular {
        border: 1px solid #CBD5E1;
        font-size: 9.5pt;
        text-align: center;
        vertical-align: middle;
        height: 28px;
        background-color: #FFFFFF;
        mso-number-format: "\\@";
      }
      .td-alt {
        border: 1px solid #CBD5E1;
        font-size: 9.5pt;
        text-align: center;
        vertical-align: middle;
        height: 28px;
        background-color: #F8FAFC;
        mso-number-format: "\\@";
      }
      .td-align-right {
        text-align: right;
        padding-right: 8px;
      }
      .td-rating-5 {
        background-color: #DCFCE7;
        color: #14532D;
        font-weight: bold;
        border: 1px solid #CBD5E1;
        text-align: center;
      }
      .td-rating-4 {
        background-color: #F0FDF4;
        color: #166534;
        font-weight: bold;
        border: 1px solid #CBD5E1;
        text-align: center;
      }
      .td-rating-3 {
        background-color: #FEF9C3;
        color: #854D0E;
        font-weight: bold;
        border: 1px solid #CBD5E1;
        text-align: center;
      }
      .td-rating-low {
        background-color: #FEE2E2;
        color: #991B1B;
        font-weight: bold;
        border: 1px solid #CBD5E1;
        text-align: center;
      }
      .td-axis-avg {
        background-color: #ECFDF5;
        color: #065F46;
        font-weight: bold;
        border: 1px solid #CBD5E1;
        text-align: center;
      }
      .td-badge-reg {
        background-color: #EFF6FF;
        color: #1D4ED8;
        font-weight: bold;
      }
      .td-badge-guest {
        background-color: #F8FAFC;
        color: #475569;
      }
      .td-overall {
        background-color: #FEF08A;
        color: #854D0E;
        font-weight: bold;
        font-size: 10pt;
        border: 1px solid #CBD5E1;
        text-align: center;
      }
      .td-summary-title {
        background-color: #C59B27;
        color: #03140E;
        font-weight: bold;
        font-size: 10.5pt;
        text-align: center;
        border: 2px solid #9A7B1C;
        height: 32px;
      }
      .td-summary-val {
        background-color: #FEF3C7;
        color: #854D0E;
        font-weight: bold;
        font-size: 10pt;
        text-align: center;
        border: 2px solid #9A7B1C;
      }
    </style>
  </head>
  <body dir="rtl">
    <table>
      <!-- Official Header Banner -->
      <tr>
        <th colspan="23" class="banner-shrine">الأمانة العامة للعتبة الحسينية المقدسة</th>
      </tr>
      <tr>
        <th colspan="23" class="banner-dept">قسم الشؤون الدينية | التقرير الإحصائي لنتائج استبيان قياس رضا الزائرين الكرام</th>
      </tr>
      <tr>
        <td colspan="23" class="banner-sub">تاريخ استخراج التقرير: ${exportDateStr} - الساعة: ${exportTimeStr} | إجمالي السجلات المصدرة: ${metrics.total}</td>
      </tr>
      <tr><td colspan="23" style="height:10px;"></td></tr>

      <!-- KPI Summary Cards Row -->
      <tr>
        <td colspan="4" class="kpi-title">إجمالي المشاركات المستلمة</td>
        <td colspan="4" class="kpi-title">معدل الرضا العام الإجمالي</td>
        <td colspan="4" class="kpi-title">مشاركات بحسابات مسجلة</td>
        <td colspan="4" class="kpi-title">مشاركات كزائر (بدون حساب)</td>
        <td colspan="4" class="kpi-title">المقترحات والملاحظات المكتوبة</td>
        <td colspan="3" class="kpi-title">المحافظة الأكثر تفاعلاً</td>
      </tr>
      <tr>
        <td colspan="4" class="kpi-val" style="color:#0A4D34;">${metrics.total}</td>
        <td colspan="4" class="kpi-val" style="color:#C59B27;">${metrics.avgSatisfaction}%</td>
        <td colspan="4" class="kpi-val" style="color:#0284C7;">${metrics.regCount}</td>
        <td colspan="4" class="kpi-val" style="color:#64748B;">${metrics.guestCount}</td>
        <td colspan="4" class="kpi-val" style="color:#D97706;">${metrics.suggCount}</td>
        <td colspan="3" class="kpi-val" style="color:#0F172A; font-size:11pt;">${metrics.topProvince}</td>
      </tr>
      <tr><td colspan="23" style="height:12px;"></td></tr>

      <!-- Multi-header Grouping -->
      <tr>
        <th colspan="8" class="th-group-main">بيانات المشارك الأساسية والزيارة</th>
        <th colspan="4" class="th-group-main">المحور الأول: المنبر والمحاضرات</th>
        <th colspan="4" class="th-group-main">المحور الثاني: الاستفتاءات الشرعية</th>
        <th colspan="4" class="th-group-main">المحور الثالث: الدورات والإصدارات</th>
        <th colspan="3" class="th-group-gold">التقييم العام والمقترحات</th>
      </tr>

      <!-- Column Headers -->
      <tr>
        <th class="th-header" style="width:40px;">ت</th>
        <th class="th-header" style="width:85px;">رقم الاستبيان</th>
        <th class="th-header" style="width:130px;">تاريخ المشاركة</th>
        <th class="th-header" style="width:160px;">اسم المشارك الكريم</th>
        <th class="th-header" style="width:115px;">نوع الحساب</th>
        <th class="th-header" style="width:120px;">المحافظة / الإقامة</th>
        <th class="th-header" style="width:100px;">الفئة العمرية</th>
        <th class="th-header" style="width:120px;">معدل الزيارة</th>

        <th class="th-header" style="width:120px;">مواضيع المحاضرات</th>
        <th class="th-header" style="width:120px;">توقيت ومكان المحاضرات</th>
        <th class="th-header" style="width:120px;">كفاءة الخطباء</th>
        <th class="th-header" style="width:100px; background-color:#0A4D34;">متوسط المنبر</th>

        <th class="th-header" style="width:120px;">محطات الاستفتاءات</th>
        <th class="th-header" style="width:120px;">رحابة صدر المشايخ</th>
        <th class="th-header" style="width:120px;">الاستفتاءات الإلكترونية</th>
        <th class="th-header" style="width:100px; background-color:#0A4D34;">متوسط الاستفتاءات</th>

        <th class="th-header" style="width:120px;">دورات الشباب والفتية</th>
        <th class="th-header" style="width:120px;">جودة الإصدارات</th>
        <th class="th-header" style="width:120px;">المحتوى الرقمي</th>
        <th class="th-header" style="width:100px; background-color:#0A4D34;">متوسط الدورات</th>

        <th class="th-header" style="width:130px; background-color:#C59B27; color:#03140E;">التقييم الإجمالي للقسم</th>
        <th class="th-header" style="width:120px;">توصية الآخرين</th>
        <th class="th-header" style="width:260px;">مقترحات وملاحظات المشارك</th>
      </tr>
  `;

  // Render Rows
  list.forEach((r, idx) => {
    const isAlt = idx % 2 === 1;
    const baseClass = isAlt ? 'td-alt' : 'td-regular';

    const getRatClass = (val) => {
      const n = parseInt(val, 10);
      if (n === 5) return 'td-rating-5';
      if (n === 4) return 'td-rating-4';
      if (n === 3) return 'td-rating-3';
      return 'td-rating-low';
    };

    const m1_topics = r.ratings?.q_minbar_topics || 0;
    const m1_timing = r.ratings?.q_minbar_timing || 0;
    const m1_scholars = r.ratings?.q_minbar_scholars || 0;
    const avgM1 = ((m1_topics + m1_timing + m1_scholars) / 3).toFixed(1);

    const m2_access = r.ratings?.q_fatwa_access || 0;
    const m2_clarity = r.ratings?.q_fatwa_clarity || 0;
    const m2_online = r.ratings?.q_fatwa_online || 0;
    const avgM2 = ((m2_access + m2_clarity + m2_online) / 3).toFixed(1);

    const m3_courses = r.ratings?.q_courses_youth || 0;
    const m3_pub = r.ratings?.q_pub_quality || 0;
    const m3_digital = r.ratings?.q_digital_content || 0;
    const avgM3 = ((m3_courses + m3_pub + m3_digital) / 3).toFixed(1);

    const userBadgeCell = r.isRegistered
      ? `<td class="${baseClass} td-badge-reg">حساب مسجل</td>`
      : `<td class="${baseClass} td-badge-guest">زائر بدون حساب</td>`;

    html += `
      <tr>
        <td class="${baseClass}" style="font-weight:bold; color:#64748B;">${idx + 1}</td>
        <td class="${baseClass}" style="font-weight:bold; color:#0A4D34;">${r.id}</td>
        <td class="${baseClass}" style="color:#64748B;">${r.displayDate || (r.timestamp ? r.timestamp.slice(0, 16) : '-')}</td>
        <td class="${baseClass} td-align-right" style="font-weight:bold; color:#1E293B;">${escapeHtml(r.participantName)}</td>
        ${userBadgeCell}
        <td class="${baseClass}">${escapeHtml(r.province)}</td>
        <td class="${baseClass}">${escapeHtml(r.ageGroup || '-')}</td>
        <td class="${baseClass}">${escapeHtml(r.visitFrequency || '-')}</td>

        <td class="${getRatClass(m1_topics)}">${getRatingLabel(m1_topics)}</td>
        <td class="${getRatClass(m1_timing)}">${getRatingLabel(m1_timing)}</td>
        <td class="${getRatClass(m1_scholars)}">${getRatingLabel(m1_scholars)}</td>
        <td class="td-axis-avg">${avgM1}</td>

        <td class="${getRatClass(m2_access)}">${getRatingLabel(m2_access)}</td>
        <td class="${getRatClass(m2_clarity)}">${getRatingLabel(m2_clarity)}</td>
        <td class="${getRatClass(m2_online)}">${getRatingLabel(m2_online)}</td>
        <td class="td-axis-avg">${avgM2}</td>

        <td class="${getRatClass(m3_courses)}">${getRatingLabel(m3_courses)}</td>
        <td class="${getRatClass(m3_pub)}">${getRatingLabel(m3_pub)}</td>
        <td class="${getRatClass(m3_digital)}">${getRatingLabel(m3_digital)}</td>
        <td class="td-axis-avg">${avgM3}</td>

        <td class="td-overall">${getRatingLabel(r.ratings?.q_overall_rating)}</td>
        <td class="${baseClass}">${escapeHtml(r.recommend || '-')}</td>
        <td class="${baseClass} td-align-right" style="color:#334155;">${escapeHtml(r.suggestions || '-')}</td>
      </tr>
    `;
  });

  // Calculate Averages for Summary Row
  const getColAvgStr = (key) => (list.reduce((acc, r) => acc + (r.ratings?.[key] || 0), 0) / list.length).toFixed(2);

  html += `
      <!-- Bottom Summary Row -->
      <tr>
        <td colspan="8" class="td-summary-title">المتوسط الحسابي العام للمحاور (من 5):</td>
        <td class="td-summary-val">${getColAvgStr('q_minbar_topics')}</td>
        <td class="td-summary-val">${getColAvgStr('q_minbar_timing')}</td>
        <td class="td-summary-val">${getColAvgStr('q_minbar_scholars')}</td>
        <td class="td-summary-val" style="background-color:#FDE68A;">${metrics.avgAxis1}</td>

        <td class="td-summary-val">${getColAvgStr('q_fatwa_access')}</td>
        <td class="td-summary-val">${getColAvgStr('q_fatwa_clarity')}</td>
        <td class="td-summary-val">${getColAvgStr('q_fatwa_online')}</td>
        <td class="td-summary-val" style="background-color:#FDE68A;">${metrics.avgAxis2}</td>

        <td class="td-summary-val">${getColAvgStr('q_courses_youth')}</td>
        <td class="td-summary-val">${getColAvgStr('q_pub_quality')}</td>
        <td class="td-summary-val">${getColAvgStr('q_digital_content')}</td>
        <td class="td-summary-val" style="background-color:#FDE68A;">${metrics.avgAxis3}</td>

        <td class="td-summary-val" style="background-color:#FEF08A; font-size:11pt;">${metrics.avgOverall} (${metrics.avgSatisfaction}%)</td>
        <td colspan="2" class="td-summary-val">-</td>
      </tr>

      <tr><td colspan="23" style="height:15px;"></td></tr>
      <tr>
        <td colspan="23" style="text-align:center; color:#64748B; font-size:9pt; border-top: 1px solid #CBD5E1; padding: 10px;">
          جميع الحقوق محفوظة © قسم الشؤون الدينية - العتبة الحسينية المقدسة 1448 هـ | كربلاء المقدسة
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;

  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStamp = now.toISOString().slice(0, 10);
  link.setAttribute('href', url);
  link.setAttribute('download', `تقرير_استبيان_قسم_الشؤون_الدينية_المنسق_${dateStamp}.xls`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast('تم تصدير ملف الإكسل المنسق بنجاح بكامل الألوان وترويسة العتبة الحسينية!', 'success');
}

// -------------------------------------------------------------
// 3. CLEAN CSV EXPORT (UTF-8 WITH BOM FOR ARABIC EXCEL SUPPORT)
// -------------------------------------------------------------
function exportResponsesToCSV(customOptions = {}) {
  const options = {
    sortBy: 'date_desc',
    scope: 'all',
    ...customOptions
  };

  const rawList = getFilteredResponsesForExport(options.scope);
  if (rawList.length === 0) {
    showToast('لا توجد بيانات متاحة للتصدير حالياً.', 'error');
    return;
  }

  const list = getSortedResponses(rawList, options.sortBy);

  const headers = [
    'ت',
    'رقم الاستبيان',
    'تاريخ ووقت المشاركة',
    'اسم المشارك الكريم',
    'نوع الحساب',
    'المحافظة أو الإقامة',
    'الفئة العمرية',
    'معدل الزيارة',
    'مواضيع المحاضرات',
    'توقيت ومكان المحاضرات',
    'كفاءة وبلاغة الخطباء',
    'متوسط محور المنبر',
    'محطات الاستفتاءات',
    'رحابة صدر المشايخ',
    'الاستفتاءات الإلكترونية',
    'متوسط محور الاستفتاءات',
    'دورات الفتية والشباب',
    'جودة الإصدارات الدينية',
    'المحتوى الرقمي',
    'متوسط محور الدورات',
    'التقييم الإجمالي للقسم',
    'توصية الآخرين',
    'المقترحات والملاحظات'
  ];

  const rows = list.map((r, idx) => {
    const m1_topics = r.ratings?.q_minbar_topics || 0;
    const m1_timing = r.ratings?.q_minbar_timing || 0;
    const m1_scholars = r.ratings?.q_minbar_scholars || 0;
    const avgM1 = ((m1_topics + m1_timing + m1_scholars) / 3).toFixed(1);

    const m2_access = r.ratings?.q_fatwa_access || 0;
    const m2_clarity = r.ratings?.q_fatwa_clarity || 0;
    const m2_online = r.ratings?.q_fatwa_online || 0;
    const avgM2 = ((m2_access + m2_clarity + m2_online) / 3).toFixed(1);

    const m3_courses = r.ratings?.q_courses_youth || 0;
    const m3_pub = r.ratings?.q_pub_quality || 0;
    const m3_digital = r.ratings?.q_digital_content || 0;
    const avgM3 = ((m3_courses + m3_pub + m3_digital) / 3).toFixed(1);

    return [
      idx + 1,
      r.id || '',
      `"${r.displayDate || (r.timestamp ? r.timestamp.slice(0, 16) : '')}"`,
      `"${(r.participantName || '').replace(/"/g, '""')}"`,
      r.isRegistered ? 'حساب مسجل رسمي' : 'زائر بدون حساب',
      `"${(r.province || '').replace(/"/g, '""')}"`,
      `"${(r.ageGroup || '').replace(/"/g, '""')}"`,
      `"${(r.visitFrequency || '').replace(/"/g, '""')}"`,
      m1_topics,
      m1_timing,
      m1_scholars,
      avgM1,
      m2_access,
      m2_clarity,
      m2_online,
      avgM2,
      m3_courses,
      m3_pub,
      m3_digital,
      avgM3,
      r.ratings?.q_overall_rating || 0,
      `"${(r.recommend || '').replace(/"/g, '""')}"`,
      `"${(r.suggestions || '').replace(/"/g, '""')}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `نتائج_استبيان_العتبة_الحسينية_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('تم تصدير ملف البيانات (CSV) بنجاح!', 'success');
}


// ================= SEED SAMPLE DATA =================
function seedSampleData(notify = true) {
  localStorage.removeItem('shrine_survey_cleared');

  const sampleNames = [
    { name: 'سيد حيدر الموسوي', prov: 'كربلاء المقدسة', type: true },
    { name: 'علي مهدي الخفاجي', prov: 'النجف الأشرف', type: true },
    { name: 'حسين عبد الزهرة الأسدي', prov: 'البصرة', type: false },
    { name: 'كرار حميد الجبوري', prov: 'بابل', type: true },
    { name: 'أحمد شاكر الساعدي', prov: 'بغداد', type: false },
    { name: 'محمد جواد الشمري', prov: 'ذي قار', type: false },
    { name: 'مصطفى كامل العامري', prov: 'ميسان', type: true },
    { name: 'زائر كريم من الكويت', prov: 'زائر من خارج العراق', type: false }
  ];

  const sampleSuggestions = [
    'نرجو زيادة محطات الاستفتاءات الشرعية في الجهة المجاورة لباب قاضي الحاجات لتخفيف الزحام.',
    'المحاضرات الفقهية قبل صلاة الظهرين ممتازة جداً ونقترح بثها بصوت مباشر ومسجل على التلغرام.',
    'نقترح إقامة مسابقات فكرية وعقائدية أسبوعية للشباب الزائرين مع هدايا تبركية من الحرم الشريف.',
    'نشكر سماحة المشايخ في قسم الشؤون الدينية على رحابة صدرهم وحسن إرشادهم ودعواتنا لهم بالتوفيق.',
    ''
  ];

  const newItems = sampleNames.map((s, idx) => ({
    id: 'EST-' + (700100 + idx),
    timestamp: new Date(Date.now() - (idx * 3600000 * 8)).toISOString(),
    displayDate: new Date(Date.now() - (idx * 3600000 * 8)).toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }),
    userType: s.type ? 'مستخدم مسجل' : 'زائر بدون حساب',
    isRegistered: s.type,
    participantName: s.name,
    province: s.prov,
    ageGroup: ['25 - 34 سنة', '35 - 49 سنة', '18 - 24 سنة', '50 سنة فما فوق'][idx % 4],
    visitFrequency: ['أسبوعياً', 'شهرياً', 'في الزيارات المليونية فقط', 'أكثر من مرة بالأسبوع'][idx % 4],
    ratings: {
      q_minbar_topics: 4 + (idx % 2),
      q_minbar_timing: 4 + (idx % 2),
      q_minbar_scholars: 5,
      q_fatwa_access: 4,
      q_fatwa_clarity: 5,
      q_fatwa_online: 3 + (idx % 3),
      q_courses_youth: 4,
      q_pub_quality: 5,
      q_digital_content: 4,
      q_overall_rating: 4 + (idx % 2)
    },
    recommend: 'نعم بالتأكيد وبشدة',
    suggestions: sampleSuggestions[idx % sampleSuggestions.length]
  }));

  responsesData = newItems;
  saveResponses();
  if (notify) {
    renderAdminDashboard();
    showToast('تمت إضافة بيانات تجريبية بنجاح!', 'success');
  }
}

// ================= SHARE SURVEY MODAL =================
function getPublicSurveyUrl() {
  const loc = window.location;
  if (loc.protocol === 'http:' || loc.protocol === 'https:') {
    const fullUrl = new URL(loc.href);
    const pathParts = fullUrl.pathname.split('/');
    pathParts[pathParts.length - 1] = 'index.html';
    fullUrl.pathname = pathParts.join('/');
    fullUrl.search = '';
    fullUrl.hash = '';
    return fullUrl.href;
  }
  return loc.href.replace('admin.html', 'index.html');
}

function openShareModal() {
  const modal = document.getElementById('shareSurveyModal');
  const input = document.getElementById('shareUrlInput');
  const qrImg = document.getElementById('shareQrImage');

  const shareUrl = getPublicSurveyUrl();
  if (input) input.value = shareUrl;

  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}`;
  }

  if (modal) modal.classList.add('active');
}

function closeShareModal() {
  const modal = document.getElementById('shareSurveyModal');
  if (modal) modal.classList.remove('active');
}

function copyShareUrl() {
  const input = document.getElementById('shareUrlInput');
  if (!input) return;
  input.select();
  input.setSelectionRange(0, 99999);

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(input.value).then(() => {
      showToast('تم نسخ رابط الاستبيان العام بنجاح! يمكنك نشره للزائرين.', 'success');
    }).catch(() => {
      document.execCommand('copy');
      showToast('تم نسخ الرابط بنجاح!', 'success');
    });
  } else {
    document.execCommand('copy');
    showToast('تم نسخ الرابط بنجاح!', 'success');
  }
}

function shareOnWhatsApp() {
  const shareUrl = getPublicSurveyUrl();
  const text = `السلام عليكم ورحمة الله وبركاته.\nندعوكم للمشاركة في استبيان قسم الشؤون الدينية في العتبة الحسينية المقدسة لتطوير البرامج والخدمات الدينية:\n${shareUrl}`;
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
}

function shareOnTelegram() {
  const shareUrl = getPublicSurveyUrl();
  const text = `استبيان قسم الشؤون الدينية - العتبة الحسينية المقدسة:\n${shareUrl}`;
  window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`, '_blank');
}

// ================= TOASTS & UTILS =================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Backdrop modal click listener
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

// ================= ADMIN SETTINGS & SUPERVISOR MANAGEMENT =================

function openAdminSettingsModal(tab = 'list') {
  const modal = document.getElementById('adminSettingsModal');
  if (modal) {
    modal.classList.add('active');
    switchAdminSettingsTab(tab);
    loadSupervisorsList();
  }
}

function closeAdminSettingsModal() {
  const modal = document.getElementById('adminSettingsModal');
  if (modal) modal.classList.remove('active');
}

function switchAdminSettingsTab(tabName) {
  // 1. Update tab buttons
  const btnList = document.getElementById('tabBtnSupervisorsList');
  const btnAdd = document.getElementById('tabBtnAddSupervisor');
  const btnPass = document.getElementById('tabBtnChangeMyPassword');

  if (btnList) btnList.classList.toggle('active', tabName === 'list');
  if (btnAdd) btnAdd.classList.toggle('active', tabName === 'add');
  if (btnPass) btnPass.classList.toggle('active', tabName === 'password');

  // 2. Update tab panes
  const paneList = document.getElementById('tabPaneSupervisorsList');
  const paneAdd = document.getElementById('tabPaneAddSupervisor');
  const panePass = document.getElementById('tabPaneChangePassword');

  if (paneList) paneList.classList.toggle('active', tabName === 'list');
  if (paneAdd) paneAdd.classList.toggle('active', tabName === 'add');
  if (panePass) panePass.classList.toggle('active', tabName === 'password');

  // If opening add tab directly and not in edit mode, reset form
  if (tabName === 'add') {
    const mode = document.getElementById('editSupervisorMode');
    if (!mode || mode.value !== 'edit') {
      resetSupervisorForm();
    }
  }
}

async function loadSupervisorsList() {
  try {
    const res = await fetch(getApiUrl('admins_get'), { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        supervisorsList = data;
        localStorage.setItem(STORAGE_KEYS.SUPERVISORS_CACHE, JSON.stringify(supervisorsList));
      }
    }
  } catch (err) {
    // Read from cache if offline
    try {
      const c = localStorage.getItem(STORAGE_KEYS.SUPERVISORS_CACHE);
      if (c) supervisorsList = JSON.parse(c);
    } catch (e) {}
  }

  if (!Array.isArray(supervisorsList) || supervisorsList.length === 0) {
    supervisorsList = [DEFAULT_ADMIN];
  }

  const badge = document.getElementById('supervisorsCountBadge');
  if (badge) badge.textContent = supervisorsList.length;

  renderSupervisorsTable();
}

function renderSupervisorsTable() {
  const tbody = document.getElementById('supervisorsTableBody');
  if (!tbody) return;

  if (supervisorsList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; padding:2rem; color:#94a3b8;">
          <i class="fa-solid fa-users-slash" style="font-size:2rem; margin-bottom:0.5rem; display:block;"></i>
          لا توجد حسابات مشرفين مسجلة حالياً
        </td>
      </tr>
    `;
    return;
  }

  let currentProfile = DEFAULT_ADMIN;
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.ADMIN_USER_PROFILE);
    if (saved) currentProfile = JSON.parse(saved);
  } catch (e) {}
  const currentUsername = (currentProfile.username || 'admin').toLowerCase();

  tbody.innerHTML = supervisorsList.map(adm => {
    const isPrimaryAdmin = (adm.username || '').toLowerCase() === 'admin';
    const isCurrentActive = (adm.username || '').toLowerCase() === currentUsername;
    const roleIsAdmin = (adm.role || '').toUpperCase() === 'ADMIN';

    const roleBadgeHtml = roleIsAdmin
      ? `<span class="supervisor-badge-role supervisor-badge-admin"><i class="fa-solid fa-shield-halved"></i> مشرف عام</span>`
      : `<span class="supervisor-badge-role supervisor-badge-supervisor"><i class="fa-solid fa-user-check"></i> مشرف متابعة</span>`;

    const initials = (adm.fullName || adm.username || 'م').trim().substring(0, 1);

    const activeUserTag = isCurrentActive
      ? `<span style="font-size:0.72rem; background:#dcfce7; color:#15803d; border:1px solid #86efac; border-radius:4px; padding:0.1rem 0.4rem; margin-right:6px; font-weight:700;">حسابك الحالي</span>`
      : '';

    return `
      <tr>
        <td>
          <div class="supervisor-user-cell">
            <div class="supervisor-avatar">${escapeHtml(initials)}</div>
            <div>
              <div style="font-weight:700; color:#0f172a; font-size:0.92rem;">
                ${escapeHtml(adm.fullName || 'مشرف')}
                ${activeUserTag}
              </div>
              <div style="font-size:0.75rem; color:#64748b;">
                تاريخ الإنشاء: ${escapeHtml(adm.createdAt || 'حساب أصلي')}
              </div>
            </div>
          </div>
        </td>
        <td>
          <code style="background:#f1f5f9; padding:0.2rem 0.5rem; border-radius:5px; font-size:0.85rem; color:#0a4d34; font-weight:700;">
            <i class="fa-solid fa-at" style="color:#94a3b8; font-size:0.78rem;"></i> ${escapeHtml(adm.username)}
          </code>
        </td>
        <td>${roleBadgeHtml}</td>
        <td>
          <span style="font-size:0.85rem; color:#334155;">
            <i class="fa-solid fa-location-dot" style="color:var(--gold); font-size:0.8rem;"></i> ${escapeHtml(adm.province || 'كربلاء المقدسة')}
          </span>
        </td>
        <td style="text-align:center; white-space:nowrap;">
          <button type="button" class="btn btn-outline btn-sm btn-action-edit"
            onclick="openEditSupervisor('${escapeHtml(adm.username)}')"
            title="تعديل بيانات المشرف" style="padding:0.25rem 0.6rem; font-size:0.78rem; margin-left:4px;">
            <i class="fa-solid fa-user-pen"></i> تعديل
          </button>
          <button type="button" class="btn btn-outline btn-sm"
            onclick="quickResetPassword('${escapeHtml(adm.username)}', '${escapeHtml(adm.fullName)}')"
            title="تعيين كلمة مرور جديدة لهذا المشرف" style="background:#f8fafc; border-color:#cbd5e1; color:#0f172a; padding:0.25rem 0.6rem; font-size:0.78rem; margin-left:4px;">
            <i class="fa-solid fa-key" style="color:var(--gold);"></i> كلمة المرور
          </button>
          ${isPrimaryAdmin ? `
            <button type="button" class="btn btn-outline btn-sm" disabled
              title="لا يمكن حذف الحساب الرئيسي الافتراضي للنظام"
              style="opacity:0.4; cursor:not-allowed; padding:0.25rem 0.6rem; font-size:0.78rem;">
              <i class="fa-solid fa-ban"></i> محمي
            </button>
          ` : `
            <button type="button" class="btn btn-outline btn-sm btn-action-delete"
              onclick="deleteSupervisor('${escapeHtml(adm.username)}', '${escapeHtml(adm.fullName)}')"
              title="حذف هذا المشرف من النظام" style="padding:0.25rem 0.6rem; font-size:0.78rem;">
              <i class="fa-solid fa-trash-can"></i> حذف
            </button>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

function resetSupervisorForm() {
  const mode = document.getElementById('editSupervisorMode');
  if (mode) mode.value = 'create';

  const title = document.getElementById('supervisorFormTitle');
  const sub = document.getElementById('supervisorFormSubtitle');
  if (title) title.innerHTML = '<i class="fa-solid fa-user-plus" style="color:var(--gold);"></i> إنشاء حساب مشرف جديد';
  if (sub) sub.textContent = 'قم بتعبئة بيانات المشرف لتخويله بالدخول إلى لوحة الإدارة ومتابعة النتائج';

  const userInp = document.getElementById('newAdminUsername');
  const nameInp = document.getElementById('newAdminFullName');
  const roleInp = document.getElementById('newAdminRole');
  const provInp = document.getElementById('newAdminProvince');
  const passInp = document.getElementById('newAdminPassword');
  const confInp = document.getElementById('newAdminConfirmPassword');

  if (userInp) { userInp.value = ''; userInp.readOnly = false; }
  if (nameInp) nameInp.value = '';
  if (roleInp) roleInp.value = 'SUPERVISOR';
  if (provInp) provInp.value = 'كافة المحافظات';
  if (passInp) passInp.value = '';
  if (confInp) confInp.value = '';

  const star = document.getElementById('passwordRequiredStar');
  const note = document.getElementById('passwordOptionalNote');
  if (star) star.style.display = 'inline';
  if (note) note.style.display = 'none';

  const btnSave = document.getElementById('btnSaveSupervisor');
  if (btnSave) btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ الحساب في السحابة';
}

function openEditSupervisor(username) {
  const adm = supervisorsList.find(a => (a.username || '').toLowerCase() === username.toLowerCase());
  if (!adm) {
    showToast('لم يتم العثور على بيانات المشرف المطلوب.', 'error');
    return;
  }

  const mode = document.getElementById('editSupervisorMode');
  if (mode) mode.value = 'edit';

  const title = document.getElementById('supervisorFormTitle');
  const sub = document.getElementById('supervisorFormSubtitle');
  if (title) title.innerHTML = `<i class="fa-solid fa-user-pen" style="color:var(--gold);"></i> تعديل حساب المشرف: (${escapeHtml(adm.username)})`;
  if (sub) sub.textContent = 'يمكنك تعديل الاسم أو الرتبة أو المحافظة، وتعيين كلمة مرور جديدة إذا أردت';

  const userInp = document.getElementById('newAdminUsername');
  const nameInp = document.getElementById('newAdminFullName');
  const roleInp = document.getElementById('newAdminRole');
  const provInp = document.getElementById('newAdminProvince');
  const passInp = document.getElementById('newAdminPassword');
  const confInp = document.getElementById('newAdminConfirmPassword');

  if (userInp) { userInp.value = adm.username; userInp.readOnly = true; }
  if (nameInp) nameInp.value = adm.fullName || '';
  if (roleInp) roleInp.value = adm.role || 'SUPERVISOR';
  if (provInp) provInp.value = adm.province || 'كربلاء المقدسة';
  if (passInp) passInp.value = '';
  if (confInp) confInp.value = '';

  const star = document.getElementById('passwordRequiredStar');
  const note = document.getElementById('passwordOptionalNote');
  if (star) star.style.display = 'none';
  if (note) note.style.display = 'inline';

  const btnSave = document.getElementById('btnSaveSupervisor');
  if (btnSave) btnSave.innerHTML = '<i class="fa-solid fa-check-double"></i> حفظ التعديلات في السحابة';

  switchAdminSettingsTab('add');
}

function cancelSupervisorEdit() {
  resetSupervisorForm();
  switchAdminSettingsTab('list');
}

async function handleSupervisorFormSubmit(e) {
  e.preventDefault();
  const mode = document.getElementById('editSupervisorMode').value;
  const username = document.getElementById('newAdminUsername').value.trim();
  const fullName = document.getElementById('newAdminFullName').value.trim();
  const role = document.getElementById('newAdminRole').value;
  const province = document.getElementById('newAdminProvince').value;
  const password = document.getElementById('newAdminPassword').value;
  const confirmPass = document.getElementById('newAdminConfirmPassword').value;

  if (!username) {
    showToast('يرجى كتابة اسم المستخدم للمشرف.', 'error');
    return;
  }

  if (mode === 'create') {
    if (!password) {
      showToast('يرجى تحديد كلمة المرور للمشرف الجديد.', 'error');
      return;
    }
    if (password.length < 4) {
      showToast('كلمة المرور يجب ألا تقل عن 4 خانات.', 'error');
      return;
    }
    if (password !== confirmPass) {
      showToast('كلمتا المرور غير متطابقتين. يرجى إعادة التأكد.', 'error');
      return;
    }

    const saveBtn = document.getElementById('btnSaveSupervisor');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الإنشاء...'; }

    try {
      const res = await fetch(getApiUrl('admin_create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, fullName, role, province })
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data && data.status === 'success') {
        showToast(data.message || 'تم إنشاء حساب المشرف بنجاح وتوثيقه في السحابة!', 'success');
        resetSupervisorForm();
        await loadSupervisorsList();
        switchAdminSettingsTab('list');
      } else {
        const msg = (data && data.message) ? data.message : 'تعذر إنشاء حساب المشرف. تأكد من عدم تكرار اسم المستخدم.';
        showToast(msg, 'error');
      }
    } catch (err) {
      showToast('حدث خطأ في الاتصال بالسيرفر السحابي.', 'error');
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ الحساب في السحابة'; }
    }
  } else {
    // Edit mode
    if (password && password.length < 4) {
      showToast('كلمة المرور الجديدة يجب ألا تقل عن 4 خانات.', 'error');
      return;
    }
    if (password && password !== confirmPass) {
      showToast('كلمتا المرور غير متطابقتين.', 'error');
      return;
    }

    const payload = { username, fullName, role, province };
    if (password) payload.password = password;

    const saveBtn = document.getElementById('btnSaveSupervisor');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...'; }

    try {
      const res = await fetch(getApiUrl('admin_update'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data && data.status === 'success') {
        showToast(data.message || 'تم تحديث حساب المشرف بنجاح!', 'success');
        resetSupervisorForm();
        await loadSupervisorsList();
        switchAdminSettingsTab('list');

        // If updated the currently logged in user, refresh their status badge
        let currentProfile = DEFAULT_ADMIN;
        try {
          const saved = localStorage.getItem(STORAGE_KEYS.ADMIN_USER_PROFILE);
          if (saved) currentProfile = JSON.parse(saved);
        } catch (e) {}

        if ((currentProfile.username || '').toLowerCase() === username.toLowerCase()) {
          currentProfile.fullName = fullName;
          currentProfile.role = role;
          currentProfile.province = province;
          localStorage.setItem(STORAGE_KEYS.ADMIN_USER_PROFILE, JSON.stringify(currentProfile));
          checkAdminAuth();
        }
      } else {
        const msg = (data && data.message) ? data.message : 'تعذر تحديث بيانات المشرف.';
        showToast(msg, 'error');
      }
    } catch (err) {
      showToast('حدث خطأ في الاتصال بالسيرفر السحابي.', 'error');
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> حفظ التعديلات في السحابة'; }
    }
  }
}

async function handleChangeMyPasswordSubmit(e) {
  e.preventDefault();
  const oldPassword = document.getElementById('myOldPasswordInput').value;
  const newPassword = document.getElementById('myNewPasswordInput').value;
  const confirmPassword = document.getElementById('myConfirmPasswordInput').value;

  if (!oldPassword || !newPassword) {
    showToast('يرجى ملء جميع حقول كلمة المرور.', 'error');
    return;
  }

  if (newPassword.length < 4) {
    showToast('كلمة المرور الجديدة يجب ألا تقل عن 4 خانات.', 'error');
    return;
  }

  if (newPassword !== confirmPassword) {
    showToast('كلمة المرور الجديدة وتأكيدها غير متطابقين.', 'error');
    return;
  }

  let currentProfile = DEFAULT_ADMIN;
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.ADMIN_USER_PROFILE);
    if (saved) currentProfile = JSON.parse(saved);
  } catch (err) {}
  const username = currentProfile.username || 'admin';

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحديث...'; }

  try {
    const res = await fetch(getApiUrl('admin_change_password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, oldPassword, newPassword })
    });
    const data = await res.json().catch(() => null);

    if (res.ok && data && data.status === 'success') {
      showToast('تم تغيير كلمة المرور بنجاح وحفظها في السحابة!', 'success');
      document.getElementById('myOldPasswordInput').value = '';
      document.getElementById('myNewPasswordInput').value = '';
      document.getElementById('myConfirmPasswordInput').value = '';
      await loadSupervisorsList();
    } else {
      const msg = (data && data.message) ? data.message : 'تعذر تغيير كلمة المرور. تأكد من صحة كلمة المرور الحالية.';
      showToast(msg, 'error');
    }
  } catch (err) {
    showToast('حدث خطأ في الاتصال بالسيرفر السحابي.', 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-lock"></i> تحديث كلمة المرور الآن'; }
  }
}

async function quickResetPassword(username, fullName) {
  const newPassword = prompt(`تعيين كلمة مرور جديدة للمشرف (${fullName} - ${username}):\n\nأدخل كلمة المرور الجديدة (4 خانات على الأقل):`);
  if (newPassword === null) return; // User cancelled

  const cleanPass = newPassword.trim();
  if (cleanPass.length < 4) {
    showToast('كلمة المرور يجب ألا تقل عن 4 خانات.', 'error');
    return;
  }

  try {
    const res = await fetch(getApiUrl('admin_change_password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, newPassword: cleanPass })
    });
    const data = await res.json().catch(() => null);

    if (res.ok && data && data.status === 'success') {
      showToast(`تم تعيين كلمة المرور الجديدة للمشرف (${fullName}) بنجاح!`, 'success');
      await loadSupervisorsList();
    } else {
      const msg = (data && data.message) ? data.message : 'تعذر تغيير كلمة المرور.';
      showToast(msg, 'error');
    }
  } catch (err) {
    showToast('حدث خطأ في الاتصال بالسيرفر السحابي.', 'error');
  }
}

async function deleteSupervisor(username, fullName) {
  if (username.toLowerCase() === 'admin') {
    showToast('لا يمكن حذف حساب المشرف العام الرئيسي الافتراضي للنظام.', 'warning');
    return;
  }

  let currentProfile = DEFAULT_ADMIN;
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.ADMIN_USER_PROFILE);
    if (saved) currentProfile = JSON.parse(saved);
  } catch (e) {}

  if ((currentProfile.username || '').toLowerCase() === username.toLowerCase()) {
    showToast('لا يمكنك حذف الحساب النشط الذي قمت بتسجيل الدخول به حالياً.', 'warning');
    return;
  }

  if (!confirm(`هل أنت متأكد من رغبتك بحذف حساب المشرف:\n\n(${fullName} - ${username})؟\n\nلن يتمكن هذا المشرف من الدخول إلى لوحة الإدارة بعد الآن.`)) {
    return;
  }

  try {
    const res = await fetch(getApiUrl('admin_delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json().catch(() => null);

    if (res.ok && data && data.status === 'success') {
      showToast(`تم حذف حساب المشرف (${fullName}) بنجاح من السحابة.`, 'success');
      await loadSupervisorsList();
    } else {
      const msg = (data && data.message) ? data.message : 'تعذر حذف حساب المشرف.';
      showToast(msg, 'error');
    }
  } catch (err) {
    showToast('حدث خطأ في الاتصال بالسيرفر السحابي.', 'error');
  }
}

function togglePasswordVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (!input) return;

  if (input.type === 'password') {
    input.type = 'text';
    if (icon) {
      icon.classList.remove('fa-eye');
      icon.classList.add('fa-eye-slash');
    }
  } else {
    input.type = 'password';
    if (icon) {
      icon.classList.remove('fa-eye-slash');
      icon.classList.add('fa-eye');
    }
  }
}
