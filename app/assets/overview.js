import { t, locale, topicLabel } from './i18n.js';
import { workLabel, workStates, isWorkOverdue, isWorkDueToday, isPriorityUnassigned } from './followup.js';

const dayInMilliseconds = 86400000;
const overviewNumber = new Intl.NumberFormat(locale);

function safeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function countLabel(value) {
  return overviewNumber.format(value);
}

function itemCount(count) {
  return countLabel(count) + t(count === 1 ? ' item' : ' items', ' 条');
}

function localDay() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

// Keep the calendar date as written by the source, including when the timestamp has a zone.
function parseDatedFeedback(raw) {
  const value = String(raw ?? '').trim();
  const plain = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/u.exec(value);
  const chinese = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/u.exec(value);
  const stamped = /^(\d{4})-(\d{2})-(\d{2})[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/u.exec(value);
  const parts = plain ? [plain[1], plain[3], plain[4]] : (chinese || stamped)?.slice(1);
  if (!parts) return null;
  const [year, month, day] = parts.map(Number);
  if (year < 1000) return null;
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return time;
}

function recentActivity(rows) {
  const amounts = new Map();
  let undated = 0;
  let latest = null;
  for (const row of rows) {
    const time = parseDatedFeedback(row.date);
    if (time === null) {
      undated += 1;
      continue;
    }
    latest = latest === null ? time : Math.max(latest, time);
    amounts.set(time, (amounts.get(time) || 0) + 1);
  }
  if (latest === null) return { days: [], periodTotal: 0, undated };
  const days = Array.from({ length: 14 }, (_, index) => {
    const time = latest - (13 - index) * dayInMilliseconds;
    return { date: new Date(time).toISOString().slice(0, 10), count: amounts.get(time) || 0 };
  });
  return { days, periodTotal: days.reduce((sum, day) => sum + day.count, 0), undated };
}

function quantityScale(max) {
  const targetStep = Math.max(1, max / 3);
  const unit = 10 ** Math.floor(Math.log10(targetStep));
  const step = [1, 2, 5, 10].find((candidate) => candidate * unit >= targetStep) * unit;
  const ceiling = Math.ceil(max / step) * step;
  return { step, ceiling };
}

function activityChart({ days, periodTotal, undated }, total) {
  if (!days.length) return '<section class="ops-panel insight-no-dates"><div class="ops-panel-head"><h2>' + t('Feedback volume', '反馈量趋势') + '</h2></div><p class="ops-empty">' +
    (total ? t('No valid feedback dates', '缺少有效日期') : t('No feedback yet', '暂无反馈')) + '</p></section>';
  const { step, ceiling } = quantityScale(Math.max(...days.map((day) => day.count)));
  const baseline = 95;
  const yFor = (count) => (baseline - 90 * count / ceiling).toFixed(3);
  const xFor = (index) => index * 100 + 50;
  const line = days.map((day, index) => (index ? 'L ' : 'M ') + xFor(index) + ' ' + yFor(day.count)).join(' ');
  const grid = [];
  for (let tick = 0; tick <= ceiling; tick += step) {
    grid.push('<div class="trend-tick" style="top:' + yFor(tick) + '%"><span>' + countLabel(tick) + '</span></div>');
  }
  const daysHtml = days.map((day, index) => {
    const desc = day.date + t(', ' + itemCount(day.count), '，' + countLabel(day.count) + ' 条反馈');
    return '<li class="insight-day" aria-label="' + desc + '" title="' + desc + '">' +
      '<input class="insight-pick" type="radio" id="insight-day-' + index + '" name="insight-day" aria-label="' + desc + '">' +
      '<label for="insight-day-' + index + '" class="insight-stick" style="--point-y:' + yFor(day.count) +
      '%"><i aria-hidden="true"></i></label><span class="insight-readout" aria-hidden="true">' + desc + '</span></li>';
  }).join('');
  const dates = [0, 3, 6, 9, 13].map((index) => '<span style="grid-column:' + (index + 1) + '">' +
    days[index].date.slice(5).replace('-', '/') + '</span>').join('');
  const range = locale === 'en' ? new Intl.DateTimeFormat('en', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).formatRange(new Date(days[0].date), new Date(days[13].date)) :
    days[0].date.replaceAll('-', '.') + ' – ' + days[13].date.replaceAll('-', '.');
  const missing = undated ? '<small>' + t(itemCount(undated) + ' without a valid date', countLabel(undated) + ' 条缺少有效日期') + '</small>' : '';
  const amount = '<strong>' + countLabel(periodTotal) + '</strong>';
  return '<figure class="ops-panel insight-chart"><figcaption><h2>' + t('Feedback volume', '反馈量趋势') + '</h2>' +
    '<div class="insight-count"><span>' + t('Total ' + amount, '合计 ' + amount + ' 条') + '</span>' + missing + '</div>' +
    '<div class="insight-period"><span class="insight-range">' + range + '</span>' +
    '<span>' + t('14 days ending on the latest feedback date', '截至最新反馈日期的 14 天') + '</span></div></figcaption>' +
    '<fieldset class="chart-mode" aria-label="' + t('Chart type', '图表类型') + '">' +
    '<label><input type="radio" name="volume-chart-type" value="columns" checked><span>' + t('Bars', '柱形') + '</span></label>' +
    '<label><input type="radio" name="volume-chart-type" value="line"><span>' + t('Line', '折线') + '</span></label></fieldset>' +
    '<div class="insight-plot"><div class="trend-grid" aria-hidden="true">' + grid.join('') + '</div>' +
    '<svg class="trend-graph" viewBox="0 0 1400 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    '<path class="trend-line" d="' + line +
    '" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>' +
    '<ol>' + daysHtml + '</ol></div><div class="insight-x" aria-hidden="true">' + dates + '</div></figure>';
}

function kpi(label, count, type, action, value = '', extraClass = '') {
  return '<button type="button" class="ops-kpi kpi-' + type + extraClass + (count ? ' has-feedback' : '') +
    '" data-action="' + action + '" data-value="' + safeText(value) +
    '" aria-label="' + label + t(', ', '，') + itemCount(count) + '"><span class="kpi-title">' + label +
    '</span><strong>' + countLabel(count) + '</strong></button>';
}

function deadlineOrder(work, today) {
  if (isWorkOverdue(work, today)) return 0;
  return isWorkDueToday(work, today) ? 1 : 2;
}

function alertRow(label, items, detail, action, type, detailDate = '') {
  const date = detailDate ? ' <time datetime="' + safeText(detailDate) + '">' + safeText(detailDate) + '</time>' : '';
  return '<button type="button" class="ops-warning' + (items.length ? ' has-' + type : ' clear-warning') +
    '" data-action="' + action + '" aria-label="' + label + t(', ', '，') + itemCount(items.length) + '"' +
    (detail ? ' aria-describedby="overview-' + type + '-detail"' : '') + '>' +
    '<span class="warning-description"><strong>' + label + '</strong>' +
    (detail ? '<small id="overview-' + type + '-detail">' + safeText(detail) + date + '</small>' : '') + '</span><b>' + countLabel(items.length) + '</b></button>';
}

function alertsHtml(alerts, today) {
  const earliest = alerts.overdue.reduce((first, row) => !first || row.work.due < first ? row.work.due : first, '');
  const dueOwners = [...new Set(alerts.due.map((row) => row.work.owner || workLabel('待分派')))];
  const products = [...new Set(alerts.unassigned.map((row) => row.product).filter(Boolean))];
  const date = locale === 'en'
    ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(today))
    : Number(today.slice(5, 7)) + ' 月 ' + Number(today.slice(8)) + ' 日';
  return '<section class="ops-panel ops-warnings"><div class="ops-panel-head"><h2>' + t('Work alerts', '处置预警') + '</h2><time datetime="' + today + '">' +
    date + '</time></div><div class="warning-rows">' +
    alertRow(t('Overdue', '逾期未办结'), alerts.overdue, earliest ? t('Earliest due date', '最早截止') : '', 'inbox-overdue', 'late', earliest) +
    alertRow(t('Due today', '今日到期'), alerts.due, dueOwners.slice(0, 2).join(' · '), 'inbox-due-today', 'due') +
    alertRow(t('High priority, unassigned', '重点待分派'), alerts.unassigned, products.slice(0, 2).join(' · '), 'inbox-priority-unassigned', 'unassigned') +
    '</div></section>';
}

