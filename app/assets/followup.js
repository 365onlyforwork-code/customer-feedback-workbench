import { t, locale, topicLabel } from './i18n.js';

export const workStates = ['待分派', '处理中', '已办结', '无需跟进'];
const priorities = ['重点', '常规'];
const pageSize = 10;

const phaseClass = {
  '待分派': 'waiting',
  '处理中': 'progress',
  '已办结': 'complete',
  '无需跟进': 'archived',
};

const workLabels = new Map([
  ['待分派', 'Unassigned'], ['处理中', 'In progress'], ['已办结', 'Closed'],
  ['无需跟进', 'No follow-up'], ['重点', 'High'], ['常规', 'Normal'],
]);

export function workLabel(value) {
  return t(workLabels.get(value) ?? value, value);
}

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function localDate() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

function isOpen(work) {
  return work.state === '待分派' || work.state === '处理中';
}

export function isWorkOverdue(work, today = localDate()) {
  return Boolean(isOpen(work) && work.due && work.due < today);
}

export function isWorkDueToday(work, today = localDate()) {
  return isOpen(work) && work.due === today;
}

export function isPriorityUnassigned(work) {
  return work.priority === '重点' && work.state === '待分派';
}

export function getWork(project, row) {
  const saved = project.followups?.[row.id] ?? {};
  const cues = row.impactCues ?? [];
  const topics = row.priorityTopics ?? [];
  const suggested = cues.length || topics.length ? '重点' : '常规';
  const priority = priorities.includes(saved.priority) ? saved.priority : suggested;
  const evidence = [];
  if (cues.length) evidence.push(t(
    'The customer mentioned ' + cues.map((cue) => '“' + cue + '”').join(', ') + '. Verify the details',
    '客户提到“' + cues.join('、') + '”，需核实实际情况',
  ));
  if (topics.length) evidence.push(t(
    'A project rule gives high priority to ' + topics.map(topicLabel).join(', '),
    '项目将“' + topics.join('、') + '”列为重点跟进事项',
  ));
  if (priority !== suggested) evidence.push(t(
    'Priority was manually set to ' + workLabel(priority).toLowerCase(),
    '已手动标为' + priority + '跟进',
  ));
  return {
    state: workStates.includes(saved.state) ? saved.state : '待分派',
    priority,
    reason: evidence.join(t('. ', '。')),
    owner: String(saved.owner ?? '').trim(),
    due: /^\d{4}-\d{2}-\d{2}$/.test(saved.due ?? '') ? saved.due : '',
    note: String(saved.note ?? ''),
    updated: String(saved.updated ?? ''),
  };
}

function rowTopics(row) {
  const values = row.displayTopics ?? row.topics ?? [];
  return values.length ? values : ['未分类'];
}

function options(values, selected, firstLabel, display = (value) => value) {
  const all = firstLabel === undefined ? [] : ['<option value="">' + escape(firstLabel) + '</option>'];
  for (const value of values) {
    all.push('<option value="' + escape(value) + '"' + (value === selected ? ' selected' : '') + '>' + escape(display(value)) + '</option>');
  }
  return all.join('');
}

function optionsFrom(values, selected) {
  const unique = new Set(values.filter(Boolean));
  if (selected) unique.add(selected);
  return [...unique].sort((a, b) => a.localeCompare(b, locale));
}

function matchingRows(rows, filters, today) {
  const term = String(filters.search || '').trim().toLocaleLowerCase();
  return rows.filter((row) => {
    const work = row.work;
    if (filters.openOnly && !isOpen(work)) return false;
    if (filters.overdue && !isWorkOverdue(work, today)) return false;
    if (filters.dueToday && !isWorkDueToday(work, today)) return false;
    if (filters.priorityUnassigned && !isPriorityUnassigned(work)) return false;
    if (filters.priority && filters.priority !== work.priority) return false;
    if (filters.topic && !rowTopics(row).includes(filters.topic)) return false;
    if (filters.owner && filters.owner !== work.owner) return false;
    if (term) {
      const topics = rowTopics(row);
      const searchText = [row.id, row.reference, row.text, row.product, row.channel, work.note, work.owner, ...topics,
        ...(locale === 'en' ? topics.map(topicLabel) : [])].join(' ').toLocaleLowerCase();
      return searchText.includes(term);
    }
    return true;
  });
}

function sorted(rows, today) {
  return rows.slice().sort((a, b) => {
    const left = a.work;
    const right = b.work;
    return Number(isOpen(right)) - Number(isOpen(left)) ||
      Number(isWorkOverdue(right, today)) - Number(isWorkOverdue(left, today)) ||
      Number(right.priority === '重点') - Number(left.priority === '重点') ||
      (left.due || '9999').localeCompare(right.due || '9999');
  });
}

