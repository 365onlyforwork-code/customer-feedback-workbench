import { t, topicLabel } from './i18n.js';

export const STRATEGIES = ["joint", "uncertainty", "impact", "random", "joint70"];

export const DEFAULT_RULES = [
  {
    name: "质量与耐用性",
    keywords: ["破损", "漏水", "断裂", "故障", "瑕疵", "变形", "耐用", "质量", "broken", "cracked", "defect", "defective", "durability"],
    priority: false,
  },
  {
    name: "功能与性能",
    keywords: ["闪退", "崩溃", "卡顿", "加载慢", "页面空白", "打不开", "断网", "连接失败", "无法登录", "登录失败", "功能", "performance", "crashes", "crashed", "slow", "connection failed", "cannot log in", "can't log in"],
    priority: false,
  },
  {
    name: "易用性与设计",
    keywords: ["难用", "易用", "界面", "字体", "操作复杂", "说明书", "指引", "设计", "interface", "confusing", "hard to use", "usability", "design"],
    priority: false,
  },
  {
    name: "价格与计费",
    keywords: ["价格", "收费", "扣费", "扣款", "账单", "订阅", "计费", "优惠", "price", "billing", "overcharged", "charged twice", "double charge", "subscription"],
    priority: true,
  },
  {
    name: "物流与包装",
    keywords: ["物流", "配送", "快递", "包装", "送达", "签收", "运单", "丢件", "破包", "shipping", "delivery", "packaging", "courier", "parcel"],
    priority: false,
  },
  {
    name: "售后与服务",
    keywords: ["客服", "售后", "退款", "退货", "换货", "保修", "工单", "人工", "customer service", "support", "refund", "return", "warranty"],
    priority: false,
  },
];

const SAFETY_CUES = [
  "过热", "冒烟", "烧焦", "起火", "着火", "爆炸", "触电", "漏电",
  "overheat", "overheating", "overheated", "smoke", "smoking", "burning",
  "fire", "explosion", "explode", "exploded", "electric shock", "unsafe", "dangerous",
];

const RANDOM_SEED = 20261101;
const MARKERS = {
  unclassified: t('Needs a category', '待分类'),
  additionalTopics: t('Other categories may apply', '发现其他可能相关的类别'),
  multipleTopics: t('Matches more than one category', '涉及多个类别'),
  singleKeyword: t('Category needs confirmation', '类别待确认'),
  strongKeyword: t('Category matched', '已匹配类别'),
  existingTags: t('Existing labels', '已有标签'),
};

