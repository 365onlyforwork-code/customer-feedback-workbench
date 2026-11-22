import { readSpreadsheet, csvText, guessMapping } from './spreadsheet.js';
import { analyzeRows, getQueue, compareQueues, parseTags, STRATEGIES, DEFAULT_RULES } from './analysis.js';
import { sampleProjects } from './examples.js';
import { localizeDocument, locale, setLocale, t, topicLabel } from './i18n.js';

import { overviewHtml } from './overview.js';
import { workStates, getWork, inboxHtml, workEditorHtml, filteredWorkRows, hasWorkFilters, workLabel } from './followup.js';
import { getReviewTags, mountReviewTags, reviewTagsHtml } from './review-tags.js';

import { openPortRecovery } from './portable-state.js';

const pages = [
  ['overview', t('Overview', '指挥台')],
  ['inbox', t('Inbox', '反馈跟进')],
  ['issues', t('Analysis', '问题分析')],
  ['review', t('Review', '反馈抽查')],
  ['projects', t("Projects", '项目管理')],
  ['about', t("About", '系统介绍')],
];

const strategies = {
  joint: t("Balanced", '综合优先'),
  uncertainty: t("Unconfirmed labels first", '标签待确认优先'),
  impact: t("High priority first", '重点问题优先'),
  random: t("Random sample", '随机抽查'),
  joint70: t("Balanced, priority-weighted", '综合优先（侧重重点问题）'),
};

const icons = {
  folder: '<path d="M3 5h7l2 3h9v11H3z"/>',
  sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><path stroke-width="3" d="M9 4v4m6 2v4m-6 2v4"/>',
  upload: '<path d="M12 16V3m-4 4 4-4 4 4M4 15v5h16v-5"/>',
  download: '<path d="M12 3v13m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  caret: '<path d="m7 10 5 5 5-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14m-7-7h14"/>',
  forward: '<path d="m10 7 5 5-5 5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9a2.8 2.8 0 0 1 5.6.3c0 2-2.9 2.2-2.9 4m0 3h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};

const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const discardDialog = document.querySelector('#discard-work');
const templateGuide = document.querySelector('#template-guide');
const toast = document.querySelector('#toast');
const sessionResponse = await fetch('./api/session', { cache: 'no-store' })
  .then((response) => response.ok ? response.json() : null).catch(() => null);
const account = sessionResponse?.user;
const legacyStorageKey = 'customer-feedback-workspace-v1';
const storageKey = legacyStorageKey + ':' + encodeURIComponent(account?.username || '');
const localRecovery = await openPortRecovery(account);
const perPage = 8;
const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
const batchTime = new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const fields = [
  { key: 'text', label: t("Feedback text", '反馈正文'), example: t("The page stays on the loading screen after I submit payment.", '提交付款后页面一直停在加载中。'), hint: t("Enter the customer's wording or the ticket description.", '填写客户原话或工单描述。') },
  { key: 'date', label: t("Date", '日期'), example: '2026-11-19', hint: t("Enter the feedback date in YYYY-MM-DD format so it can be included in the trend.", '填写反馈日期，建议用 YYYY-MM-DD。填写后可按日期查看趋势。') },
  { key: 'product', label: t("Product or service", '产品或服务'), example: t("Online store", '在线商城'), hint: t("Use a consistent name for each product or service so it can be filtered.", '同一个产品或服务使用统一名称，便于筛选。') },
  { key: 'channel', label: t("Channel", '渠道'), example: t("Chat support", '在线客服'), hint: t("Enter the original channel, such as support chat, phone or in-store.", '填写反馈来源，如在线客服、电话、门店。') },
  { key: 'rating', label: t("Rating", '评分'), example: '2', hint: t("Enter the original rating. Use a consistent rating scale within a batch.", '填写原渠道的评分，同一批反馈尽量使用同一评分制。') },
  { key: 'tags', label: t("Existing tags", '已有标签'), example: t("Payment, page loading", '付款、页面加载'), hint: t("Enter existing labels. Separate multiple labels in one cell with commas.", '填写已有分类。多个标签写在同一格，用顿号分隔。') },
  { key: 'reference', label: t("Original ticket ID", '原工单号'), example: 'CS-10001', hint: t("Enter the source ticket ID. The first occurrence of each ID is kept per project. Format IDs with leading zeros as text.", '填写原系统编号。同一项目中，重复工单号保留首次导入的记录。带前导零的编号请按文本填写。') },
];
const templateSteps = [
  t("Keep the first row as headers. Replace or remove the example row and enter one item per row.", '保留第一行表头，替换或删除模板中的示例行。每行填一条反馈。'),
  t("Only Feedback text is required. The other columns can be left blank.", '只有「反馈正文」必填，其余列可以留空。'),
  t("In Excel, save the file as CSV UTF-8 before importing.", '在 Excel 中编辑后，另存为「CSV UTF-8」再导入。'),
];

// Fictional handling records belong only to the built-in examples.
const exampleFollowups = [
  {
    'CE-002': { state: '处理中', owner: '品质组', due: '2026-11-24', note: '已登记发热情况，等待检测人员确认取件安排。' },
    'CE-006': { state: '处理中', owner: '售后组', due: '2026-11-22', note: '已联系换货专员核对序列号。' },
    'CE-010': { state: '处理中', owner: '品质组', due: '2026-11-21', note: '请上门服务商确认回收时间，并反馈给客户。' },
    'CE-012': { state: '已办结', owner: '履约组', note: '已核对运单，补发配送进度给客户。' },
    'CE-013': { state: '无需跟进', note: '客户分享使用体验，已记录产品反馈。' },
    'CE-020': { state: '处理中', owner: '仓配组', due: '2026-11-24', note: '已核对订单，等待仓库核实拣货型号。' },
    'CE-027': { state: '已办结', owner: '售后组', note: '已确认换货地址，客户已收到处理回执。' },
    'CE-030': { state: '处理中', owner: '财务组', due: '2026-11-23', note: '正在核对支付流水，确认后回复客户。' },
    'CE-039': { state: '无需跟进', note: '正常使用反馈。' },
  },
  {
    'SW-002': { state: '处理中', owner: '客户成功组', due: '2026-11-23', note: '请财务核对两笔付款流水。' },
    'SW-005': { state: '处理中', owner: '平台组', due: '2026-11-21', note: '已登记共享范围，等待权限核查结果。' },
    'SW-007': { state: '已办结', owner: '报表组', note: '已发送可在 Excel 中打开的导出文件。' },
    'SW-019': { state: '无需跟进', note: '客户确认插件可正常使用。' },
  },
];

const demos = sampleProjects.map((project, index) => ({
  ...project, id: 'demo-' + index, demo: true, reviews: {}, followups: exampleFollowups[index], settings: { budget: 20, a: 'joint', b: 'impact' },
}));

let storageReadFailed = Boolean(localRecovery && !localRecovery.ready);

function initialState() {
  if (localRecovery?.state) {
    const restored = localRecovery.state;
    localRecovery.state = null;
    try { localStorage.setItem(storageKey, JSON.stringify(restored)); } catch { /* Keep the recovery copy readable. */ }
    return restored;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && Array.isArray(saved.projects) && typeof saved.demos === 'object') {
      if (localRecovery?.ready) {
        try { localRecovery.write(JSON.stringify(saved)); } catch { storageReadFailed = true; }
      }
      return saved;
    }
    if (account?.role === 'admin') {
      const legacy = localStorage.getItem(legacyStorageKey);
      const previous = JSON.parse(legacy);
      if (previous && Array.isArray(previous.projects) && typeof previous.demos === 'object') {
        try { localStorage.setItem(storageKey, legacy); } catch { /* Keep access to the existing workspace. */ }
        if (localRecovery?.ready) {
          try { localRecovery.write(legacy); } catch { storageReadFailed = true; }
        }
        return previous;
      }
    }
  } catch {
    storageReadFailed = true;
  }
  return { projects: [], demos: {}, active: demos[0].id };
}

const state = initialState();
const restoredView = window.history.state?.languageView;
if (restoredView) window.history.replaceState({ workspacePage: restoredView.page }, '');
let page = window.location.hash === '#about' ? 'about'
  : pages.some(([id]) => id === restoredView?.page) ? restoredView.page : 'overview';
let inboxFilters = restoredView?.inboxFilters || { page: 0 };
let queueFilter = restoredView?.queueFilter || 'all';
let queuePage = restoredView?.queuePage || 0;
let selectedId = restoredView?.selectedId || null;
let topicFilter = restoredView?.topicFilter || '';
let topicPage = restoredView?.topicPage || 0;
let issueSearch = restoredView?.issueSearch || '';
let issueProduct = restoredView?.issueProduct || '';
let issueChannel = restoredView?.issueChannel || '';
let noticeTimer;
let importDraft;
let ruleDraft;
let workExportDraft;
let workBaseline;
let workFocus;
let discardAction;
let analyzedCache;
let queueCache;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