function withWork(project, rows) {
  return rows.map((row) => row.work ? row : { ...row, work: getWork(project, row) });
}

export function hasWorkFilters(filters = {}) {
  return Boolean(filters.state || filters.priority || filters.owner || filters.topic || filters.overdue ||
    filters.openOnly || filters.dueToday || filters.priorityUnassigned || String(filters.search || '').trim());
}

export function filteredWorkRows(project, rows, filters = {}) {
  const today = localDate();
  const matches = matchingRows(withWork(project, rows), filters, today);
  const inState = filters.state ? matches.filter((row) => row.work.state === filters.state) : matches;
  return sorted(inState, today);
}

function statePill(state) {
  return '<span class="fu-pill fu-' + phaseClass[state] + '">' + escape(workLabel(state)) + '</span>';
}

function priorityLabel(priority) {
  return priority === '重点'
    ? '<span class="fu-priority"><i aria-hidden="true"></i>' + workLabel(priority) + '</span>'
    : '<span class="fu-normal">' + workLabel(priority) + '</span>';
}

function tableRow(row, today) {
  const work = row.work;
  const topics = rowTopics(row).map(topicLabel);
  const overdue = isWorkOverdue(work, today);
  const dueToday = isWorkDueToday(work, today);
  const reference = row.reference || row.id;
  const source = [row.channel, row.product, row.date].filter(Boolean).join(' · ');
  const tags = topics.join(t(', ', '、'));
  const summary = String(row.text ?? '').trim().replace(/\s+/gu, ' ').replace(/^(.{160}).+$/u, '$1…');
  const open = ' data-action="handle-feedback" data-value="' + escape(row.id) + '"';
  return '<tr class="fu-item' + (overdue ? ' fu-item-late' : '') + '">' +
    '<td class="fu-subject"><button class="fu-summary" type="button"' + open + ' aria-haspopup="dialog">' + escape(summary) + '</button>' +
      '<div class="fu-meta"><span title="' + escape(reference) + '">' + escape(reference) + '</span>' +
      (source ? '<span title="' + escape(source) + '">' + escape(source) + '</span>' : '') +
      '<span class="fu-classify" title="' + escape(tags) + '">' + escape(tags) + '</span></div></td>' +
    '<td class="fu-state-cell">' + statePill(work.state) + '</td>' +
    '<td class="fu-person" data-label="' + t('Owner', '负责人') + '">' +
      (work.owner ? '<span class="fu-owner-name" title="' + escape(work.owner) + '">' + escape(work.owner) + '</span>' :
        '<span class="fu-muted">' + t('Unassigned', '未指定') + '</span>') + '</td>' +
    '<td class="fu-deadline' + (overdue ? ' fu-late' : '') + '" data-label="' + t('Due date', '截止日期') + '">' +
      (work.due ? '<time datetime="' + escape(work.due) + '">' + escape(work.due) + '</time>' :
        '<span class="fu-muted" aria-label="' + t('No due date', '未设截止日期') + '">—</span>') +
      (overdue ? '<small>' + t('Overdue', '已逾期') + '</small>' : '') +
      (dueToday ? '<small class="fu-due-today">' + t('Due today', '今日到期') + '</small>' : '') + '</td>' +
    '<td class="fu-priority-cell">' + priorityLabel(work.priority) + '</td></tr>';
}

function activeAlerts(filters) {
  const alerts = [
    ['overdue', t('Overdue', '已逾期')], ['dueToday', t('Due today', '今日到期')],
    ['priorityUnassigned', t('High priority, unassigned', '重点待分派')],
  ];
  const selected = alerts.filter(([field]) => filters[field]);
  if (!selected.length) return '';
  return '<div class="fu-alert-filters" role="group" aria-label="' + t('Active alert filters', '当前预警筛选') + '">' + selected.map(([field, label]) =>
    (field === 'overdue' ? '' : '<input type="hidden" name="' + field + '" value="1">') +
    '<button type="button" class="fu-alert-chip" data-action="inbox-clear-alert" data-value="' + field +
    '" aria-label="' + t('Clear filter: ' + label, '取消' + label + '筛选') + '">' + label + '<span aria-hidden="true">×</span></button>'
  ).join('') + '</div>';
}

