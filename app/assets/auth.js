'use strict';

const strings = {
  'zh-CN': {
    brand: '客户反馈工作台', company: '贝翰战略咨询', language: '界面语言',
    login: '登录', loginTitle: '登录工作台', loginIntro: '使用已获批的账户访问客户反馈项目。',
    register: '提交注册申请', registerTitle: '申请账户', registerIntro: '填写账户信息，待管理员批准后即可登录。',
    username: '用户名', password: '密码', show: '显示', hide: '隐藏',
    usernameHint: '3–40 个字符，可使用字母、数字、点、短横线和下划线，以字母或数字开头。',
    passwordHint: '8–128 个字符。', noAccount: '首次使用？', hasAccount: '已有账户？', backToLogin: '返回登录',
    signingIn: '正在登录…', registering: '正在提交…', pendingSuccess: '注册申请已提交。管理员批准后，请使用刚才的用户名和密码登录。',
    requiredUsername: '请输入用户名。', requiredPassword: '请输入密码。',
    approval: '注册审批', adminIntro: '批准申请后，用户即可登录工作台。', pending: '待审批', refresh: '刷新',
    back: '返回工作台', logout: '退出登录', requested: '申请时间', action: '操作', approve: '批准',
    loading: '正在加载申请…', empty: '目前没有待审批的注册申请。', approvedMessage: '已批准 {name} 的注册申请。',
    pending_approval: '此账户正在等待管理员审批，获批后即可登录。', invalid_credentials: '用户名或密码不正确。',
    username_taken: '此用户名已被使用，请选择其他用户名。', invalid_username: '用户名格式不符合要求，请按提示修改。',
    invalid_password: '密码长度须为 8–128 个字符。', login_required: '请重新登录。', admin_required: '管理注册申请需要管理员权限。',
    request_blocked: '请求被拒绝，请刷新页面后重试。', invalid_request: '请核对输入后重试。', rate_limited: '尝试次数较多，请稍后重试。',
    account_rejected: '此账户的注册申请未获批准。', user_not_found: '找不到此账户，请刷新列表。',
    already_rejected: '该申请已被拒绝，请刷新列表。', server_error: '服务暂时无法处理请求，请稍后重试。',
    connection_error: '无法连接账户服务。请从运行中的工作台服务打开此页面，然后重试。'
  },
  en: {
    brand: 'Customer Feedback Workspace', company: 'Beihan Strategy Consulting', language: 'Display language',
    login: 'Sign in', loginTitle: 'Sign in to your workspace', loginIntro: 'Use your approved account to access feedback projects.',
    register: 'Request access', registerTitle: 'Create an account', registerIntro: 'Submit your details. You can sign in once an administrator approves your request.',
    username: 'Username', password: 'Password', show: 'Show', hide: 'Hide',
    usernameHint: 'Use 3–40 letters, numbers, periods, hyphens or underscores. Start with a letter or number.',
    passwordHint: 'Use 8–128 characters.', noAccount: 'New to the workspace?', hasAccount: 'Already have an account?', backToLogin: 'Sign in',
    signingIn: 'Signing in…', registering: 'Submitting…', pendingSuccess: 'Request submitted. Once an administrator approves it, sign in with your username and password.',
    requiredUsername: 'Enter your username.', requiredPassword: 'Enter your password.',
    approval: 'Account approvals', adminIntro: 'Approved users can sign in to the workspace.', pending: 'Pending requests', refresh: 'Refresh',
    back: 'Back to workspace', logout: 'Sign out', requested: 'Requested', action: 'Action', approve: 'Approve',
    loading: 'Loading requests…', empty: 'There are no pending registration requests.', approvedMessage: 'Approved the request for {name}.',
    pending_approval: 'Your account is awaiting administrator approval. You can sign in once it is approved.', invalid_credentials: 'Incorrect username or password.',
    username_taken: 'This username is already in use. Choose another one.', invalid_username: 'Check your username against the requirements.',
    invalid_password: 'Use a password with 8–128 characters.', login_required: 'Please sign in again.', admin_required: 'An administrator account is required to manage requests.',
    request_blocked: 'The request was refused. Refresh this page and try again.', invalid_request: 'Check your entries and try again.', rate_limited: 'Too many attempts. Try again later.',
    account_rejected: 'The registration request for this account was declined.', user_not_found: 'This account could not be found. Refresh the list.',
    already_rejected: 'This request was already declined. Refresh the list.', server_error: 'The service could not process the request. Try again later.',
    connection_error: 'Cannot reach the account service. Open this page from the running workspace server and try again.'
  }
};