const icon = (name) => '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || '') + '</svg>';
const percent = (value, digits = 0) => (value * 100).toFixed(digits) + '%';
const fmt = (value) => number.format(value);
const status = (project, id) => Boolean(project.reviews[id]?.done);
const action = (key, label, style = '', iconName = '') =>
  '<button type="button" class="btn ' + style + '" data-action="' + key + '">' + (iconName ? icon(iconName) : '') + label + '</button>';

function activeProject() {
  const imported = state.projects.find((project) => project.id === state.active);
  if (imported) return imported;
  const demo = demos.find((item) => item.id === state.active) || demos[0];
  return { ...demo, ...state.demos?.[demo.id] };
}

function updateProject(patch, reportFailure = true) {
  const current = activeProject();
  const changes = current.demo
    ? { demos: { ...state.demos, [current.id]: { ...state.demos[current.id], ...patch } } }
    : { projects: state.projects.map((project) => project.id === current.id ? { ...project, ...patch } : project) };
  return commitState(changes, reportFailure);
}

const saveFailure = localRecovery
  ? t('Could not confirm the local save. Keep your edits, check free space and the service window. If another tab edited this project, reopen the workspace.',
      '未能确认本机保存。请保留当前输入，检查磁盘空间和启动窗口。如其他窗口已修改项目，请重新打开工作台。')
  : t('Could not save to this browser. Check your storage settings or available space and try again.',
  '未能保存到当前浏览器。请检查存储设置或可用空间后重试。');

function commitState(changes, reportFailure = true) {
  try {
    if (storageReadFailed) throw new Error('Workspace storage was not read');
    const serialized = JSON.stringify({ ...state, ...changes });
    const previous = localRecovery ? localStorage.getItem(storageKey) : null;
    localStorage.setItem(storageKey, serialized);
    if (localRecovery) {
      try {
        localRecovery.write(serialized);
      } catch (error) {
        if (previous === null) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, previous);
        throw error;
      }
    }
  } catch {
    if (reportFailure) notify(saveFailure);
    else toast.textContent = '';
    return false;
  }
  Object.assign(state, changes);
  return true;
}

function showSaveError(form) {
  toast.textContent = '';
  const panel = form.querySelector('.dialog-foot') || form;
  let error = panel.querySelector('[data-save-error]');
  if (!error) {
    error = document.createElement('p');
    error.className = 'form-error save-error';
    error.dataset.saveError = '';
    error.setAttribute('role', 'alert');
    error.tabIndex = -1;
    panel.prepend(error);
  }
  error.textContent = saveFailure;
  error.focus();
}

function notify(message) {
  toast.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { toast.textContent = ''; }, 4400);
}

function analyzed(project) {
  if (analyzedCache?.rows !== project.rows || analyzedCache.rules !== project.rules) {
    analyzedCache = { rows: project.rows, rules: project.rules, output: analyzeRows(project.rows, project.rules) };
  }
  return analyzedCache.output;
}

function confirmedTags(review, fallback = []) {
  const tags = review?.tags ?? fallback;
  return Array.isArray(tags) ? tags : parseTags(tags);
}

function workRows(project) {
  return analyzed(project).map((row) => ({
    ...row,
    displayTopics: confirmedTags(project.reviews[row.id], row.topics),
    work: getWork(project, row),
  }));
}

function queues(project) {
  const items = analyzed(project);
  const settings = project.settings;
  if (queueCache?.items === items && queueCache.settings === settings) return queueCache.result;
  const budget = Math.min(project.rows.length, settings.budget);
  const a = getQueue(items, settings.a, budget);
  const comparing = Boolean(settings.compare);
  const b = comparing ? getQueue(items, settings.b, budget) : [];
  const overlap = compareQueues(a, b);
  const result = {
    comparing, budget, ...overlap,
    all: [...a, ...overlap.onlyB],
    rankA: new Map(a.map((row, index) => [row.id, index + 1])),
    rankB: new Map(b.map((row, index) => [row.id, index + 1])),
  };
  queueCache = { items, settings, result };
  return result;
}

function header(title, actions = '') {
  return '<header class="page-head desk-page-head"><h1>' + title + '</h1>' + actions + '</header>';
}

function renderChrome(project) {
  const projectOption = (item) => '<button type="button" data-action="switch-project" data-value="' + escapeHtml(item.id) + '"' +
    (project.id === item.id ? ' aria-current="true"' : '') + '><span>' + escapeHtml(item.name) + '</span>' +
    (project.id === item.id ? icon('check') : '') + '</button>';
  document.querySelector('#workspace-menu').innerHTML =
    '<details class="project-menu"><summary class="project-switch" aria-label="' +
    escapeHtml(t("Switch project. Current: ", '切换项目，当前为') + project.name) + '" title="' + escapeHtml(project.name) + '">' +
    '<span class="project-symbol">' + icon('folder') + '</span><span class="project-name">' + escapeHtml(project.name) +
    '</span>' + icon('caret') + '</summary><div class="project-options">' +
    (state.projects.length ? ('<div class="project-options-group" role="group" aria-label="' + t("My projects", '我的项目') + '">') +
      state.projects.map(projectOption).join('') + '</div>' : '') +
    ('<div class="project-options-group" role="group" aria-label="' + t("Sample projects", '示例项目') + '">') + demos.map(projectOption).join('') + '</div></div></details>';
  const navigationButton = ([id, label]) =>
    '<button type="button" class="nav-btn" data-action="go-' + id + '"' +
    (id === page ? ' aria-current="page"' : '') + '>' + label + '</button>';
  document.querySelector('#nav').innerHTML =
    pages.filter(([id]) => id !== 'about').map(navigationButton).join('') +
    '<a class="nav-btn nav-about" href="#about"' + (page === 'about' ? ' aria-current="page"' : '') + ('>' + t("About", '系统介绍') + '</a>');
  const batch = project.batches?.at(-1);
  const importedAt = batch?.at ? Date.parse(batch.at) : NaN;
  document.querySelector('#topbar').innerHTML = (Number.isFinite(importedAt) ?
    '<span class="last-import" title="' + escapeHtml(batch.file) + ('">' + t("Last import", '最近导入') + ' <time datetime="') + escapeHtml(batch.at) +
      '">' + batchTime.format(importedAt) + '</time></span>' : '') + action('import', t("Import file", '导入表格'), 'import-action', 'upload');
  document.querySelector('#account-controls').innerHTML =
    '<button type="button" class="btn btn-quiet" data-action="toggle-language" lang="' + t('zh-CN', 'en') + '">' +
    t('中文', 'English') + '</button><details class="account-menu"><summary class="btn" aria-label="' +
    t('Account menu', '账户菜单') + '"><span>' + escapeHtml(account.username) + '</span>' + icon('caret') + '</summary>' +
    '<div class="account-options">' + (account.role === 'admin' ?
      '<a href="./admin.html">' + t('Account approvals', '账号审批') + '</a>' : '') +
    '<button type="button" data-action="logout">' + t('Sign out', '退出登录') + '</button></div></details>';
}

function strategyOptions(current) {
  return STRATEGIES.map((id) => '<option value="' + id + '"' + (current === id ? ' selected' : '') + '>' + strategies[id] + '</option>').join('');
}

function planSelect(id, label, value) {
  return '<div class="setting"><label for="plan-' + id + '">' + label +
    '</label><select id="plan-' + id + '" class="control" data-plan="' + id + '">' + strategyOptions(value) + '</select></div>';
}

function queueSummary(project, queue) {
  return ('<section class="sampling-settings" aria-label="' + t("Review settings", '抽查设置') + '">') +
    '<div class="sampling-grid">' + planSelect('a', queue.comparing ? t("Primary list method", '主名单方式') : t("Review method", '抽查方式'), project.settings.a) +
    (queue.comparing ? planSelect('b', t("Comparison list method", '对照名单方式'), project.settings.b) : '') +
    '<div class="setting sampling-size"><label for="budget">' + (queue.comparing ? t("Items per list", '每份名单条数') : t("Items to review", '抽查条数')) +
    '</label><input id="budget" class="control num" type="number" min="0" max="' + project.rows.length +
    '" step="1" value="' + queue.budget + '"></div></div>' +
    '<button type="button" class="btn sampling-toggle" data-action="toggle-comparison" aria-pressed="' + queue.comparing +
    ('"><span class="switch-mark" aria-hidden="true"></span>' + t("Comparison list", '对照名单') + '</button></section>');
}

function rankBadge(rankA, rankB) {
  return (rankA ? ('<span class="badge blue">' + t("Primary ", '主 ')) + rankA + '</span> ' : '') +
    (rankB ? ('<span class="badge teal">' + t("Comparison ", '对照 ')) + rankB + '</span>' : '');
}