function filterForm(rows, filters) {
  const owners = optionsFrom(rows.map((row) => row.work.owner), filters.owner);
  const topics = optionsFrom(rows.flatMap(rowTopics), filters.topic);
  return '<form class="fu-filter" data-form="inbox-filter"><div class="fu-filter-fields">' +
    '<label class="fu-search"><input class="control" name="search" type="search" aria-label="' + t('Search feedback', '搜索反馈') +
    '" maxlength="400" placeholder="' + t('Search feedback, ticket IDs or notes', '搜索原文、工单号或处理记录') + '" value="' + escape(filters.search) + '"></label>' +
    '<label><select class="control" name="owner" aria-label="' + t('Owner', '负责人') + '">' + options(owners, filters.owner, t('All owners', '全部负责人')) + '</select></label>' +
    '<label><select class="control" name="topic" aria-label="' + t('Feedback tag', '反馈标签') + '">' + options(topics, filters.topic, t('All tags', '全部标签'), topicLabel) + '</select></label>' +
    '<label><select class="control" name="priority" aria-label="' + t('Priority', '跟进级别') + '">' + options(priorities, filters.priority, t('All priorities', '全部级别'), workLabel) + '</select></label></div>' +
    '<div class="fu-filter-tools"><div class="fu-filter-checks"><label><input type="checkbox" name="openOnly" value="1"' + (filters.openOnly ? ' checked' : '') + '>' + t('Open only', '仅待办') + '</label>' +
    '<label><input type="checkbox" name="overdue" value="1"' + (filters.overdue ? ' checked' : '') + '>' + t('Overdue only', '仅逾期') + '</label></div>' +
    '<div class="fu-filter-actions"><button type="submit" class="btn btn-primary">' + t('Apply filters', '筛选') + '</button>' +
    '<button type="button" class="btn btn-quiet" data-action="inbox-reset">' + t('Reset', '重置') + '</button></div></div>' + activeAlerts(filters) + '</form>';
}

function stateTabs(rows, currentState) {
  const counts = new Map(workStates.map((state) => [state, 0]));
  for (const row of rows) counts.set(row.work.state, counts.get(row.work.state) + 1);
  return '<div class="fu-states" role="group" aria-label="' + t('Filter by status', '按处理状态筛选') + '">' + ['', ...workStates].map((state) =>
    '<button class="fu-tab" type="button" aria-pressed="' + ((currentState || '') === state) + '" data-action="inbox-state" data-value="' +
    state + '">' + (state ? workLabel(state) : t('All', '全部')) + '<span>' + (state ? counts.get(state) : rows.length).toLocaleString(locale) + '</span></button>'
  ).join('') + '</div>';
}

export function inboxHtml(project, rows, filters = {}) {
  const items = withWork(project, rows);
  const today = localDate();
  const matches = matchingRows(items, filters, today);
  const filtered = sorted(filters.state ? matches.filter((row) => row.work.state === filters.state) : matches, today);
  const maxPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const page = Math.min(maxPage, Math.max(0, Math.trunc(Number(filters.page) || 0)));
  const start = page * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);
  const count = filtered.length.toLocaleString(locale);
  const exportLabel = hasWorkFilters(filters) ? t('Export filtered results', '导出筛选结果') : t('Export project list', '导出项目清单');
  const countLabel = t(count + (filtered.length === 1 ? ' record' : ' records'), count + ' 条反馈');
  const tableLabel = t('Follow-up list', '反馈跟进清单');
  const columns = [t('Customer feedback', '客户反馈'), t('Status', '处理状态'), t('Owner', '负责人'), t('Due date', '截止日期'), t('Priority', '跟进级别')];
  const table = pageRows.length ?
    '<div class="table-wrap fu-table-wrap"><table class="fu-table" aria-label="' + tableLabel + '"><thead><tr>' +
    columns.map((heading) => '<th scope="col">' + heading + '</th>').join('') + '</tr></thead><tbody>' +
    pageRows.map((row) => tableRow(row, today)).join('') + '</tbody></table></div>' +
    '<div class="fu-pagination"><span>' + (start + 1) + '–' + (start + pageRows.length) + t(' of ' + count, ' 条，共 ' + count + ' 条') + '</span>' +
    '<div class="row"><button class="btn" type="button" data-action="inbox-prev"' + (page === 0 ? ' disabled' : '') + '>' + t('Previous', '上一页') + '</button>' +
    '<button class="btn" type="button" data-action="inbox-next"' + (page === maxPage ? ' disabled' : '') + '>' + t('Next', '下一页') + '</button></div></div>' :
    '<div class="fu-empty"><h3>' + (items.length ? t('No matching feedback', '没有符合条件的反馈') : t('No feedback in this project yet', '项目暂时没有反馈')) + '</h3>' +
    (items.length ? '' : '<button type="button" class="btn" data-action="import">' + t('Import spreadsheet', '导入表格') + '</button>') + '</div>';
  return '<div class="fu-inbox"><div class="page-head desk-page-head"><h1>' + t('Feedback inbox', '反馈跟进') + '</h1>' +
    '<button type="button" class="btn fu-export" data-action="export-work" aria-label="' + exportLabel + '" aria-description="' + countLabel + '"' +
    (filtered.length ? '' : ' disabled') + '><span>' + exportLabel + '</span><span class="fu-export-count" aria-hidden="true">' + count + '</span></button></div>' +
    '<section class="panel" aria-label="' + tableLabel + '"><div class="fu-toolbar">' + stateTabs(matches, filters.state) + '</div>' +
    filterForm(items, filters) + table + '</section></div>';
}

