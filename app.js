/**
 * استبيان العتبة الحسينية المقدسة - قسم الشؤون الدينية
 * واجهة المستجيب والزائر - App JS
 */

// ================= STORAGE KEYS =================
const STORAGE_KEYS = {
  RESPONSES: 'shrine_survey_responses_v1',
  USERS: 'shrine_survey_users_v1',
  CURRENT_USER: 'shrine_survey_current_user_v1',
  OFFLINE_QUEUE: 'shrine_survey_offline_queue_v1'
};

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

// ================= STATE =================
let currentUser = null;
let responsesData = [];

// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', () => {
  initDateDisplay();
  loadCurrentUser();
  initFormWithUserData();
  flushOfflineQueue();
});

window.addEventListener('online', () => {
  flushOfflineQueue();
});

// ================= DATE DISPLAY =================
function initDateDisplay() {
  const dateEl = document.getElementById('currentDateHijri');
  if (dateEl) {
    const today = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = today.toLocaleDateString('ar-IQ', options);
    dateEl.textContent = `كربلاء المقدسة | ${dateStr}`;
  }
}

// ================= USER STATE & UI =================
function loadCurrentUser() {
  const saved = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
    } catch (e) {
      currentUser = null;
    }
  }
  updateUserUI();
}

function updateUserUI() {
  const userStatusPill = document.getElementById('userStatusPill');
  const userStatusText = document.getElementById('userStatusText');
  const btnNavAuth = document.getElementById('btnNavAuth');
  const btnNavLogout = document.getElementById('btnNavLogout');
  const modeTitle = document.getElementById('modeTitle');
  const modeDesc = document.getElementById('modeDesc');
  const modeActions = document.querySelector('.mode-actions');
  const participantNameInput = document.getElementById('participantName');
  const participantProvinceSelect = document.getElementById('participantProvince');

  if (currentUser) {
    if (userStatusText) userStatusText.innerHTML = `<strong>أهلاً بك:</strong> ${escapeHtml(currentUser.fullName)}`;
    if (userStatusPill) userStatusPill.style.background = 'rgba(21, 128, 61, 0.3)';
    if (btnNavAuth) btnNavAuth.style.display = 'none';
    if (btnNavLogout) btnNavLogout.style.display = 'inline-flex';

    if (modeTitle && modeDesc) {
      modeTitle.textContent = `أهلاً بك، أخي المؤمن (${currentUser.fullName})`;
      modeDesc.textContent = `تم تسجيل دخولك بنجاح، سيتم ربط مشاركتك المباركة بحسابك المسجل.`;
    }

    if (modeActions) {
      modeActions.innerHTML = `
        <button type="button" class="btn btn-outline btn-sm" onclick="logoutUser()" style="color: #ef4444; border-color: #fca5a5; background: #fff;" title="الخروج من الحساب والمشاركة كزائر عام">
          <i class="fa-solid fa-arrow-rotate-left"></i> تصفير الحساب والعودة كزائر
        </button>
      `;
    }

    if (participantNameInput && !participantNameInput.value) {
      participantNameInput.value = currentUser.fullName;
    }
    if (participantProvinceSelect && currentUser.province) {
      participantProvinceSelect.value = currentUser.province;
    }
  } else {
    if (userStatusText) userStatusText.innerHTML = `المشاركة: كزائر (بدون حساب)`;
    if (userStatusPill) userStatusPill.style.background = 'rgba(255, 255, 255, 0.12)';
    if (btnNavAuth) btnNavAuth.style.display = 'inline-flex';
    if (btnNavLogout) btnNavLogout.style.display = 'none';

    if (modeTitle && modeDesc) {
      modeTitle.textContent = 'وضع المشاركة: متاح للجميع كزائر أو بحساب مسجل';
      modeDesc.textContent = 'يمكنك تعبئة الاستبيان مباشرة كزائر كريم دون الحاجة لإنشاء حساب، أو تسجيل الدخول لحفظ بياناتك.';
    }

    if (modeActions) {
      modeActions.innerHTML = `
        <button type="button" class="btn btn-outline btn-sm" id="btnToggleAuthMode" onclick="openAuthModal('register')">
          <i class="fa-solid fa-user-plus"></i> إنشاء حساب جديد
        </button>
        <button type="button" class="btn btn-outline btn-sm" id="btnLoginDirect" onclick="openAuthModal('login')">
          <i class="fa-solid fa-right-to-bracket"></i> تسجيل الدخول
        </button>
      `;
    }
  }
}