function workOrder(rows, today) {
  return rows.slice().sort((a, b) => deadlineOrder(a.work, today) - deadlineOrder(b.work, today) ||
    Number(b.work.priority === '重点') - Number(a.work.priority === '重点') ||
    (a.work.due || '9999-12-31').localeCompare(b.work.due || '9999-12-31') ||
    (b.impact ?? 0) - (a.impact ?? 0) || String(a.id).localeCompare(String(b.id)));
}

function workItem(row, today) {
  const work = row.work;
  const overdue = isWorkOverdue(work, today);
  const dueToday = isWorkDueToday(work, today);
  const source = [row.reference && '<span class="ops-reference">' + safeText(row.reference) + '</span>',
    safeText(row.channel), safeText(row.product)].filter(Boolean).join(' · ');
  const due = work.due ? '<time datetime="' + safeText(work.due) + '">' + safeText(work.due) + '</time>' : '—';
  const dueState = overdue ? '<small class="case-late">' + t('Overdue', '已逾期') + '</small>' :
    dueToday ? '<small class="case-today">' + t('Due today', '今日到期') + '</small>' : '';
  const priority = '<span class="' + (work.priority === '重点' ? 'case-priority' : 'case-normal') + '">' + safeText(workLabel(work.priority)) + '</span>';
  const urgency = overdue ? ' ops-item-late' : dueToday ? ' ops-item-today' : '';
  return '<button class="ops-item' + urgency + '" type="button" aria-haspopup="dialog" data-action="handle-feedback" data-value="' + safeText(row.id) + '">' +
    '<span class="ops-case"><strong class="ops-case-text">' + safeText(row.text) + '</strong>' +
      '<small class="ops-case-source">' + (!row.reference ? '<span class="ops-reference">' + safeText(row.id) + '</span>' + (source ? ' · ' : '') : '') + source + '</small></span>' +
    '<span class="ops-priority">' + priority + '</span><span class="ops-item-details"><span class="ops-owner"><span class="ops-mobile-label">' + t('Owner ', '负责人 ') +
    '</span>' + safeText(work.owner || workLabel('待分派')) + '</span><span class="ops-deadline">' + due + dueState + '</span></span></button>';
}