function headlineReason(row, strategy) {
  if (strategy === 'random') return t("Randomly selected", '随机入选');
  if (strategy === 'impact' && row.reasons.length > 1) return row.reasons.slice(1).join(' · ');
  if (strategy === 'impact') return t("Selected in import order", '按导入顺序入选');
  if (strategy === 'joint' || strategy === 'joint70') return row.reasons.join(' · ');
  return row.reasons[0];
}

function queueTable(project, queue, pending, rows, current) {
  const comparisons = [['onlyA', t("Primary only", '仅主名单'), 'a-color'], ['both', t("In both lists", '两份共有'), 'common-color'], ['onlyB', t("Comparison only", '仅对照'), 'b-color']];
  const tabs = [['all', t("All", '全部')], ['pending', t("To review", '待核对')], ...(queue.comparing ? comparisons : [])];
  const slice = rows.slice(queuePage * perPage, (queuePage + 1) * perPage);
  const done = queue.all.length - pending.length;
  const rankHeading = t('List rank', '名单顺位');
  const tagHeading = t('Main label', '主要标签');
  const statusHeading = t('Review status', '核对状态');
  const split = queue.comparing && queue.all.length ? '<div class="bar queue-split" aria-hidden="true">' +
    comparisons.map(([id, , color]) => '<i class="' + color + '" style="flex-grow:' + queue[id].length + '"></i>').join('') + '</div>' : '';
  return ('<section class="queue-panel"><div class="panel-head queue-head"><h2>' + t("Review list", '抽查名单') + '</h2><small class="muted num">' + t("Reviewed", '已核对') + ' ') + fmt(done) + ' / ' +
    fmt(queue.all.length) + '</small></div>' + split +
    ('<div class="tabs queue-tabs" aria-label="' + t("Filter review list", '名单筛选') + '">') + tabs.map(([id, label, color]) =>
      '<button type="button" class="tab" data-action="filter-' + id + '" aria-pressed="' + (id === queueFilter) + '">' + label +
      (color ? '<i class="swatch ' + color + '" aria-hidden="true"></i>' : '') +
      '<b>' + fmt(id === 'pending' ? pending.length : queue[id].length) + '</b></button>').join('') + '</div>' +
    (rows.length ? '<div class="table-wrap"><table role="table" class="queue-table' + (queue.comparing ? ' queue-table-compare' : '') +
      '"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">' + t('Feedback text', '反馈正文') + '</th>' +
      (queue.comparing ? '<th role="columnheader" scope="col">' + rankHeading + '</th>' : '') +
      '<th role="columnheader" scope="col">' + tagHeading + '</th><th role="columnheader" scope="col">' + statusHeading + '</th></tr></thead><tbody role="rowgroup">' +
      slice.map((row) => '<tr role="row" data-id="' + escapeHtml(row.id) + '"' + (current?.id === row.id ? ' class="selected"' : '') + '><td role="cell">' +
        '<button type="button" class="text-button" data-action="feedback" data-value="' + escapeHtml(row.id) +
        '" aria-pressed="' + (current?.id === row.id) + '"><span class="excerpt" title="' + escapeHtml(row.text) + '">' + escapeHtml(row.text) + '</span></button></td>' +
        (queue.comparing ? '<td role="cell" data-review-label="' + rankHeading + '" class="nowrap num">' +
          rankBadge(queue.rankA.get(row.id), queue.rankB.get(row.id)) + '</td>' : '') + '<td role="cell" data-review-label="' + tagHeading + '">' +
        '<span class="table-tag" title="' + escapeHtml(confirmedTags(project.reviews[row.id], row.topics).join(' · ')) + '">' +
        escapeHtml(topicLabel(confirmedTags(project.reviews[row.id], row.topics)[0] || '未分类')) + '</span></td><td role="cell" data-review-label="' + statusHeading + '" class="nowrap">' +
        (status(project, row.id) ? ('<span class="badge teal">' + t("Reviewed", '已核对') + '</span>') : ('<span class="badge">' + t("To review", '待核对') + '</span>')) + '</td></tr>').join('') + '</tbody></table></div>' +
      pagination('queue', queuePage, rows.length) : '<p class="empty">' +
      (queueFilter === 'pending' ? t("No items awaiting review", '暂无待核对反馈') : t("The list is empty", '名单为空')) + '</p>') + '</section>';
}

function pagination(kind, index, total) {
  const last = Math.ceil(total / perPage) - 1;
  if (last < 1) return '';
  return '<div class="table-foot"><small class="muted num">' + fmt(index * perPage + 1) + '–' + fmt(Math.min((index + 1) * perPage, total)) +
    t(" of ", ' 条，共 ') + fmt(total) + (t(" items", ' 条') + '</small><div class="row">') +
    '<button type="button" class="btn" data-action="' + kind + '-prev"' + (index === 0 ? ' disabled' : '') + ('>' + t("Previous", '上一页') + '</button>') +
    '<button type="button" class="btn" data-action="' + kind + '-next"' + (index >= last ? ' disabled' : '') + ('>' + t("Next", '下一页') + '</button></div></div>');
}

function detail(project, row, queue) {
  if (!row) return '';
  const saved = project.reviews[row.id];
  const metadata = [row.id, row.product, row.channel, row.date, row.rating && (t("Rating", '评分') + ' ') + row.rating].filter(Boolean).join(' / ');
  const rankA = queue.rankA.get(row.id);
  const rankB = queue.rankB.get(row.id);
  return ('<section class="detail" id="feedback-detail"><div class="panel-head"><h2>' + t("Review feedback", '核对反馈') + '</h2>') +
    (queue.comparing ? '<div>' + rankBadge(rankA, rankB) + '</div>' : '') + '</div><div class="panel-body">' +
    '<p class="eyeline">' + escapeHtml(metadata) + '</p><div class="quote">' + escapeHtml(row.text) + '</div>' +
    '<button type="button" class="btn btn-quiet" data-action="handle-feedback" data-value="' + escapeHtml(row.id) + ('">' + t("Open follow-up", '处理这条反馈') + '</button>') +
    ('<details class="detail-section"><summary>' + t("Selection reason", '入选原因') + '</summary>') +
    (rankA ? '<p>' + (queue.comparing ? ('<b>' + t("Primary list", '主名单') + '</b>　') : '') + escapeHtml(headlineReason(row, project.settings.a)) + '</p>' : '') +
    (rankB ? ('<p><b>' + t("Comparison list", '对照名单') + '</b>　') + escapeHtml(headlineReason(row, project.settings.b)) + '</p>' : '') +
    '</details>' +
    '<form class="details-form" data-form="review"><input type="hidden" name="id" value="' + escapeHtml(row.id) + '">' +
    reviewTagsHtml(confirmedTags(saved, row.topics)) +
    ('<div class="field"><label for="review-note">' + t("Review notes", '核对备注') + '</label><textarea id="review-note" class="control" maxlength="3000" name="note">') +
    escapeHtml(saved?.note || '') + '</textarea></div>' +
    '<div class="row">' + (saved?.done ? action('reopen-review', t("Mark for review", '标为待核对'), 'btn-quiet') : '') +
    '<button type="submit" class="btn btn-primary">' + (saved?.done ? t("Save changes", '保存修改') : t("Finish review", '完成核对')) + '</button></div></form></div></section>';
}

function renderReview(project) {
  const queue = queues(project);
  const pending = queue.all.filter((row) => !status(project, row.id));
  const rows = queueFilter === 'pending' ? pending : queue[queueFilter];
  queuePage = Math.min(queuePage, Math.max(0, Math.ceil(rows.length / perPage) - 1));
  const visible = rows.slice(queuePage * perPage, (queuePage + 1) * perPage);
  const current = visible.find((row) => row.id === selectedId) || visible[0];
  selectedId = current?.id || null;
  main.innerHTML = header(t('Review', '反馈抽查'), '<div class="actions">' +
    action('rules', t("Classification rules", '分类规则'), 'btn-quiet', 'sliders') + action('export', t("Export review results", '导出抽查结果'), '', 'download') + '</div>') +
    '<div class="panel review-workspace">' + queueSummary(project, queue) +
    '<div' + (current ? ' class="columns-12 queue-grid"' : '') + '>' +
    queueTable(project, queue, pending, rows, current) + detail(project, current, queue) + '</div></div>';
  if (current) {
    const options = new Set(project.rules.map((rule) => rule.name));
    for (const row of analyzed(project)) for (const tag of row.topics) options.add(tag);
    for (const review of Object.values(project.reviews)) for (const tag of confirmedTags(review)) options.add(tag);
    mountReviewTags(main.querySelector('[data-form="review"]'), options);
  }
}