function initFormWithUserData() {
  if (currentUser) {
    const nameInput = document.getElementById('participantName');
    const provSelect = document.getElementById('participantProvince');
    if (nameInput) nameInput.value = currentUser.fullName || '';
    if (provSelect && currentUser.province) provSelect.value = currentUser.province;
  }
}

// ================= AUTH MODAL (Visitors & Users) =================
function openAuthModal(defaultTab = 'login') {
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.add('active');
    switchAuthTab(defaultTab);
  }
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.remove('active');
}

function switchAuthTab(tab) {
  const loginTabBtn = document.getElementById('tabBtnLogin');
  const regTabBtn = document.getElementById('tabBtnRegister');
  const loginPanel = document.getElementById('loginPanel');
  const regPanel = document.getElementById('registerPanel');
  const headerTitle = document.getElementById('authModalHeaderTitle');

  if (tab === 'login') {
    loginTabBtn.classList.add('active');
    regTabBtn.classList.remove('active');
    loginPanel.classList.add('active');
    regPanel.classList.remove('active');
    if (headerTitle) headerTitle.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> تسجيل الدخول';
  } else {
    regTabBtn.classList.add('active');
    loginTabBtn.classList.remove('active');
    regPanel.classList.add('active');
    loginPanel.classList.remove('active');
    if (headerTitle) headerTitle.innerHTML = '<i class="fa-solid fa-user-plus"></i> إنشاء حساب جديد للمشارك';
  }
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const identifier = document.getElementById('loginIdentifier').value.trim();
  const password = document.getElementById('loginPassword').value;

  const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
  const user = users.find(u => 
    (u.username.toLowerCase() === identifier.toLowerCase() || (u.email && u.email.toLowerCase() === identifier.toLowerCase())) &&
    u.password === password
  );

  if (user) {
    currentUser = user;
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
    updateUserUI();
    initFormWithUserData();
    closeAuthModal();
    showToast(`مرحباً بكم يا ${user.fullName}، تم تسجيل دخولكم بنجاح.`, 'success');
  } else {
    showToast('بيانات الدخول غير صحيحة. يرجى التأكد أو إنشاء حساب جديد.', 'error');
  }
}

function handleRegisterSubmit(e) {
  e.preventDefault();
  const fullName = document.getElementById('regFullName').value.trim();
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const province = document.getElementById('regProvince').value;
  const password = document.getElementById('regPassword').value;

  const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');

  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    showToast('عذراً، اسم المستخدم هذا محجوز مسبقاً. يرجى اختيار اسم آخر.', 'error');
    return;
  }

  const newUser = {
    username,
    fullName,
    email,
    province,
    password,
    role: 'USER',
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));

  currentUser = newUser;
  localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
  updateUserUI();
  initFormWithUserData();
  closeAuthModal();
  showToast(`تم إنشاء حسابك بنجاح! أهلاً بك يا ${fullName}`, 'success');
}

// Reset / Logout Account
function logoutUser() {
  currentUser = null;
  localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);

  // Clear fields
  const nameInput = document.getElementById('participantName');
  if (nameInput) nameInput.value = '';

  const provSelect = document.getElementById('participantProvince');
  if (provSelect) provSelect.selectedIndex = 0;

  const form = document.getElementById('surveyForm');
  if (form) form.reset();

  updateUserUI();
  showToast('تم تصفير الحساب والعودة للوضع كزائر بنجاح.', 'info');
}

