/* ==========================================================================
   PVHP Platform — Frontend Logic
   Runs against a built-in mock backend (localStorage) by default so the
   demo works immediately. Set USE_MOCK_BACKEND = false and provide a
   BACKEND_URL to connect to the real Google Apps Script backend.
   ========================================================================== */

'use strict';

/* ------------------------- Backend configuration ------------------------ */
var USE_MOCK_BACKEND = true; // flip to false to use the real Apps Script backend
var BACKEND_URL = '';        // e.g. 'https://script.google.com/macros/s/XXXX/exec'

/* ------------------------------ State keys ------------------------------ */
var LS_USERS = 'pvhp_users';
var LS_BENEFICIARIES = 'pvhp_beneficiaries';
var LS_INSTITUTIONS = 'pvhp_institutions';
var LS_ACTIVITIES = 'pvhp_activities';
var LS_SESSION = 'pvhp_session';

/* ------------------------- Helpers: DOM shortcuts ----------------------- */
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

/* ------------------------------ Toast ----------------------------------- */
var toastTimer = null;
function toast(msg, type) {
  var t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type || 'info');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    t.className = 'toast';
    t.hidden = true;
  }, 3500);
}

/* --------------------------- Mock persistence --------------------------- */
function lsGet(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ------------------------- Directory helpers ---------------------------- */
function getDivisions() { return DIRECTORY.map(function (d) { return d.name; }); }
function getDistricts(division) {
  var d = DIRECTORY.find(function (x) { return x.name === division; });
  return d ? d.districts.map(function (x) { return x.name; }) : [];
}
function getUpazilas(division, district) {
  var d = DIRECTORY.find(function (x) { return x.name === division; });
  if (!d) return [];
  var dist = d.districts.find(function (x) { return x.name === district; });
  return dist ? dist.upazilas : [];
}

function fillDivisionSelect(sel, includeAll) {
  var html = includeAll ? '<option value="">All Divisions</option>' : '<option value="">Select division...</option>';
  getDivisions().forEach(function (d) { html += '<option>' + d + '</option>'; });
  sel.innerHTML = html;
}
function fillDistrict(divSel, distId, includeAll) {
  var dist = document.getElementById(distId);
  var html = includeAll ? '<option value="">All Districts</option>' : '<option value="">Select district...</option>';
  getDistricts(divSel.value).forEach(function (d) { html += '<option>' + d + '</option>'; });
  dist.innerHTML = html;
  if (includeAll) renderDirectory();
}
function fillUpazila(distSel, upazId, includeAll) {
  var upaz = document.getElementById(upazId);
  if (!upaz) return;
  var html = includeAll ? '<option value="">All Upazilas</option>' : '<option value="">Select upazila...</option>';
  var divSel = distSel.parentElement ? null : null;
  // derive division from the district's sibling form selects
  getUpazilasFor(distSel).forEach(function (u) { html += '<option>' + u + '</option>'; });
  upaz.innerHTML = html;
}
function getUpazilasFor(distSel) {
  // Find the division select that precedes this district select in the same form
  var form = distSel.closest('form');
  var divSel = null;
  if (form) {
    var name = distSel.name;
    divSel = form.querySelector('select[name="division"]');
  }
  var div = divSel ? divSel.value : '';
  return getUpazilas(div, distSel.value);
}

/* ---------------------------- Auth / session ---------------------------- */
function currentUser() { return lsGet(LS_SESSION, null); }
function setSession(user) { lsSet(LS_SESSION, user); updateNav(); }
function logout() {
  localStorage.removeItem(LS_SESSION);
  updateNav();
  toast('Logged out.', 'info');
}
function updateNav() {
  var user = currentUser();
  var chip = $('#userChip'), name = $('#userChipName');
  var login = $('#navLoginBtn'), signup = $('#navSignupBtn');
  chip.hidden = false;
  name.textContent = 'Demo Admin (admin)';
  login.hidden = true;
  signup.hidden = true;
}

function openAuthModal(mode) {
  var m = $('#authModal');
  m.hidden = false;
  $('#authForm').reset();
  fillDivisionSelect($('#authDivision'));
  $('#authDistrict').innerHTML = '<option value="">Select district...</option>';
  $('#authUpazila').innerHTML = '<option value="">Select upazila...</option>';
  setAuthMode(mode);
}
function closeAuthModal() { $('#authModal').hidden = true; }
function setAuthMode(mode) {
  var isSignup = mode === 'signup';
  $('#authSignupFields').hidden = !isSignup;
  $('#authTitle').textContent = isSignup ? 'Create Account' : 'Login';
  $('#authSubtitle').textContent = isSignup
    ? 'Register as a focal officer or administrator.'
    : 'Sign in with your mobile number and password.';
  $('#authSubmit').textContent = isSignup ? 'Create Account' : 'Login';
  $('#authSwitch').innerHTML = isSignup
    ? 'Already have an account? <a href="#" onclick="openAuthModal(\'login\');return false;">Login</a>'
    : 'Need an account? <a href="#" onclick="openAuthModal(\'signup\');return false;">Sign up</a>';
}

function handleAuth(e) {
  e.preventDefault();
  var f = e.target;
  var data = new FormData(f);
  var mode = $('#authTitle').textContent === 'Login' ? 'login' : 'signup';
  var mobile = String(data.get('mobile') || '').trim();
  var password = data.get('password') || '';
  var users = lsGet(LS_USERS, []);

  if (mode === 'signup') {
    var name = String(data.get('name') || '').trim();
    var role = data.get('role');
    if (!name || !role) { toast('Please fill all fields.', 'error'); return; }
    var existing = users.find(function (u) { return u.mobile === mobile; });
    if (existing) { toast('An account with this mobile already exists.', 'error'); return; }
    var user = {
      id: 'U' + Date.now(),
      name: name,
      role: role,
      division: data.get('division') || '',
      district: data.get('district') || '',
      upazila: role === 'CHO' ? (data.get('upazila') || '') : '',
      mobile: mobile,
      password: password,
      approved: role === 'admin' ? true : false,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    lsSet(LS_USERS, users);
    if (role === 'admin') {
      setSession(user);
      toast('Welcome, ' + name + '!', 'success');
      closeAuthModal();
    } else {
      toast('Account created. Awaiting Head Office approval.', 'success');
      closeAuthModal();
    }
  } else {
    var user = users.find(function (u) { return u.mobile === mobile && u.password === password; });
    if (!user) { toast('Invalid credentials.', 'error'); return; }
    if (!user.approved) { toast('Account not yet approved by Head Office.', 'error'); return; }
    setSession(user);
    toast('Welcome, ' + user.name + '!', 'success');
    closeAuthModal();
  }
}

/* --------------------------- Directory render --------------------------- */
var dirDivisionFilter = '';
function onDirDivisionChange() {
  dirDivisionFilter = $('#dirDivision').value;
  fillDistrict($('#dirDivision'), 'dirDistrict', true);
  renderDirectory();
}
function renderDirectory() {
  var q = ($('#dirSearch').value || '').toLowerCase().trim();
  var division = $('#dirDivision').value;
  var district = $('#dirDistrict').value;
  var role = $('#dirRole').value;

  var rows = OFFICERS.filter(function (o) {
    if (division && o.division !== division) return false;
    if (district && o.district !== district) return false;
    if (role && o.role !== role) return false;
    if (q) {
      var hay = (o.name + ' ' + o.district + ' ' + o.id + ' ' + o.division + ' ' + o.upazila).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  var tbody = $('#dirTbody');
  tbody.innerHTML = '';
  rows.forEach(function (o) {
    var tr = el('tr');
    tr.appendChild(el('td', 'mono', '#' + o.id));
    tr.appendChild(el('td', '', o.role));
    tr.appendChild(el('td', 'strong', o.name));
    tr.appendChild(el('td', '', o.division));
    tr.appendChild(el('td', '', o.district));
    tr.appendChild(el('td', '', o.upazila || '—'));
    var contact = el('td');
    contact.appendChild(el('div', 'muted', o.email));
    contact.appendChild(el('div', 'mono', '0' + o.mobile));
    tr.appendChild(contact);
    tbody.appendChild(tr);
  });
  $('#dirCount').textContent = rows.length + ' focal officer(s) found.';
}

/* --------------------------- Beneficiaries ------------------------------ */
function getBeneficiaries() { return lsGet(LS_BENEFICIARIES, []); }
function submitBeneficiary(e) {
  e.preventDefault();
  var f = e.target;
  var data = new FormData(f);
  var user = currentUser();
  var rec = {
    id: 'B' + Date.now(),
    name: data.get('name'),
    gender: data.get('gender'),
    age: data.get('age'),
    phone: data.get('phone'),
    division: data.get('division'),
    district: data.get('district'),
    upazila: data.get('upazila'),
    category: data.get('category'),
    details: data.get('details'),
    registeredBy: user ? user.name : 'Public',
    registeredByRole: user ? user.role : 'public',
    status: 'Pending Review',
    date: new Date().toISOString()
  };
  var list = getBeneficiaries();
  list.unshift(rec);
  lsSet(LS_BENEFICIARIES, list);
  renderBeneficiaries();
  renderReports();
  renderHeroStats();
  f.reset();
  toast('Beneficiary registered successfully.', 'success');
}
function renderBeneficiaries() {
  var list = getBeneficiaries();
  var box = $('#benList');
  box.innerHTML = '';
  $('#benCount').textContent = list.length;
  if (!list.length) { box.appendChild(el('p', 'muted', 'No beneficiaries registered yet.')); return; }
  list.forEach(function (b) {
    var item = el('div', 'list-item');
    item.appendChild(el('div', 'list-item-head', b.name + ' · ' + b.category));
    item.appendChild(el('div', 'muted', b.division + ' / ' + b.district + (b.upazila ? ' / ' + b.upazila : '')));
    item.appendChild(el('div', 'list-item-meta', 'Age ' + b.age + ' · ' + b.gender + ' · ' + b.status));
    box.appendChild(item);
  });
}

/* ---------------------------- Institutions ------------------------------ */
function getInstitutions() { return lsGet(LS_INSTITUTIONS, []); }
function submitInstitution(e) {
  e.preventDefault();
  var f = e.target;
  var data = new FormData(f);
  var user = currentUser();
  var rec = {
    id: 'I' + Date.now(),
    name: data.get('name'),
    type: data.get('type'),
    division: data.get('division'),
    district: data.get('district'),
    upazila: data.get('upazila'),
    contact: data.get('contact'),
    phone: data.get('phone'),
    capacity: data.get('capacity'),
    addedBy: user ? user.name : 'Public',
    date: new Date().toISOString()
  };
  var list = getInstitutions();
  list.unshift(rec);
  lsSet(LS_INSTITUTIONS, list);
  renderInstitutions();
  renderReports();
  renderHeroStats();
  f.reset();
  toast('Institution added.', 'success');
}
function renderInstitutions() {
  var list = getInstitutions();
  var box = $('#instList');
  box.innerHTML = '';
  $('#instCount').textContent = list.length;
  if (!list.length) { box.appendChild(el('p', 'muted', 'No institutions registered yet.')); return; }
  list.forEach(function (i) {
    var item = el('div', 'list-item');
    item.appendChild(el('div', 'list-item-head', i.name));
    item.appendChild(el('div', 'muted', i.type + ' · ' + i.district + (i.upazila ? ' / ' + i.upazila : '')));
    item.appendChild(el('div', 'list-item-meta', (i.contact || 'No contact') + (i.phone ? ' · 0' + i.phone : '')));
    box.appendChild(item);
  });
}

/* ----------------------------- Activities ------------------------------- */
function getActivities() { return lsGet(LS_ACTIVITIES, []); }
function submitActivity(e) {
  e.preventDefault();
  var f = e.target;
  var data = new FormData(f);
  var user = currentUser();
  var rec = {
    id: 'A' + Date.now(),
    title: data.get('title'),
    type: data.get('type'),
    date: data.get('date'),
    participants: data.get('participants'),
    division: data.get('division'),
    district: data.get('district'),
    upazila: data.get('upazila'),
    details: data.get('details'),
    reportedBy: user ? user.name : 'Public',
    dateAdded: new Date().toISOString()
  };
  var list = getActivities();
  list.unshift(rec);
  lsSet(LS_ACTIVITIES, list);
  renderActivities();
  renderReports();
  renderHeroStats();
  f.reset();
  toast('Activity logged.', 'success');
}
function renderActivities() {
  var list = getActivities();
  var box = $('#actList');
  box.innerHTML = '';
  $('#actCount').textContent = list.length;
  if (!list.length) { box.appendChild(el('p', 'muted', 'No activities reported yet.')); return; }
  list.forEach(function (a) {
    var item = el('div', 'list-item');
    item.appendChild(el('div', 'list-item-head', a.title));
    item.appendChild(el('div', 'muted', a.type + ' · ' + a.district + (a.upazila ? ' / ' + a.upazila : '')));
    item.appendChild(el('div', 'list-item-meta', a.date + ' · ' + (a.participants || 0) + ' participants'));
    box.appendChild(item);
  });
}

/* ------------------------------ Reports --------------------------------- */
function renderReports() {
  var bens = getBeneficiaries(), insts = getInstitutions(), acts = getActivities();
  var cards = [
    { label: 'Total Beneficiaries', value: bens.length, icon: '👦' },
    { label: 'Institutions', value: insts.length, icon: '🏠' },
    { label: 'Activities', value: acts.length, icon: '📊' },
    { label: 'Divisions Covered', value: Object.keys(groupByDivision(acts)).length || 1, icon: '🌏' }
  ];
  $('#reportCards').innerHTML = '';
  cards.forEach(function (c) {
    var card = el('div', 'report-card');
    card.appendChild(el('div', 'report-icon', c.icon));
    card.appendChild(el('strong', 'report-value', String(c.value)));
    card.appendChild(el('span', 'report-label', c.label));
    $('#reportCards').appendChild(card);
  });

  // Division breakdown
  var tbody = $('#reportTbody');
  tbody.innerHTML = '';
  var divs = getDivisions();
  divs.forEach(function (d) {
    var tr = el('tr');
    tr.appendChild(el('td', 'strong', d));
    tr.appendChild(el('td', '', String(bens.filter(function (b) { return b.division === d; }).length)));
    tr.appendChild(el('td', '', String(insts.filter(function (i) { return i.division === d; }).length)));
    tr.appendChild(el('td', '', String(acts.filter(function (a) { return a.division === d; }).length)));
    tbody.appendChild(tr);
  });
}
function groupByDivision(arr) {
  var out = {};
  arr.forEach(function (x) { if (x.division) out[x.division] = (out[x.division] || 0) + 1; });
  return out;
}

/* ------------------------- Hero stat counters --------------------------- */
function renderHeroStats() {
  var divs = getDivisions().length;
  var dists = DIRECTORY.reduce(function (n, d) { return n + d.districts.length; }, 0);
  var ups = DIRECTORY.reduce(function (n, d) {
    return n + d.districts.reduce(function (m, x) { return m + x.upazilas.length; }, 0);
  }, 0);
  $('#statDivisions').textContent = divs;
  $('#statDistricts').textContent = dists;
  $('#statUpazilas').textContent = ups;
  $('#statFocals').textContent = OFFICERS.length;
  $('#statBeneficiaries').textContent = getBeneficiaries().length;
  $('#statInstitutions').textContent = getInstitutions().length;
  $('#statActivities').textContent = getActivities().length;
}

/* ------------------------------ Navigation ------------------------------ */
function setupNav() {
  var toggle = $('#navToggle');
  var links = $('#navLinks');
  toggle.addEventListener('click', function () { links.classList.toggle('open'); });
  $all('.nav-links a').forEach(function (a) {
    a.addEventListener('click', function () { links.classList.remove('open'); });
  });
  // Sticky shadow on scroll
  var nav = $('#navbar');
  window.addEventListener('scroll', function () {
    nav.classList.toggle('scrolled', window.scrollY > 10);
  });
}

/* -------------------------------- Init ---------------------------------- */
var DEMO_CREDENTIALS = {
  // For demo use only — delete these lines before any real deployment.
  // Sign up as: mobile 01700000000 / password admin123 (Head Office Admin)
  demoMobile: '01700000000',
  demoPassword: 'admin123'
};
function init() {
  setupNav();
  $('#year').textContent = new Date().getFullYear();

  // Seed a demo admin account if none exists yet (for quick local demos).
  if (!localStorage.getItem(LS_SESSION)) {
    var users = lsGet(LS_USERS, []);
    if (!users.length) {
      users.push({
        id: 'Udemo',
        name: 'Demo Admin',
        role: 'admin',
        division: '',
        district: '',
        upazila: '',
        mobile: DEMO_CREDENTIALS.demoMobile,
        password: DEMO_CREDENTIALS.demoPassword,
        approved: true,
        createdAt: new Date().toISOString()
      });
      lsSet(LS_USERS, users);
    }
  }

  // Populate directory filters
  fillDivisionSelect($('#dirDivision'), true);
  $('#dirDistrict').innerHTML = '<option value="">All Districts</option>';
  fillDivisionSelect($('#benDivision'));
  fillDivisionSelect($('#instDivision'));
  fillDivisionSelect($('#actDivision'));
  fillDivisionSelect($('#authDivision'));

  renderDirectory();
  renderBeneficiaries();
  renderInstitutions();
  renderActivities();
  renderReports();
  renderHeroStats();
  updateNav();
}

document.addEventListener('DOMContentLoaded', init);