function normalize(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function parseTags(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw ?? "").split(/[,，;；|｜、\r\n]+/u);
  const seen = new Set();
  return parts.map((part) => String(part ?? "").trim()).filter((part) => {
    const key = normalize(part);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compileKeyword(word) {
  const term = normalize(word);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Latin boundaries avoid matches such as "fire" inside "firewall", and
  // allow a Latin term next to Chinese characters in mixed-language feedback.
  const latinStart = /^[\p{Script=Latin}\d]/u.test(term);
  const latinEnd = /[\p{Script=Latin}\d]$/u.test(term);
  const left = latinStart ? "(?:^|[^\\p{Script=Latin}\\d_])" : "";
  const right = latinEnd ? "(?=$|[^\\p{Script=Latin}\\d_])" : "";
  return { word, matches: new RegExp(left + escaped + right, "u") };
}

const compiledSafety = SAFETY_CUES.map(compileKeyword);

function compileRules(rules) {
  const byName = new Map();
  for (const rule of rules) {
    const name = String(rule.name ?? "").trim();
    const key = normalize(name);
    if (!key) continue;
    const previous = byName.get(key);
    const keywords = parseTags([...parseTags(previous?.keywords), ...parseTags(rule.keywords)]);
    byName.set(key, { name: previous?.name ?? name, key, keywords, priority: Boolean(previous?.priority || rule.priority) });
  }
  return Array.from(byName.values(), (rule) => ({ ...rule, compiled: rule.keywords.map(compileKeyword) }));
}

function uncertaintyFor(tags, keywordHits) {
  if (tags.length === 0 && keywordHits.length === 0) return [1, "unclassified"];
  if (tags.length > 0) {
    const supplied = new Set(tags);
    return keywordHits.some(({ key }) => !supplied.has(key)) ? [0.65, "additionalTopics"] : [0.1, "existingTags"];
  }
  if (keywordHits.length > 1) return [0.55, "multipleTopics"];
  return keywordHits[0].keywords.length === 1 ? [0.35, "singleKeyword"] : [0.2, "strongKeyword"];
}

export function analyzeRows(rows, rules = DEFAULT_RULES) {
  const compiledRules = compileRules(rules);
  const topicNames = new Map(compiledRules.map(({ key, name }) => [key, name]));
  const priorities = new Set(compiledRules.filter(({ priority }) => priority).map(({ key }) => key));
  return rows.map((row) => {
    const text = normalize(row.text);
    const tags = parseTags(row.tags).map((tag) => {
      const key = normalize(tag);
      if (!topicNames.has(key)) topicNames.set(key, tag);
      return key;
    });
    const keywordHits = [];
    for (const { key, name, compiled } of compiledRules) {
      const keywords = compiled.filter(({ matches }) => matches.test(text)).map(({ word }) => word);
      if (keywords.length > 0) keywordHits.push({ key, topic: name, keywords });
    }
    const topicKeys = new Set([...tags, ...keywordHits.map(({ key }) => key)]);
    const topics = Array.from(topicKeys, (key) => topicNames.get(key));
    const priorityTopics = Array.from(topicKeys).filter((key) => priorities.has(key)).map((key) => topicNames.get(key));
    const impactCues = compiledSafety.filter(({ matches }) => matches.test(text)).map(({ word }) => word);
    const [uncertainty, reason] = uncertaintyFor(tags, keywordHits);
    const impact = (impactCues.length > 0 ? 0.6 : 0) + (priorityTopics.length > 0 ? 0.4 : 0);
    const reasons = [MARKERS[reason]];
    const reasonCodes = [reason];
    if (impactCues.length > 0) {
      reasons.push(t('Safety terms mentioned · ', '提及安全问题 · ') + impactCues.join("、"));
      reasonCodes.push("safetyCue");
    }
    if (priorityTopics.length > 0) {
      reasons.push(t('Project priority category · ', '项目重点类别 · ') + priorityTopics.map(topicLabel).join(t(", ", "、")));
      reasonCodes.push("companyPriority");
    }
    return {
      ...row,
      topics,
      matchedTopics: keywordHits.map(({ topic }) => topic),
      keywordHits: keywordHits.map(({ topic, keywords }) => ({ topic, keywords })),
      priorityTopics,
      impactCues,
      uncertainty,
      impact,
      joint: 0.75 * uncertainty + 0.25 * impact,
      reasons,
      reasonCodes,
    };
  });
}

function shuffled(rows) {
  const result = rows.slice();
  let seed = RANDOM_SEED;
  for (let index = result.length - 1; index > 0; index--) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const swap = Math.floor(((seed >>> 0) / 4294967296) * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function getQueue(analyzedRows, strategy, budget) {
  const count = Math.min(analyzedRows.length, Math.max(0, Math.floor(Number(budget) || 0)));
  if (count === 0) return [];
  if (strategy === "random") return shuffled(analyzedRows).slice(0, count);
  const scores = {
    joint: (row) => row.joint,
    joint70: (row) => 0.7 * row.uncertainty + 0.3 * row.impact,
    uncertainty: (row) => row.uncertainty,
    impact: (row) => row.impact,
  };
  const score = Object.prototype.hasOwnProperty.call(scores, strategy) ? scores[strategy] : scores.joint;
  return analyzedRows
    .map((row, index) => ({ row, index, value: score(row) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, count)
    .map(({ row }) => row);
}

export function compareQueues(a, b) {
  const identify = (row) => row.id ?? row;
  const aKeys = new Set(a.map(identify));
  const bKeys = new Set(b.map(identify));
  return {
    both: a.filter((row) => bKeys.has(identify(row))),
    onlyA: a.filter((row) => !bKeys.has(identify(row))),
    onlyB: b.filter((row) => !aKeys.has(identify(row))),
  };
}