// ================= OFFLINE QUEUE SYNC =================
async function flushOfflineQueue() {
  let queue = [];
  try {
    queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE) || '[]');
  } catch (e) { queue = []; }

  if (!queue.length) return;

  const remaining = [];
  for (const item of queue) {
    try {
      const res = await fetch(getApiUrl('submit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      if (!res.ok) {
        remaining.push(item);
      }
    } catch (e) {
      remaining.push(item);
    }
  }

  localStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(remaining));
  if (queue.length > remaining.length) {
    console.log(`[Offline Sync] تم بنجاح ترحيل ${queue.length - remaining.length} مشاركة مؤجلة إلى السيرفر السحابي.`);
  }
}

// ================= RESPONSES SUBMISSION =================
async function handleSurveySubmit(e) {
  e.preventDefault();

  const form = document.getElementById('surveyForm');
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const btnSubmit = form.querySelector('button[type="submit"]');
  const originalBtnHtml = btnSubmit ? btnSubmit.innerHTML : '';
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري حفظ وتوثيق الاستبيان في السيرفر...';
  }

  const formData = new FormData(form);

  const participantName = document.getElementById('participantName').value.trim() || 
                          (currentUser ? currentUser.fullName : 'زائر كريم بدون اسم');
  const province = document.getElementById('participantProvince').value;
  const ageGroup = formData.get('ageGroup') || 'غير محدد';
  const visitFrequency = formData.get('visitFrequency') || 'غير محدد';

  const ratings = {
    q_minbar_topics: parseInt(formData.get('q_minbar_topics') || '5', 10),
    q_minbar_timing: parseInt(formData.get('q_minbar_timing') || '5', 10),
    q_minbar_scholars: parseInt(formData.get('q_minbar_scholars') || '5', 10),
    q_fatwa_access: parseInt(formData.get('q_fatwa_access') || '5', 10),
    q_fatwa_clarity: parseInt(formData.get('q_fatwa_clarity') || '5', 10),
    q_fatwa_online: parseInt(formData.get('q_fatwa_online') || '5', 10),
    q_courses_youth: parseInt(formData.get('q_courses_youth') || '5', 10),
    q_pub_quality: parseInt(formData.get('q_pub_quality') || '5', 10),
    q_digital_content: parseInt(formData.get('q_digital_content') || '5', 10),
    q_overall_rating: parseInt(formData.get('q_overall_rating') || '5', 10)
  };

  const recommend = formData.get('q_recommend') || formData.get('recommend') || '';
  const suggestions = (document.getElementById('q_suggestions')?.value || document.getElementById('surveySuggestions')?.value || '').trim();

  const newResponse = {
    id: 'EST-' + Math.floor(100000 + Math.random() * 900000),
    timestamp: new Date().toISOString(),
    displayDate: new Date().toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }),
    userType: currentUser ? 'مستخدم مسجل' : 'زائر بدون حساب',
    isRegistered: !!currentUser,
    participantName,
    province,
    ageGroup,
    visitFrequency,
    ratings,
    recommend,
    suggestions
  };

  // 1. Save to local storage on respondent device
  let currentList = [];
  try {
    currentList = JSON.parse(localStorage.getItem(STORAGE_KEYS.RESPONSES) || '[]');
  } catch (err) {
    currentList = [];
  }
  currentList.unshift(newResponse);
  localStorage.setItem(STORAGE_KEYS.RESPONSES, JSON.stringify(currentList));
  localStorage.removeItem('shrine_survey_cleared');

  // 2. Persist to Server Backend API (api.php)
  let serverSaved = false;
  let serverStatusMessage = '';

  try {
    const apiUrl = getApiUrl('submit');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(newResponse)
    });

    if (response.ok) {
      const resData = await response.json();
      if (resData && (resData.status === 'success' || resData.id)) {
        serverSaved = true;
        console.log('[Cloud API] تم الحفظ بنجاح في قاعدة بيانات السيرفر:', resData);
      } else {
        serverStatusMessage = resData.message || 'استجابة غير معتادة من السيرفر';
      }
    } else {
      try {
        const errData = await response.json();
        serverStatusMessage = errData.message || `خطأ ${response.status}`;
      } catch (e) {
        serverStatusMessage = `رمز الخطأ: ${response.status}`;
      }
    }
  } catch (networkErr) {
    serverStatusMessage = networkErr.message || 'تعذر الاتصال بالخادم';
  }

  // 3. Fallback: If immediate server save failed, queue for automatic retry
  if (!serverSaved) {
    console.warn('[Offline Queue] تعذر الحفظ الفوري، تمت إضافة المشاركة لقائمة المزامنة التلقائية:', serverStatusMessage);
    let queue = [];
    try {
      queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE) || '[]');
    } catch (e) { queue = []; }
    queue.push(newResponse);
    localStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue));

    showToast(`تنبيه: تم حفظ الاستبيان محلياً بجهازك، وسيتم ربطه بالسيرفر تلقائياً عند توفر الاتصال. (${serverStatusMessage})`, 'warning');
  } else {
    showToast('تقبل الله أعمالكم وزيارتكم.. تم إرسال الاستبيان وتوثيقه في قاعدة بيانات السيرفر بنجاح!', 'success');
  }

  // 4. Form reset and restore button
  if (btnSubmit) {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = originalBtnHtml;
  }

  form.reset();

  if (currentUser) {
    initFormWithUserData();
  } else {
    document.getElementById('participantName').value = '';
    document.getElementById('participantProvince').selectedIndex = 0;
  }

  setTimeout(() => {
    if (serverSaved) {
      alert('جزاكم الله خير الجزاء!\n\nتقبل الله أعمالكم وطاعاتكم وزيارتكم، تم توثيق مشاركتكم المباركة بنجاح ووصلت لإدارة قسم الشؤون الدينية في العتبة الحسينية المقدسة.\n\nنسأل الله لكم التوفيق وقضاء الحوائج.');
    } else {
      alert('⚠️ تنبيه حول حالة الإرسال:\n\nتم حفظ إجابتك مؤقتاً داخل هذا الجهاز فقط، لكنها لم تصل إلى سيرفر الإدارة بعد (لأن الموقع يعمل بوضع غير متصل أو لم يتم رفعه على استضافة تدعم السيرفر السحابي).\n\nسبب عدم الوصول: ' + serverStatusMessage);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 250);
}

// ================= SHARE SURVEY MODAL =================
function getSurveyShareUrl() {
  const loc = window.location;
  if (loc.protocol === 'http:' || loc.protocol === 'https:') {
    const fullUrl = new URL(loc.href);
    // Ensure it targets index.html in the current folder, without losing subfolder path
    const pathParts = fullUrl.pathname.split('/');
    pathParts[pathParts.length - 1] = 'index.html';
    fullUrl.pathname = pathParts.join('/');
    return fullUrl.origin + fullUrl.pathname;
  }
  return loc.href;
}

function openShareModal() {
  const modal = document.getElementById('shareSurveyModal');
  const input = document.getElementById('shareUrlInput');
  const qrImg = document.getElementById('shareQrImage');

  const shareUrl = getSurveyShareUrl();
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
      showToast('تم نسخ رابط الاستبيان بنجاح! يمكنك إرساله للزائرين.', 'success');
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
  const shareUrl = getSurveyShareUrl();
  const text = `السلام عليكم ورحمة الله وبركاته.\nندعوكم للمشاركة في استبيان قسم الشؤون الدينية في العتبة الحسينية المقدسة لتطوير البرامج والخدمات الدينية:\n${shareUrl}`;
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
}

function shareOnTelegram() {
  const shareUrl = getSurveyShareUrl();
  const text = `استبيان قسم الشؤون الدينية - العتبة الحسينية المقدسة:\n${shareUrl}`;
  window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`, '_blank');
}

// ================= TOAST NOTIFICATIONS =================
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

// Close modals when clicking backdrop
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});