function agendaSection(rows, today) {
  const items = workOrder(rows, today).slice(0, 6).map((row) => workItem(row, today)).join('');
  const all = rows.length > 6 ? '<div class="ops-agenda-foot"><button type="button" class="ops-subaction" data-action="inbox-open">' +
    t('View all ' + countLabel(rows.length) + ' open items', '查看全部 ' + countLabel(rows.length) + ' 条待办') + '<span aria-hidden="true"> →</span></button></div>' : '';
  const headings = [t('Feedback / source', '客户反馈 / 来源'), t('Priority', '优先级'), t('Owner', '负责人'), t('Due date', '截止日期')];
  return '<section class="ops-panel ops-agenda"><div class="ops-panel-head"><h2>' + t('Priority queue', '优先处理') + '</h2>' +
    (rows.some((row) => row.work.priority === '重点') ? '<button type="button" class="ops-subaction" data-action="inbox-priority">' +
      t('View high-priority feedback', '查看重点反馈') + '</button>' : '') + '</div>' +
    (items ? '<div class="ops-list-head">' + headings.map((heading) => '<span>' + heading + '</span>').join('') + '</div><div class="ops-items">' +
      items + '</div>' + all : '<p class="ops-empty">' + t('No open items', '暂无待办') + '</p>') + '</section>';
}

