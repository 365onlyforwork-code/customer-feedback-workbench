export const languageKey = 'customer-feedback-locale';

function preferredLanguage() {
  try {
    return localStorage.getItem(languageKey) === 'en' ? 'en' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

export const locale = preferredLanguage();
export const t = (english, chinese) => locale === 'en' ? english : chinese;

export function setLocale(language) {
  try {
    localStorage.setItem(languageKey, language);
  } catch {
    return false;
  }
  return true;
}

const topics = new Map([
  ['未分类', 'Uncategorized'],
  ['质量与耐用性', 'Quality and durability'],
  ['功能与性能', 'Features and performance'],
  ['易用性与设计', 'Usability and design'],
  ['价格与计费', 'Pricing and billing'],
  ['物流与包装', 'Shipping and packaging'],
  ['售后与服务', 'After-sales service'],
  ['功能与连接', 'Features and connectivity'],
  ['外观与易用', 'Design and usability'],
  ['质量与安全', 'Quality and safety'],
  ['配送与包装', 'Delivery and packaging'],
  ['价格与付款', 'Pricing and payment'],
  ['售后支持', 'After-sales support'],
  ['账号与登录', 'Accounts and sign-in'],
  ['权限与数据', 'Permissions and data'],
  ['计费与发票', 'Billing and invoices'],
  ['报表与导出', 'Reporting and exports'],
  ['性能与稳定性', 'Performance and reliability'],
  ['操作与反馈', 'Usability and feedback'],
]);

export function topicLabel(value) {
  return locale === 'en' ? topics.get(value) ?? value : value;
}

export function localizeDocument() {
  document.documentElement.lang = locale;
  if (locale !== 'en') return;
  for (const root of [document, ...Array.from(document.querySelectorAll('template'), (node) => node.content)]) {
    root.querySelectorAll('[data-en]').forEach((node) => { node.textContent = node.dataset.en; });
    root.querySelectorAll('[data-en-aria]').forEach((node) => { node.setAttribute('aria-label', node.dataset.enAria); });
    root.querySelectorAll('[data-en-content]').forEach((node) => { node.content = node.dataset.enContent; });
  }
}