const localeKey = 'customer-feedback-locale';
const adminPage = document.body.dataset.screen === 'admin';
const byId = id => document.getElementById(id);
let locale = 'zh-CN';
try {
  if (localStorage.getItem(localeKey) === 'en') locale = 'en';
} catch {
  // Keep the current page usable when the browser blocks storage.
}
let registerMode = false;
let signing = false;
let submittingApproval = false;
let pendingUsers = null;
let loadingUsers = false;
let message = null;

function t(key) { return strings[locale][key] || strings[locale].server_error; }

function renderMessage() {
  const target = byId(adminPage ? 'admin-message' : 'form-message');
  target.hidden = !message;
  if (!message) {
    target.textContent = '';
    return;
  }
  target.textContent = t(message.key).replace('{name}', () => message.name || '');
  target.dataset.tone = message.tone;
}

function setMessage(key, tone = 'error', name = '') {
  message = key ? {key, tone, name} : null;
  renderMessage();
}

function renderAuth() {
  byId('form-title').textContent = t(registerMode ? 'registerTitle' : 'loginTitle');
  byId('form-intro').textContent = t(registerMode ? 'registerIntro' : 'loginIntro');
  byId('switch-prompt').textContent = t(registerMode ? 'hasAccount' : 'noAccount');
  byId('switch-mode').textContent = t(registerMode ? 'backToLogin' : 'registerTitle');
  byId('switch-mode').disabled = signing;
  const submit = byId('submit-auth');
  submit.textContent = t(signing ? (registerMode ? 'registering' : 'signingIn') : (registerMode ? 'register' : 'login'));
  submit.disabled = signing;
  byId('username-hint').hidden = byId('password-hint').hidden = !registerMode;
  for (const key of ['username', 'password']) {
    const field = byId(key);
    field.readOnly = signing;
    if (registerMode) field.setAttribute('aria-describedby', key + '-hint');
    else field.removeAttribute('aria-describedby');
  }
  byId('password').autocomplete = registerMode ? 'new-password' : 'current-password';
  const visible = byId('password').type === 'text';
  byId('show-password').textContent = t(visible ? 'hide' : 'show');
  byId('show-password').setAttribute('aria-pressed', String(visible));
}

function renderPending() {
  byId('refresh').disabled = loadingUsers || submittingApproval;
  byId('pending-count').hidden = pendingUsers === null;
  byId('pending-count').textContent = pendingUsers?.length ?? '';
  const status = byId('list-status');
  const showRows = Boolean(pendingUsers?.length);
  status.hidden = showRows || (!loadingUsers && pendingUsers === null);
  status.textContent = t(loadingUsers && !showRows ? 'loading' : 'empty');
  byId('users-table-wrap').hidden = !showRows;
  const body = byId('users-table');
  body.replaceChildren();
  const dateFormat = new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short'});
  for (const user of pendingUsers || []) {
    const row = body.insertRow();
    row.insertCell().textContent = user.username;
    const date = new Date(user.createdAt);
    row.insertCell().textContent = Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary approve';
    button.textContent = t('approve');
    button.setAttribute('aria-label', t('approve') + ' ' + user.username);
    button.disabled = loadingUsers || submittingApproval;
    button.addEventListener('click', () => approveUser(user.username));
    row.insertCell().append(button);
  }
}