function progressHtml(counts) {
  const segments = workStates.map((state, index) => '<i class="op-color-' + index + '" style="flex-grow:' + counts[state] +
    '" title="' + workLabel(state) + ' ' + itemCount(counts[state]) + '"></i>').join('');
  const entries = workStates.map((state, index) => '<button type="button" class="ops-stage" data-action="inbox-state" data-value="' +
    state + '"><span><i class="op-color-' + index + '" aria-hidden="true"></i>' + workLabel(state) + '</span><strong>' + countLabel(counts[state]) +
    '</strong></button>').join('');
  return '<section class="ops-panel ops-progress"><div class="ops-panel-head"><h2>' + t('Status breakdown', '处理进度') + '</h2></div><div class="ops-progress-body"><div class="ops-status-track" aria-hidden="true">' + segments +
    '</div><div class="ops-stage-list">' + entries + '</div></div></section>';
}

function popularTopics(project, rows) {
  const counts = new Map();
  for (const row of rows) {
    const labels = row.displayTopics ?? project.reviews?.[row.id]?.tags ?? row.topics ?? [];
    for (const label of new Set(labels)) counts.set(label, (counts.get(label) || 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).slice(0, 4);
  const entries = top.map(([label, count]) => '<button class="ops-topic" type="button" data-action="inbox-topic" data-value="' + safeText(label) +
    '"><span>' + safeText(topicLabel(label)) + '</span><strong>' + countLabel(count) +
    '</strong><i class="ops-topic-track" aria-hidden="true"><i style="width:' + (count / top[0][1] * 100).toFixed(2) +
    '%"></i></i></button>').join('');
  return '<section class="ops-panel ops-topics"><div class="ops-panel-head"><h2>' + t('Top categories', '主要反馈类别') + '</h2></div>' +
    (entries ? '<div class="ops-topic-list">' + entries + '</div>' : '<p class="ops-empty">' + t('No categorized feedback yet', '暂无已分类反馈') + '</p>') + '</section>';
}

export function overviewHtml(project, rows) {
  const today = localDay();
  const counts = Object.fromEntries(workStates.map((state) => [state, 0]));
  const open = [];
  const alerts = { overdue: [], due: [], unassigned: [] };
  for (const row of rows) {
    const work = row.work;
    counts[work.state] += 1;
    if (work.state === '待分派' || work.state === '处理中') open.push(row);
    if (isWorkOverdue(work, today)) alerts.overdue.push(row);
    if (isWorkDueToday(work, today)) alerts.due.push(row);
    if (isPriorityUnassigned(work)) alerts.unassigned.push(row);
  }
  const activity = recentActivity(rows);
  const actions = rows.length ? '<div class="ops-actions"><button type="button" class="btn" data-action="export-work" aria-haspopup="dialog">' + t('Export project list', '导出项目清单') + '</button>' +
    '<button type="button" class="btn btn-primary ops-primary" data-action="go-inbox">' + t('Open inbox', '处理反馈') + '</button></div>' : '';
  return '<div class="op-overview"><header class="ops-heading"><h1>' + t('Feedback overview', '反馈指挥台') + '</h1>' + actions + '</header>' +
    '<div class="ops-board"><section class="ops-kpis' + (rows.length >= 10000 ? ' wide-values' : '') + '" aria-label="' + t('Project summary', '项目处理概况') + '">' +
    kpi(t('Total feedback', '反馈总量'), rows.length, 'inbox', 'go-inbox', '', activity.days.length ? '' : ' insight-count') +
    kpi(t('Open', '待跟进'), open.length, 'follow', 'inbox-open') +
    kpi(t('Overdue', '已逾期'), alerts.overdue.length, 'late', 'inbox-overdue') +
    kpi(t('Closed', '已办结'), counts['已办结'], 'done', 'inbox-state', '已办结') + '</section>' +
    activityChart(activity, rows.length) + '<div class="ops-layout">' + agendaSection(open, today) + '<div class="ops-side">' +
    alertsHtml(alerts, today) + progressHtml(counts) + popularTopics(project, rows) + '</div></div></div></div>';
}