function workHistory(items) {
  if (!items?.length) return '';
  return '<details class="fu-history"><summary>' + t('Activity history (' + items.length + ')', '处理历史（' + items.length + '）') + '</summary><ol>' +
    items.slice().reverse().map((item) => {
      const time = new Date(item.updated);
      const date = Number.isNaN(time.getTime()) ? '' : time.toLocaleString(locale, { hour12: false });
      return '<li><strong>' + escape([workLabel(item.state), item.owner].filter(Boolean).join(' · ')) + '</strong>' +
        '<small>' + escape([date, item.due && t('Due ', '截止 ') + item.due].filter(Boolean).join(' / ')) + '</small>' +
        '<p>' + escape(item.note) + '</p></li>';
    }).join('') + '</ol></details>';
}

export function workEditorHtml(project, row) {
  const work = row.work ?? getWork(project, row);
  const topics = rowTopics(row).map(topicLabel);
  const text = String(row.text ?? '');
  const longQuote = text.length > 180 || text.split('\n').length > 4;
  const owners = optionsFrom(Object.values(project.followups || {}).map((entry) => entry?.owner).filter(Boolean), work.owner);
  const source = [
    [t('Feedback ID', '反馈编号'), row.id], [t('Original ticket ID', '原工单号'), row.reference],
    [t('Product', '产品'), row.product], [t('Channel', '渠道'), row.channel],
    [t('Feedback date', '反馈日期'), row.date], [t('Customer rating', '客户评分'), row.rating],
  ];
  const sourceDetails = '<details class="fu-source-box"><summary>' + t('Feedback source', '反馈来源') + '</summary><dl class="fu-source">' +
    source.filter(([, value]) => value !== '' && value != null).map(([name, value]) =>
      '<div><dt>' + name + '</dt><dd>' + escape(value) + '</dd></div>').join('') + '</dl></details>';
  const quote = t('Original feedback', '客户原文');
  const required = '<span class="fu-required" aria-hidden="true">' + t(' · Required', ' · 必填') + '</span>';
  return '<div class="fu-editor"><input type="hidden" name="id" value="' + escape(row.id) + '">' +
    '<section class="fu-evidence" aria-label="' + quote + '"><h3>' + quote + '</h3>' +
    '<blockquote' + (longQuote ? ' tabindex="0" aria-label="' + t('Full customer feedback', '完整客户原文') + '"' : '') + '>' + escape(text) + '</blockquote>' +
    '<div class="fu-topic-line" aria-label="' + t('Feedback tags', '反馈标签') + '">' + topics.map((topic) => '<span>' + escape(topic) + '</span>').join('') + '</div>' +
    (work.reason ? '<p class="fu-reason"><b>' + t('Reason for follow-up', '跟进原因') + '</b> ' + escape(work.reason) + '</p>' : '') +
    '</section><div class="fu-fields"><label class="fu-wide-field">' + t('Status', '处理状态') + '<select class="control" name="state">' + options(workStates, work.state, undefined, workLabel) + '</select></label>' +
      '<label>' + t('Priority', '跟进级别') + '<select class="control" name="priority">' + options(priorities, work.priority, undefined, workLabel) + '</select></label>' +
      '<label class="fu-wide-field"><span>' + t('Owner', '负责人') + required + '</span><input class="control" name="owner" list="fu-known-owners" maxlength="80" placeholder="' +
      t('Name or team', '姓名或团队') + '" value="' + escape(work.owner) + '"' + (work.state === '处理中' ? ' required' : '') + '></label>' +
      '<datalist id="fu-known-owners">' + owners.map((name) => '<option value="' + escape(name) + '"></option>').join('') + '</datalist>' +
      '<label>' + t('Due date', '截止日期') + '<input type="date" class="control" name="due" value="' + escape(work.due) + '"></label>' +
      '<label class="fu-notes"><span>' + t('Follow-up notes', '处理记录') + required + '</span>' +
      '<textarea class="control" name="note" rows="3" maxlength="2500" placeholder="' + t('Next action or resolution', '下一步行动或处理结果') + '"' +
      (work.state === '已办结' ? ' required' : '') + '>' + escape(work.note) + '</textarea></label></div>' +
      '<div class="fu-details">' + sourceDetails + workHistory(project.followups?.[row.id]?.history) + '</div></div>';
}