function renderProjects(project) {
  function projectRow(item) {
    const active = item.id === project.id;
    return '<tr><td><button type="button" class="text-button project-title" data-action="open-project" data-value="' +
      escapeHtml(item.id) + '"' + (active ? ' aria-current="true"' : '') + '>' + escapeHtml(item.name) + '</button>' +
      (active ? ('<span class="project-current-text">' + t("Current", '当前') + '</span>') : '') + '</td><td class="num">' +
      fmt(item.rows.length) + '</td><td class="project-source">' + escapeHtml(item.source || '—') + '</td></tr>';
  }
  const ownProjects = state.projects.length ? '<div class="table-wrap"><table class="project-table"><thead><tr>' +
    ('<th scope="col">' + t("Project name", '项目名称') + '</th><th scope="col">' + t("Feedback count", '反馈数') + '</th><th scope="col">' + t("Import source", '导入来源') + '</th></tr></thead><tbody>') +
    state.projects.map(projectRow).join('') + '</tbody></table></div>' :
    '<div class="project-start">' + action('import', t("Import your first feedback file", '导入第一份反馈表'), 'btn-primary', 'upload') +
    '<span class="project-formats">Excel (.xlsx) · CSV · TSV</span></div>';
  const examples = demos.map((item) => '<button type="button" class="project-example" data-action="open-project" data-value="' +
    escapeHtml(item.id) + '"' + (item.id === project.id ? ' aria-current="true"' : '') + '><span>' +
    escapeHtml(item.name) + '</span><small class="num">' + fmt(item.rows.length) + (t(" items", ' 条') + '</small></button>')).join('');
  main.innerHTML = header(t("Projects", '项目管理'), '<div class="actions">' + templateActions() + '</div>') +
    ('<div class="columns-12 project-layout"><section class="panel span-8"><div class="panel-head"><h2>' + t("My projects", '我的项目') + '</h2><span class="section-tally">' + fmt(state.projects.length) + '</span></div>') + ownProjects +
    ('</section><section class="panel span-4"><div class="panel-head"><h2>' + t("Sample projects", '示例项目') + '</h2><span class="section-tally">' + fmt(demos.length) + '</span></div>') + examples + '</section></div>';
}