function render() {
  document.documentElement.lang = locale;
  document.title = t(adminPage ? 'approval' : registerMode ? 'registerTitle' : 'login') + ' · ' + t('brand');
  document.querySelectorAll('[data-locale]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.locale === locale)));
  document.querySelectorAll('[data-copy]').forEach(element => { element.textContent = t(element.dataset.copy); });
  document.querySelectorAll('[data-label]').forEach(element => element.setAttribute('aria-label', t(element.dataset.label)));
  if (adminPage) renderPending();
  else renderAuth();
  renderMessage();
}

async function api(path, body) {
  let response, data;
  try {
    const options = {credentials: 'same-origin', cache: 'no-store'};
    if (body !== undefined) {
      options.method = 'POST';
      options.headers = {'Content-Type': 'application/json'};
      options.body = JSON.stringify(body);
    }
    response = await fetch('/api/' + path, options);
    data = await response.json();
  } catch {
    throw new Error('connection_error');
  }
  if (!response.ok) throw new Error(data?.error || 'server_error');
  return data;
}

function goToWorkspace(user) {
  const next = new URLSearchParams(location.search).get('next');
  if (next === 'admin' && user.role === 'admin') location.replace('./admin.html');
  else location.replace('./workspace.html' + (location.hash === '#about' ? '#about' : ''));
}

function resetFormMode(isRegister) {
  registerMode = isRegister;
  byId('password').value = '';
  byId('password').type = 'password';
  for (const id of ['username', 'password']) byId(id).removeAttribute('aria-invalid');
  setMessage(null);
  render();
}

async function submitAuth(event) {
  event.preventDefault();
  if (signing) return;
  const username = byId('username').value.trim();
  const password = byId('password').value;
  const normalized = username.normalize('NFKC');
  for (const key of ['username', 'password']) byId(key).removeAttribute('aria-invalid');
  let issue;
  if (!username) issue = ['username', 'requiredUsername'];
  else if (!password) issue = ['password', 'requiredPassword'];
  else if (registerMode && !/^[\p{L}\p{N}][\p{L}\p{N}._-]{2,39}$/u.test(normalized)) issue = ['username', 'invalid_username'];
  else if (registerMode && (Array.from(password).length < 8 || Array.from(password).length > 128)) issue = ['password', 'invalid_password'];
  if (issue) {
    const field = byId(issue[0]);
    field.setAttribute('aria-invalid', 'true');
    field.focus();
    setMessage(issue[1]);
    return;
  }
  signing = true;
  setMessage(null);
  renderAuth();
  try {
    const {user} = await api(registerMode ? 'register' : 'login', {username, password});
    if (registerMode) {
      resetFormMode(false);
      setMessage('pendingSuccess', 'success');
      byId('password').focus();
    } else {
      goToWorkspace(user);
    }
  } catch (error) {
    setMessage(error.message);
  } finally {
    signing = false;
    renderAuth();
  }
}

function showAdminError(error) {
  if (error.message === 'login_required') location.replace('./?next=admin');
  else if (error.message === 'admin_required') location.replace('./workspace.html');
  else setMessage(error.message);
}

async function loadUsers() {
  if (loadingUsers || submittingApproval) return;
  loadingUsers = true;
  setMessage(null);
  renderPending();
  try {
    const {users} = await api('admin/users');
    pendingUsers = users.filter(user => user.status === 'pending');
  } catch (error) {
    showAdminError(error);
  } finally {
    loadingUsers = false;
    renderPending();
  }
}

async function approveUser(username) {
  if (submittingApproval || loadingUsers) return;
  submittingApproval = true;
  setMessage(null);
  renderPending();
  try {
    await api('admin/approve', {username});
    pendingUsers = pendingUsers.filter(user => user.username !== username);
    setMessage('approvedMessage', 'success', username);
  } catch (error) {
    showAdminError(error);
  } finally {
    submittingApproval = false;
    renderPending();
  }
}

document.querySelectorAll('[data-locale]').forEach(button => button.addEventListener('click', () => {
  locale = button.dataset.locale;
  try { localStorage.setItem(localeKey, locale); } catch { /* The chosen language still applies to this page. */ }
  render();
}));

if (adminPage) {
  byId('refresh').addEventListener('click', loadUsers);
  byId('logout').addEventListener('click', async () => {
    byId('logout').disabled = true;
    try {
      await api('logout', {});
      location.replace('./');
    } catch (error) {
      setMessage(error.message);
      byId('logout').disabled = false;
    }
  });
  loadUsers();
} else {
  byId('auth-form').addEventListener('submit', submitAuth);
  byId('switch-mode').addEventListener('click', () => {
    resetFormMode(!registerMode);
    byId('username').focus();
  });
  byId('show-password').addEventListener('click', () => {
    const field = byId('password');
    field.type = field.type === 'password' ? 'text' : 'password';
    renderAuth();
  });
  api('session').then(({user}) => {
    if (user) goToWorkspace(user);
  }).catch(error => {
    if (error.message !== 'login_required' && !message) setMessage(error.message);
  });
}
render();