function filterOptions(rows, field, current, label) {
  return '<option value="">' + label + '</option>' + [...new Set(rows.map((row) => row[field]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN')).map((value) => '<option value="' + escapeHtml(value) + '"' +
      (value === current ? ' selected' : '') + '>' + escapeHtml(value) + '</option>').join('');
}

function renderIssues(project) {
  const items = analyzed(project);
  const mapped = items.map((row) => ({ ...row, displayTopics: confirmedTags(project.reviews[row.id], row.topics) }));
  const found = mapped.filter((row) => (!issueSearch || row.text.toLowerCase().includes(issueSearch.toLowerCase())) &&
    (!issueProduct || row.product === issueProduct) && (!issueChannel || row.channel === issueChannel));
  const counts = new Map();
  for (const row of found) {
    for (const topic of row.displayTopics.length ? row.displayTopics : ['未分类']) counts.set(topic, (counts.get(topic) || 0) + 1);
  }
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
  const subset = found.filter((row) => !topicFilter || (row.displayTopics.length ? row.displayTopics : ['未分类']).includes(topicFilter));
  const displayFilters = '<form class="row issue-filters" data-form="issue-search">' +
    '<div class="issue-search">' + icon('search') + ('<input name="q" aria-label="' + t("Search feedback text", '搜索反馈原文') + '" type="search" class="control" value="') + escapeHtml(issueSearch) + ('" placeholder="' + t("Search feedback text", '搜索反馈原文') + '"></div>') +
    (items.some((row) => row.product) ? ('<select aria-label="' + t("Product", '产品') + '" class="control" name="product">') + filterOptions(items, 'product', issueProduct, t("All products", '全部产品')) + '</select>' : '') +
    (items.some((row) => row.channel) ? ('<select aria-label="' + t("Channel", '渠道') + '" class="control" name="channel">') + filterOptions(items, 'channel', issueChannel, t("All channels", '全部渠道')) + '</select>' : '') +
    ('<button type="submit" class="btn btn-primary">' + t("Apply filters", '筛选') + '</button>') +
    (topicFilter || issueSearch || issueProduct || issueChannel ? action('reset-issues', t("Clear filters", '清空筛选'), 'btn-quiet') : '') + '</form>';
  main.innerHTML = header(t('Analysis', '问题分析'), action('rules', t("Classification rules", '分类规则'), '', 'sliders')) +
    '<div class="panel analysis-workspace">' + displayFilters +
    ('<div class="columns-12 issues-layout"><section class="panel span-4 issue-topics"><div class="panel-head"><h2>' + t("Label distribution", '标签分布') + '</h2></div><div class="topic-buttons">') +
    ([['', found.length], ...groups]).map(([topic, count]) => '<button type="button" class="topic-button" data-action="topic" data-value="' +
      escapeHtml(topic) + '" aria-pressed="' + (topic === topicFilter) + '"><strong>' + escapeHtml(topic ? topicLabel(topic) : t("All feedback", '全部反馈')) +
      '</strong><span class="bar" aria-hidden="true"><i class="a-color" style="width:' + percent(found.length ? count / found.length : 0, 3) +
      '"></i></span><b class="num">' + fmt(count) + '</b></button>').join('') + '</div></section>' +
    '<section class="panel span-8 issue-results"><div class="panel-head"><h2>' + escapeHtml(topicFilter ? topicLabel(topicFilter) : t("Feedback text", '反馈原文')) + '</h2><small class="muted num">' + fmt(subset.length) + (t(" items", ' 条') + '</small></div>') +
    (subset.length ? ('<div class="table-wrap"><table class="issue-table"><thead><tr><th scope="col">' + t("Feedback and labels", '反馈与标签') + '</th><th scope="col">' + t("Source", '来源') + '</th></tr></thead><tbody>') +
      subset.slice(topicPage * perPage, (topicPage + 1) * perPage).map((row) => '<tr><td><button class="text-button" data-action="issue-feedback" data-value="' +
        escapeHtml(row.id) + '" type="button"><span class="excerpt">' + escapeHtml(row.text) + '</span></button><p class="small muted">' +
        escapeHtml(row.displayTopics.map(topicLabel).join(' · ') || topicLabel('未分类')) + '</p></td><td>' + escapeHtml([row.product, row.channel].filter(Boolean).join(' / ') || '—') + '</td></tr>').join('') +
      '</tbody></table></div>' + pagination('topic', topicPage, subset.length) : ('<p class="empty">' + t("No matching feedback", '无匹配反馈') + '</p>')) + '</section></div></div>';
}

function render() {
  const project = activeProject();
  renderChrome(project);
  if (page === 'overview') main.innerHTML = overviewHtml(project, workRows(project));
  if (page === 'inbox') main.innerHTML = inboxHtml(project, workRows(project), inboxFilters);
  if (page === 'review') renderReview(project);
  if (page === 'projects') renderProjects(project);
  if (page === 'issues') renderIssues(project);
  if (page === 'about') main.replaceChildren(document.querySelector('#about-page').content.cloneNode(true));
}

function displayPage(next) {
  page = next;
  render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

function setPage(next) {
  if (window.location.hash === '#about' && next !== 'about') {
    window.history.pushState({ workspacePage: next }, '', window.location.href.split('#')[0]);
  } else if (next !== 'about' && next !== page) {
    window.history.replaceState({ workspacePage: next }, '');
  }
  displayPage(next);
}

window.addEventListener('hashchange', (event) => {
  const next = window.location.hash === '#about' ? 'about'
    : page === 'about' ? window.history.state?.workspacePage || 'overview' : page;
  if (next === page) return;
  if (workIsDirty()) {
    window.history.replaceState(window.history.state, '', event.oldURL);
    return requestWorkExit(() => {
      dialog.close();
      window.history.replaceState(window.history.state, '', event.newURL);
      displayPage(next);
    });
  }
  if (workBaseline) dialog.close();
  displayPage(next);
});

function resetView() {
  inboxFilters = { page: 0 };
  queueFilter = 'all';
  queuePage = 0;
  selectedId = null;
  topicFilter = '';
  topicPage = 0;
  issueSearch = '';
  issueProduct = '';
  issueChannel = '';
}

function readWorkFields(form) {
  return Object.fromEntries(['state', 'priority', 'owner', 'due', 'note'].map((name) => [name, form.elements[name].value]));
}

function workIsDirty() {
  const form = dialog.open && dialog.querySelector('form[data-form="work"]');
  return Boolean(form && workBaseline && JSON.stringify(readWorkFields(form)) !== workBaseline);
}

function promptBrowserExit(event) {
  if (workIsDirty()) {
    event.preventDefault();
    event.returnValue = true;
  }
}

function syncWorkGuard() {
  if (workIsDirty()) window.addEventListener('beforeunload', promptBrowserExit);
  else window.removeEventListener('beforeunload', promptBrowserExit);
}

function requestWorkExit(proceed) {
  if (!workIsDirty()) return proceed();
  if (discardDialog.open) return;
  discardAction = proceed;
  discardDialog.showModal();
}

function showDialog(title, body, footer, form = '') {
  if (workIsDirty()) return requestWorkExit(() => showDialog(title, body, footer, form));
  const content = '<div class="dialog-head"><h2 id="dialog-title">' + title + '</h2>' + action('close', t("Close", '关闭'), 'btn-quiet icon-btn', 'close') +
    '</div><div class="dialog-body">' + body + '</div><div class="dialog-foot">' + footer + '</div>';
  workBaseline = null;
  workFocus = null;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.innerHTML = form ? '<form data-form="' + form + '">' + content + '</form>' : content;
  if (form === 'work') {
    const editor = dialog.querySelector('form');
    setWorkRequirements(editor);
    workBaseline = JSON.stringify(readWorkFields(editor));
  }
  if (!dialog.open) dialog.showModal();
  syncWorkGuard();
}

function templateActions() {
  return action('template-guide', t("Filling guide", '填报指南'), 'btn-quiet', 'help') +
    action('template', t("Download CSV template", '下载 CSV 模板'), '', 'download');
}

function renderImport() {
  const draft = importDraft;
  const sheet = draft.workbook?.sheets[draft.sheet];
  const preview = sheet ? ('<section class="preview-block"><div class="preview-head"><h3>' + t("File preview", '表格预览') + '</h3><span>' + t("Total: ", '共 ')) +
    fmt(sheet.rows.length) + (t(" rows", ' 行') + '</span></div><div class="import-preview" tabindex="0" aria-label="' + t("Imported file preview", '导入文件表格预览') + '"><table><thead><tr>') +
    sheet.headers.map((name, index) => '<th scope="col" data-preview-column="' + index + '">' + escapeHtml(name) + '</th>').join('') +
    '</tr></thead><tbody>' + sheet.rows.slice(0, 4).map((row) => '<tr>' + row.map((cell, index) =>
      '<td data-preview-column="' + index + '">' + escapeHtml(String(cell).slice(0, 220)) + '</td>').join('') +
      '</tr>').join('') + '</tbody></table></div></section>' : '';
  const targetSelect = state.projects.length ? ('<div class="field"><label for="import-target">' + t("Import into", '导入到') + '</label><select class="control" id="import-target">') +
    ('<option value="">' + t("Create project", '新建项目') + '</option>') + state.projects.map((item) => '<option value="' + escapeHtml(item.id) + '"' +
      (draft.target === item.id ? ' selected' : '') + ('>' + t("Append to · ", '追加到 · ')) + escapeHtml(item.name) + '</option>').join('') + '</select></div>' : '';
  const mapping = sheet ? '<div class="columns-12 import-layout"><div class="import-settings span-4"><div class="import-destination">' +
    targetSelect + (draft.target ? '' : ('<div class="field"><label for="import-name">' + t("Project name", '项目名称') + '</label><input class="control" id="import-name" name="project" value="') +
    escapeHtml(draft.name) + '" required maxlength="100"></div>') +
    (draft.workbook.sheets.length > 1 ? ('<div class="field"><label for="import-sheet">' + t("Excel worksheet", 'Excel 工作表') + '</label><select class="control" id="import-sheet">') +
      draft.workbook.sheets.map((item, index) => '<option value="' + index + '"' + (index === draft.sheet ? ' selected' : '') + '>' +
        escapeHtml(item.name) + '</option>').join('') + '</select></div>' : '') +
    ('</div><fieldset class="mapping"><legend>' + t("Column mapping", '列映射') + '</legend>') + fields.map(({ key, label }) => '<div class="field"><label for="map-' + key + '">' + label +
      (key === 'text' ? t(" (required)", '（必填）') : '') + '</label><select class="control" id="map-' + key + '" data-map="' + key + '"' +
      (key === 'text' ? ' required' : '') + '><option value="">' + (key === 'text' ? t("Select a column", '选择列') : '—') + '</option>' +
      sheet.headers.map((name, index) => '<option value="' + index + '"' + (draft.mapping[key] === index ? ' selected' : '') +
        '>' + escapeHtml(name) + '</option>').join('') + '</select></div>').join('') + '</fieldset></div>' + preview + '</div>' : '';
  const fileInput = ('<input id="import-file" aria-label="' + t("Select a feedback file", '选择公司反馈表') + '" type="file" accept=".xlsx,.csv,.tsv,.txt">');
  const upload = draft.file ?
    '<div class="upload upload-selected">' + icon('upload') + '<strong class="upload-copy">' + escapeHtml(draft.file) +
    ('</strong><label class="btn upload-button">' + t("Replace file", '更换文件')) + fileInput + '</label></div>' :
    '<label class="upload upload-button upload-picker">' + icon('upload') +
    ('<span class="upload-copy"><strong>' + t("Select a feedback file", '选择反馈表') + '</strong><small>Excel (.xlsx) · CSV · TSV</small></span>') + fileInput + '</label>';
  showDialog(t("Import file", '导入表格'), upload +
    (draft.loading ? ('<p class="small muted" role="status">' + t("Reading file…", '正在读取表格…') + '</p>') : '') +
    (draft.error ? '<p class="form-error" role="alert" tabindex="-1">' + escapeHtml(draft.error) + '</p>' : '') + mapping,
    '<div class="actions">' + templateActions() + '</div>' +
    (sheet ? '<button type="submit" class="btn btn-primary"' + (draft.saving ? ' disabled' : '') + '>' +
    (draft.saving ? t("Importing…", '正在导入…') : draft.target ? t("Append to project", '追加到项目') : t("Create project and import", '创建项目并导入')) + '</button>' : ''), 'import');
  markImportColumn();
  if (draft.saving) {
    dialog.querySelectorAll('input,select,button:not([data-action="close"])').forEach((control) => { control.disabled = true; });
  }
}

function markImportColumn() {
  dialog.querySelectorAll('[data-preview-column]').forEach((cell) => {
    cell.classList.toggle('preview-mapped', Number(cell.dataset.previewColumn) === importDraft.mapping.text);
  });
}

function rulesBody() {
  return '<div class="rule-list">' +
    ruleDraft.map((rule, index) => ('<div class="rule-row"><input class="control" aria-label="' + t("Category ", '类别 ')) + (index + 1) + '" data-rule="name" data-index="' +
      index + ('" placeholder="' + t("Category name", '类别名称') + '" value="') + escapeHtml(rule.name) + '">' +
      ('<input class="control" aria-label="' + t("Keywords ", '关键词 ')) + (index + 1) + '" data-rule="keywords" data-index="' + index +
      ('" placeholder="' + t("Keywords, separated by commas", '关键词，用逗号分隔') + '" value="') + escapeHtml(rule.keywords) + '">' +
      '<label class="check"><input type="checkbox" data-rule="priority" data-index="' + index + '"' + (rule.priority ? ' checked' : '') +
      ('>' + t("High priority", '高优先级') + '</label><button type="button" class="btn icon-btn" data-action="remove-rule" data-value="') + index + ('" aria-label="' + t("Remove category ", '移除类别 ')) +
      (index + 1) + '">' + icon('close') + '</button></div>').join('') +
    '</div>' + action('add-rule', t("Add category", '添加类别'), 'btn-quiet', 'plus');
}

function renderRules() {
  showDialog(t("Classification rules", '分类规则'), rulesBody(), ('<button type="submit" class="btn btn-primary">' + t("Save rules", '保存规则') + '</button>'), 'rules');
}

function showExport(project) {
  const queue = queues(project);
  const options = [
    ['queue', queue.comparing ? t('Both lists, without duplicates', '两份名单合计（已去重）') : t("Current review list", '当前抽查名单'), queue.all.length],
    ['reviewed', t("Reviewed feedback", '已核对反馈'), project.rows.filter((row) => status(project, row.id)).length],
    ['project', t("All project feedback", '项目全部反馈'), project.rows.length],
  ];
  const selected = options.findIndex(([, , count]) => count > 0);
  showDialog(t("Export review results", '导出抽查结果'), '<div class="export-options">' +
    options.map(([id, label, count], index) => '<label class="export-choice"><input type="radio" name="scope" value="' + id + '"' +
      (index === selected ? ' checked' : '') + (count ? '' : ' disabled') + ' data-count="' + count + '"><span>' + label +
      '</span><strong class="num">' + recordCount(count) + '</strong></label>').join('') +
    '</div>', downloadButton(options[selected]?.[2] || 0, selected === -1), 'export');
}

function recordCount(count) {
  return t(fmt(count) + (count === 1 ? ' record' : ' records'), fmt(count) + ' 条记录');
}

function downloadButton(count, disabled = false) {
  return '<button type="submit" class="btn btn-primary"' + (disabled ? ' disabled' : '') + '>' + icon('download') +
    '<span>' + t('Download CSV', '下载 CSV') + '</span><span class="export-button-count" data-export-count>' +
    recordCount(count) + '</span></button>';
}

function downloadFile(filename, text, type = 'text/csv;charset=utf-8') {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([text], { type }));
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadTemplate() {
  downloadFile(t("customer-feedback-template.csv", '客户反馈导入模板.csv'), csvText(fields.map(({ label }) => label),
    [fields.map(({ example }) => example)]));
}

function openTemplateGuide() {
  templateGuide.querySelector('.guide-steps').innerHTML = templateSteps.map((step) => '<li>' + escapeHtml(step) + '</li>').join('');
  templateGuide.querySelector('.guide-fields').innerHTML = fields.map(({ key, label, hint, example }) =>
    '<div><dt>' + escapeHtml(label) + (key === 'text' ? ('<span>' + t("Required", '必填') + '</span>') : '') +
    '</dt><dd><p>' + escapeHtml(hint) + '</p><samp>' + escapeHtml(example) + '</samp></dd></div>').join('');
  templateGuide.showModal();
}

function downloadTemplateGuide() {
  const instructions = templateSteps.map((step, index) => (index + 1) + '. ' + step).join('\r\n');
  const columns = fields.map(({ label, hint, example }) => [label, hint, t("Example: ", '示例  ') + example].join('\r\n')).join('\r\n\r\n');
  downloadFile(t("customer-feedback-csv-guide.txt", '客户反馈 CSV 填报指南.txt'),
    ('\uFEFF' + t("Customer feedback CSV guide", '客户反馈 CSV 填报指南') + '\r\n\r\n') + instructions + ('\r\n\r\n' + t("Columns", '各列怎么填') + '\r\n\r\n') + columns + '\r\n',
    'text/plain;charset=utf-8');
}

function downloadExport(project, scope) {
  if (!['queue', 'reviewed', 'project'].includes(scope)) return;
  const queue = queues(project);
  const items = scope === 'queue' ? queue.all :
    scope === 'reviewed' ? analyzed(project).filter((row) => status(project, row.id)) : analyzed(project);
  if (!items.length) return;
  const titles = [t("Project", '项目'), t("Feedback ID", '反馈编号'), t("Original ticket ID", '原工单号'), t("Feedback text", '反馈正文'), t("Date", '日期'), t("Product or service", '产品或服务'), t("Channel", '渠道'), t("Rating", '评分'), t("Imported labels", '导入标签'), t("Suggested labels", '系统标签'), t("Confirmed labels", '确认标签'),
    t("Review status", '核对状态'), t("Review notes", '核对备注'), t("Reviewed at", '核对时间'), t("Review method", '抽查方式'), t("Primary rank", '主名单顺位'), t("Primary selection reason", '主名单入选原因')];
  if (queue.comparing) titles.push(t("Comparison method", '对照方式'), t("Comparison rank", '对照名单顺位'), t("Comparison selection reason", '对照名单入选原因'));
  const lines = items.map((row) => {
    const saved = project.reviews[row.id];
    const rankA = queue.rankA.get(row.id);
    const rankB = queue.rankB.get(row.id);
    const line = [project.name, row.id, row.reference, row.text, row.date, row.product, row.channel, row.rating, row.tags.join('、'),
      row.topics.join('、'), confirmedTags(saved).join('、'), saved?.done ? t("Reviewed", '已核对') : t("To review", '待核对'), saved?.note, saved?.at,
      strategies[project.settings.a], rankA, rankA ? headlineReason(row, project.settings.a) : ''];
    if (queue.comparing) line.push(strategies[project.settings.b], rankB, rankB ? headlineReason(row, project.settings.b) : '');
    return line;
  });
  downloadFile(project.name.replace(/[\\/:*?"<>|]/g, '_') + t("-review-results.csv", '-抽查结果.csv'), csvText(titles, lines));
  dialog.close();
  notify(t("Exported ", '已导出 ') + fmt(items.length) + t(" feedback records", ' 条反馈'));
}

function showWorkExport(project) {
  const all = workRows(project);
  const filtered = page === 'inbox' && hasWorkFilters(inboxFilters);
  const rows = filtered ? filteredWorkRows(project, all, inboxFilters) : all;
  if (!rows.length) return notify(t("No records match the export filters.", '当前筛选没有可导出的记录'));
  workExportDraft = { projectName: project.name, rows, filtered };
  const title = filtered ? t('Export filtered results', '导出筛选结果') : t('Export project list', '导出项目清单');
  const scope = filtered ? t('All matches across pages', '当前筛选的全部匹配记录（含其他页）') : t('All feedback in this project', '此项目的全部反馈');
  const details = [
    [t('Project', '项目'), escapeHtml(project.name)],
    [t('Export scope', '导出范围'), scope],
    [t('Record count', '记录数量'), recordCount(rows.length)],
  ];
  showDialog(title, '<dl class="export-summary">' + details.map(([label, value]) =>
    '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>').join('') + '</dl>',
    action('close', t('Cancel', '取消')) + downloadButton(rows.length), 'export-work');
}

function exportWork() {
  if (!workExportDraft) return;
  const { projectName, rows, filtered } = workExportDraft;
  const titles = [t("Project", '项目'), t("Feedback ID", '反馈编号'), t("Original ticket ID", '原工单号'), t("Customer feedback", '客户反馈原文'), t("Date", '日期'), t("Product or service", '产品或服务'), t("Channel", '渠道'), t("Rating", '评分'), t("Feedback labels", '反馈标签'),
    t("Priority", '跟进级别'), t("Follow-up reason", '跟进原因'), t("Status", '处理状态'), t("Owner", '负责人'), t("Due date", '截止日期'), t("Follow-up notes", '处理记录'), t("Last updated", '最后更新')];
  const lines = rows.map((row) => {
    const w = row.work;
    return [projectName, row.id, row.reference, row.text, row.date, row.product, row.channel, row.rating,
      row.displayTopics.map(topicLabel).join(t(', ', '、')), workLabel(w.priority), w.reason, workLabel(w.state), w.owner, w.due, w.note, w.updated];
  });
  const suffix = filtered ? t('-filtered-follow-up.csv', '-筛选跟进清单.csv') : t('-follow-up.csv', '-跟进清单.csv');
  downloadFile(projectName.replace(/[\\/:*?"<>|]/g, '_') + suffix, csvText(titles, lines));
  dialog.close();
  notify(t("Exported ", '已导出 ') + fmt(rows.length) + t(" follow-up records", ' 条跟进记录'));
}

function setWorkRequirements(form) {
  form.elements.owner.required = form.elements.state.value === '处理中';
  form.elements.note.required = form.elements.state.value === '已办结';
}

function saveWork(form, data, project) {
  const id = data.get('id');
  const row = analyzed(project).find((item) => item.id === id);
  if (!row) return;
  const prior = getWork(project, row);
  const next = Object.fromEntries(Object.entries(readWorkFields(form)).map(([key, value]) => [key, value.trim()]));
  if (!workStates.includes(next.state) || !['重点', '常规'].includes(next.priority)) return;
  setWorkRequirements(form);
  for (const key of ['owner', 'note']) {
    if (form.elements[key].required && !next[key]) {
      form.elements[key].value = '';
      form.elements[key].reportValidity();
      return;
    }
  }
  const saved = project.followups?.[id];
  const changed = Object.keys(next).some((key) => next[key] !== prior[key]);
  if (saved && !changed) {
    dialog.close();
    return;
  }
  next.history = saved?.history || [];
  if (saved) {
    const { history, ...previous } = saved;
    next.history = [...next.history, { ...previous, priority: prior.priority }];
  }
  if (!saved?.priority && next.priority === prior.priority) delete next.priority;
  next.updated = new Date().toISOString();
  if (!updateProject({ followups: { ...project.followups, [id]: next } }, false)) return showSaveError(form);
  workBaseline = null;
  dialog.close();
  syncWorkGuard();
  render();
  const trigger = main.querySelector('[data-action="handle-feedback"][data-value="' + CSS.escape(id) + '"]');
  (trigger || main).focus({ preventScroll: true });
  notify(t("Follow-up saved.", '已保存处理记录'));
}

function selectProject(id) {
  if (!commitState({ active: id }, false)) {
    state.active = id;
    notify(t('This project selection is available for this visit only.', '当前项目选择仅在本次访问中有效。'));
  }
  resetView();
  setPage('overview');
}

function handleClick(control) {
  const { action: key, value } = control.dataset;
  if (key === 'toggle-language') {
    if (!setLocale(t('zh-CN', 'en'))) {
      return notify(t('Language preference could not be saved.', '无法保存语言设置。'));
    }
    window.history.replaceState({ ...window.history.state, languageView: {
      page, inboxFilters, queueFilter, queuePage, selectedId, topicFilter, topicPage, issueSearch, issueProduct, issueChannel,
    } }, '');
    window.location.reload();
    return;
  }
  if (key === 'logout') return logout();
  const project = activeProject();
  if (key.startsWith('go-')) {
    if (key === 'go-inbox') inboxFilters = { page: 0 };
    return setPage(key.slice(3));
  }
  if (key === 'handle-feedback') {
    const row = workRows(project).find((item) => item.id === value);
    if (!row) return;
    showDialog(t("Handle feedback", '处理反馈'), workEditorHtml(project, row),
      action('close', t("Cancel", '取消')) + ('<button class="btn btn-primary" type="submit">' + t("Save follow-up", '保存跟进记录') + '</button>'), 'work');
    return;
  }
  if (key === 'export-work') return showWorkExport(project);
  if (key.startsWith('inbox-')) {
    const filters = page === 'inbox' ? { ...inboxFilters } : {};
    const alertKeys = { 'inbox-overdue': 'overdue', 'inbox-due-today': 'dueToday', 'inbox-priority-unassigned': 'priorityUnassigned' };
    if (key === 'inbox-clear-alert' && Object.values(alertKeys).includes(value)) {
      delete filters[value];
      inboxFilters = { ...filters, page: 0 };
      render();
      main.querySelector('form[data-form="inbox-filter"] input[type="search"]')?.focus({ preventScroll: true });
      return;
    }
    if (key === 'inbox-state') Object.assign(filters, { state: value || '', openOnly: false });
    if (key === 'inbox-topic') filters.topic = value;
    if (key === 'inbox-priority') Object.assign(filters, { priority: '重点', openOnly: page !== 'inbox' });
    if (key === 'inbox-open') filters.openOnly = true;
    if (alertKeys[key]) filters[alertKeys[key]] = true;
    const lastPage = Math.max(0, Math.ceil(filteredWorkRows(project, workRows(project), filters).length / 10) - 1);
    filters.page = key === 'inbox-next' ? Math.min(lastPage, (filters.page || 0) + 1)
      : key === 'inbox-prev' ? Math.max(0, (filters.page || 0) - 1) : 0;
    inboxFilters = key === 'inbox-reset' ? { page: 0 } : filters;
    if (key === 'inbox-state' && page === 'inbox') {
      render();
      main.querySelector('.fu-tab[aria-pressed="true"]')?.focus({ preventScroll: true });
      return;
    }
    setPage('inbox');
    return;
  }
  if (key === 'toggle-comparison') {
    if (!updateProject({ settings: { ...project.settings, compare: !project.settings.compare } })) return;
    queueFilter = 'all';
    queuePage = 0;
    selectedId = null;
    renderReview(activeProject());
    main.querySelector('[data-action="toggle-comparison"]')?.focus();
  }
  if (key.startsWith('filter-')) {
    queueFilter = key.slice(7);
    queuePage = 0;
    selectedId = null;
    renderReview(project);
    main.querySelector('[data-action="filter-' + queueFilter + '"]')?.focus();
  }
  if (key === 'feedback') {
    selectedId = value;
    renderReview(project);
    const selected = main.querySelector('tr.selected button');
    selected?.focus();
    if (window.innerWidth <= 670) document.querySelector('#feedback-detail')?.scrollIntoView({ block: 'nearest' });
  }
  if (key === 'queue-prev' || key === 'queue-next') {
    queuePage += key === 'queue-next' ? 1 : -1;
    selectedId = null;
    renderReview(project);
    (main.querySelector('[data-action="' + key + '"]:not(:disabled)') || main.querySelector('tr.selected button'))?.focus();
  }
  if (key === 'topic-prev' || key === 'topic-next') {
    topicPage += key === 'topic-next' ? 1 : -1;
    renderIssues(project);
    main.querySelector('[data-action="' + key + '"]:not(:disabled)')?.focus();
  }
  if (key === 'topic' || key === 'reset-issues') {
    topicFilter = value || '';
    topicPage = 0;
    if (key === 'reset-issues') issueSearch = issueProduct = issueChannel = '';
    renderIssues(project);
    main.querySelector('.topic-button[aria-pressed="true"]')?.focus();
  }
  if (key === 'issue-feedback') {
    const row = analyzed(project).find((item) => item.id === value);
    if (!row) return;
    const tags = confirmedTags(project.reviews[value], row.topics);
    showDialog(t("Feedback text", '反馈原文'), '<p class="eyeline muted">' + escapeHtml([row.id, row.date, row.product, row.channel].filter(Boolean).join(' / ')) +
      '</p><div class="quote">' + escapeHtml(row.text) + '</div><p>' + escapeHtml(tags.map(topicLabel).join(' · ') || topicLabel('未分类')) + '</p>',
    '<span></span><button type="button" class="btn btn-primary" data-action="handle-feedback" data-value="' + escapeHtml(value) + ('">' + t("Open follow-up", '处理这条反馈') + '</button>'));
  }
  if (key === 'open-project' || key === 'switch-project') selectProject(value);
  if (key === 'close') return requestWorkExit(() => dialog.close());
  if (key === 'template') downloadTemplate();
  if (key === 'template-guide') openTemplateGuide();
  if (key === 'download-template-guide') downloadTemplateGuide();
  if (key === 'import') {
    importDraft = { workbook: null, sheet: 0, mapping: {}, name: '', file: '', error: '', loading: false };
    renderImport();
  }
  if (key === 'rules') {
    ruleDraft = project.rules.map((rule) => ({ ...rule, keywords: parseTags(rule.keywords).join('，') }));
    renderRules();
  }
  if (key === 'add-rule') {
    ruleDraft.push({ name: '', keywords: '', priority: false });
    renderRules();
    dialog.querySelector('.rule-row:last-child input')?.focus();
  }
  if (key === 'remove-rule') {
    ruleDraft.splice(Number(value), 1);
    renderRules();
  }
  if (key === 'export') showExport(project);
  if (key === 'reopen-review') {
    const review = project.reviews[selectedId];
    if (!review) return;
    if (!updateProject({ reviews: { ...project.reviews, [selectedId]: { ...review, done: false } } })) return;
    renderReview(activeProject());
    notify(t("Marked for review.", '已标为待核对'));
  }
}

document.addEventListener('click', (event) => {
  for (const menu of document.querySelectorAll('.project-menu[open], .account-menu[open]')) {
    if (!menu.contains(event.target)) menu.open = false;
  }
  if (event.target.closest('.skip-link')) {
    event.preventDefault();
    main.focus();
    return;
  }
  const control = event.target.closest('[data-action]');
  if (control) {
    if (workIsDirty() && !dialog.contains(control) && !discardDialog.contains(control)) {
      return requestWorkExit(() => {
        dialog.close();
        handleClick(control);
      });
    }
    handleClick(control);
  }
  else {
    const row = event.target.closest('tr[data-id]');
    if (row) row.querySelector('.text-button')?.click();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || dialog.open || templateGuide.open) return;
  const menu = document.querySelector('.project-menu[open], .account-menu[open]');
  if (menu) {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});

dialog.addEventListener('cancel', (event) => {
  if (!workIsDirty()) return;
  event.preventDefault();
  requestWorkExit(() => dialog.close());
});

dialog.addEventListener('focusin', (event) => {
  if (event.target.matches('form[data-form="work"] :is(input:not([type="hidden"]),select,textarea)')) {
    workFocus = event.target;
  }
});

function resolveWorkExit(discard) {
  const proceed = discardAction;
  discardAction = null;
  discardDialog.close();
  if (discard) {
    workBaseline = null;
    syncWorkGuard();
    proceed?.();
  } else if (workFocus?.isConnected) {
    workFocus.focus({ preventScroll: true });
  }
}

discardDialog.addEventListener('submit', (event) => {
  event.preventDefault();
  resolveWorkExit(event.submitter?.value === 'discard');
});

discardDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  resolveWorkExit(false);
});

dialog.addEventListener('close', () => {
  if (dialog.open) return;
  importDraft = null;
  ruleDraft = null;
  workExportDraft = null;
  workBaseline = null;
  workFocus = null;
  syncWorkGuard();
});

templateGuide.addEventListener('close', () => {
  if (dialog.open) dialog.querySelector('[data-action="template-guide"]')?.focus();
});

async function loadUpload(file) {
  const draft = importDraft;
  if (!file || !draft) return;
  const request = {};
  Object.assign(draft, { request, file: file.name, workbook: null, loading: true, error: '' });
  renderImport();
  try {
    const result = await readSpreadsheet(file);
    if (draft !== importDraft || draft.request !== request) return;
    draft.workbook = result;
    draft.sheet = 0;
    draft.name = file.name.replace(/\.[^.]+$/, '').slice(0, 100) || t("New feedback project", '新反馈项目');
    draft.mapping = guessMapping(result.sheets[0].headers);
  } catch (error) {
    if (draft !== importDraft || draft.request !== request) return;
    draft.error = error.message || t("Could not read the file.", '读取表格失败。');
  }
  draft.loading = false;
  renderImport();
  dialog.querySelector(draft.error ? '#import-file' : '#map-text')?.focus();
}

document.addEventListener('change', (event) => {
  const target = event.target;
  const project = activeProject();
  if (target.form?.dataset.form === 'work') {
    const fields = target.form.elements;
    if (target.name === 'owner' && fields.owner.value.trim() && fields.state.value === '待分派') {
      fields.state.value = '处理中';
    }
    if (target.name === 'state' && fields.state.value === '待分派') fields.owner.value = '';
    setWorkRequirements(target.form);
    syncWorkGuard();
  }
  if (target.form?.dataset.form === 'export' && target.name === 'scope') {
    target.form.querySelector('[data-export-count]').textContent = recordCount(Number(target.dataset.count));
  }
  if (target.id === 'import-target') {
    importDraft.target = target.value;
    importDraft.error = '';
    renderImport();
    dialog.querySelector('#import-target')?.focus();
  }
  if (target.id === 'import-file') loadUpload(target.files[0]);
  if (target.id === 'import-sheet') {
    importDraft.sheet = Number(target.value);
    importDraft.mapping = guessMapping(importDraft.workbook.sheets[importDraft.sheet].headers);
    importDraft.error = '';
    renderImport();
    dialog.querySelector('#import-sheet')?.focus();
  }
  if (target.dataset.map) {
    importDraft.mapping[target.dataset.map] = target.value === '' ? '' : Number(target.value);
    if (target.dataset.map === 'text') markImportColumn();
  }
  if (target.id === 'budget' || target.dataset.plan) {
    const settings = { ...project.settings };
    if (target.id === 'budget') settings.budget = Math.min(project.rows.length, Math.max(0, Math.round(Number(target.value) || 0)));
    else settings[target.dataset.plan] = target.value;
    if (!updateProject({ settings })) {
      target.value = target.id === 'budget' ? queues(project).budget : project.settings[target.dataset.plan];
      return;
    }
    queuePage = 0;
    selectedId = null;
    const shouldFocus = target === document.activeElement;
    renderReview(activeProject());
    if (shouldFocus) document.getElementById(target.id)?.focus();
  }
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (target.form?.dataset.form === 'work') syncWorkGuard();
  if (target.id === 'import-name') importDraft.name = target.value;
  if (target.dataset.rule) {
    const row = ruleDraft[Number(target.dataset.index)];
    row[target.dataset.rule] = target.type === 'checkbox' ? target.checked : target.value;
  }
});

async function importProject() {
  const draft = importDraft;
  const sheet = draft.workbook?.sheets[draft.sheet];
  if (!sheet || draft.saving) return;
  const target = state.projects.find((project) => project.id === draft.target);
  const name = target?.name || draft.name.trim();
  if (!name || draft.mapping.text === '') {
    draft.error = t("Enter a project name and select the feedback text column.", '请填写项目名称并选择正文列。');
    return renderImport();
  }
  const rows = [];
  const known = new Set((target?.rows || []).map((row) => row.reference).filter(Boolean));
  const existingIds = new Set((target?.rows || []).map((row) => row.id));
  const previousCount = target?.rows.length || 0;
  let sequence = previousCount;
  let blank = 0;
  let duplicate = 0;
  for (const cells of sheet.rows) {
    const text = String(cells[draft.mapping.text] ?? '');
    if (!text.trim()) {
      blank++;
      continue;
    }
    const row = { text };
    for (const { key: field } of fields.slice(1)) {
      const value = String(cells[draft.mapping[field]] ?? '').trim();
      row[field] = field === 'tags' ? parseTags(value) : value;
    }
    if (row.reference && known.has(row.reference)) {
      duplicate++;
      continue;
    }
    if (row.reference) known.add(row.reference);
    do { row.id = 'F-' + String(++sequence).padStart(4, '0'); } while (existingIds.has(row.id));
    rows.push(row);
  }
  if (!rows.length) {
    draft.error = duplicate ? t("The ticket IDs already exist in this project. No records were added.", '这批反馈的工单号已在项目中，无新增记录。') : t("The selected column has no feedback text. Check the column mapping.", '所选正文列没有有效反馈，请检查映射。');
    return renderImport();
  }
  draft.saving = true;
  renderImport();
  try {
    const signature = await batchSignature(sheet, draft.mapping);
    if (draft !== importDraft || !dialog.open) return;
    if (target && signature && target.batches?.some((batch) => batch.signature === signature)) {
      draft.error = t("This batch was already imported into this project.", '该批反馈已导入当前项目。');
      draft.saving = false;
      return renderImport();
    }
    const id = target?.id || globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const batch = { file: draft.file, sheet: sheet.name, count: rows.length, at: new Date().toISOString(), signature };
    const projects = target ? state.projects.map((item) => item.id === target.id ?
      { ...item, rows: [...item.rows, ...rows], batches: [...(item.batches || []), batch] } : item) :
      [{ id, name, source: draft.file, rows, rules: DEFAULT_RULES, reviews: {}, followups: {}, batches: [batch],
        settings: { budget: Math.max(1, Math.min(30, Math.ceil(rows.length * 0.1))), a: 'joint', b: 'impact' } }, ...state.projects];
    if (!commitState({ projects, active: id }, false)) {
      draft.saving = false;
      draft.error = saveFailure;
      renderImport();
      dialog.querySelector('[role="alert"]')?.focus();
      return;
    }
    dialog.close();
    resetView();
    setPage('overview');
    notify(t("Added ", '新增 ') + fmt(rows.length) + t(" feedback records", ' 条反馈') +
      (blank ? t(", skipped blank feedback: ", '，跳过空白正文 ') + fmt(blank) + t(" items", ' 条') : '') + (duplicate ? t(", skipped duplicate tickets: ", '，跳过重复工单 ') + fmt(duplicate) + t(" items", ' 条') : ''));
  } catch {
    draft.saving = false;
    draft.error = t("The import did not finish. Please try again.", '本次导入未完成，请重试。');
    if (draft === importDraft && dialog.open) renderImport();
  }
}

async function batchSignature(sheet, mapping) {
  if (!globalThis.crypto?.subtle) return '';
  const normalized = sheet.rows.map((cells) => fields.map(({ key }) => String(cells[mapping[key]] ?? '').trim()));
  const bytes = new TextEncoder().encode(JSON.stringify(normalized));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const data = new FormData(form);
  const project = activeProject();
  if (form.dataset.form === 'work') return saveWork(form, data, project);
  if (form.dataset.form === 'inbox-filter') {
    inboxFilters = { ...inboxFilters, page: 0 };
    for (const field of ['search','owner','priority','topic']) inboxFilters[field] = String(data.get(field) ?? '').trim();
    for (const field of ['overdue', 'openOnly', 'dueToday', 'priorityUnassigned']) inboxFilters[field] = data.has(field);
    if (data.has('state')) inboxFilters.state = String(data.get('state'));
    return render();
  }
  if (form.dataset.form === 'import') importProject();
  if (form.dataset.form === 'export') downloadExport(project, data.get('scope'));
  if (form.dataset.form === 'export-work') exportWork();
  if (form.dataset.form === 'review') {
    const id = data.get('id');
    const next = { tags: getReviewTags(form), note: String(data.get('note')).trim(), done: true, at: new Date().toISOString() };
    if (!updateProject({ reviews: { ...project.reviews, [id]: next } }, false)) return showSaveError(form);
    renderReview(activeProject());
    (main.querySelector('.details-form button[type="submit"]') ||
      main.querySelector('.queue-tabs [aria-pressed="true"]'))?.focus();
    notify(t("Review saved.", '已保存核对结果'));
  }
  if (form.dataset.form === 'rules') {
    const rules = ruleDraft.filter((rule) => rule.name.trim()).map((rule) =>
      ({ name: rule.name.trim(), keywords: parseTags(rule.keywords), priority: rule.priority }));
    if (!updateProject({ rules }, false)) return showSaveError(form);
    queuePage = topicPage = 0;
    selectedId = null;
    topicFilter = '';
    dialog.close();
    render();
    notify(t("Labels and rules saved.", '已应用标签与规则'));
  }
  if (form.dataset.form === 'issue-search') {
    issueSearch = String(data.get('q') || '').trim();
    issueProduct = String(data.get('product') || '');
    issueChannel = String(data.get('channel') || '');
    topicPage = 0;
    topicFilter = '';
    renderIssues(project);
  }
});

async function logout() {
  try {
    const response = await fetch('./api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok && response.status !== 401) throw new Error('Sign-out failed');
    window.location.replace('./');
  } catch {
    notify(t('Could not sign out. Try again.', '退出失败，请重试。'));
  }
}

localizeDocument();
if (account) {
  render();
  if (storageReadFailed) notify(t('Stored projects could not be read. Check browser storage and reload.',
    '暂时无法读取已保存的项目。请检查浏览器存储后刷新。'));
} else if (sessionResponse) {
  window.location.replace('./?next=workspace' + window.location.hash);
} else {
  main.innerHTML = '<p class="empty" role="alert">' + t('The sign-in service is unavailable. Reload to try again.', '登录服务暂时无法连接，请刷新页面。') + '</p>';
}
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
