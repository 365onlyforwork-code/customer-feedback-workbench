import { locale, t, topicLabel } from './i18n.js';
import { parseTags } from './analysis.js';

function escape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function chips(tags) {
  return tags.map((tag, index) => {
    const label = topicLabel(tag);
    return '<button type="button" class="review-tag-chip" data-tag-remove="' + index +
      '" aria-label="' + escape(t('Remove label ' + label, '移除标签“' + label + '”')) +
      '" title="' + escape(label) + '"><span>' + escape(label) + '</span><span aria-hidden="true">×</span></button>';
  }).join('');
}

export function reviewTagsHtml(tags = []) {
  const selected = Array.isArray(tags) ? tags.filter((value) => typeof value === 'string') : [];
  return '<fieldset class="field review-tags" data-review-tags><legend>' + t('Confirmed labels', '确认标签') + '</legend>' +
    '<input type="hidden" name="tags" value="' + escape(JSON.stringify(selected)) + '">' +
    '<div class="review-tag-chips" data-tag-chips>' + chips(selected) + '</div>' +
    '<details data-tag-picker><summary>' + t('Choose labels', '选择标签') + '</summary>' +
    '<div class="review-tag-picker-body"><input type="search" id="review-tags" class="control" data-tag-search autocomplete="off"' +
    ' aria-label="' + t('Search or add a label', '搜索或添加标签') + '" placeholder="' + t('Search or add a label', '搜索或添加标签') + '">' +
    '<button type="button" class="btn btn-quiet review-tag-add" data-tag-add hidden>' + t('Add as a new label', '添加为新标签') + '</button>' +
    '<button type="button" class="btn btn-quiet" data-tag-add-batch hidden></button>' +
    '<div class="review-tag-options" data-tag-list></div><button type="button" class="btn btn-quiet" data-tag-more hidden>' +
    t('Show more labels', '显示更多标签') + '</button></div></details></fieldset>';
}

export function getReviewTags(form) {
  const field = form?.querySelector('[data-review-tags] input[name="tags"]');
  return field ? JSON.parse(field.value) : [];
}

export function mountReviewTags(form, options = []) {
  const field = form?.querySelector('[data-review-tags]');
  if (!field) return;
  let selected = getReviewTags(form);
  const known = [...new Set([...options, ...selected].filter((value) => typeof value === 'string' && value.trim()))];
  const aliases = new Map(known.map((tag) => [tag, tag]));
  function indexAliases(tag) {
    for (const name of [tag, topicLabel(tag)]) {
      const key = name.toLocaleLowerCase(locale);
      if (!aliases.has(key)) aliases.set(key, tag);
    }
  }
  known.forEach(indexAliases);
  const knownName = (value) => aliases.get(value) ?? aliases.get(value.toLocaleLowerCase(locale));
  const stored = field.querySelector('input[name="tags"]');
  const picker = field.querySelector('[data-tag-picker]');
  const search = field.querySelector('[data-tag-search]');
  const list = field.querySelector('[data-tag-list]');
  const chipList = field.querySelector('[data-tag-chips]');
  const add = field.querySelector('[data-tag-add]');
  const addBatch = field.querySelector('[data-tag-add-batch]');
  const more = field.querySelector('[data-tag-more]');
  const batchSize = 30;
  let limit = batchSize;
  let batch = [];
  let composing = false;

  function updateBatchButton() {
    if (addBatch.hidden) return;
    const count = batch.filter((tag) => !selected.includes(tag)).length;
    addBatch.disabled = !count;
    addBatch.textContent = count ? t('Add ' + count + (count === 1 ? ' label' : ' labels'), '添加 ' + count + ' 个标签')
      : t('Labels already selected', '这些标签已选');
  }

  function renderOptions() {
    const query = search.value.trim();
    const normalized = query.toLocaleLowerCase(locale);
    const checked = new Set(selected);
    const visible = [];
    const parts = parseTags(query);
    batch = parts.length > 1 ? [...new Set(parts.map((value) => knownName(value) ?? value))] : [];
    addBatch.hidden = parts.length < 2;
    updateBatchButton();
    let matches = 0;
    known.forEach((tag, index) => {
      const label = topicLabel(tag);
      const raw = tag.toLocaleLowerCase(locale);
      const display = label.toLocaleLowerCase(locale);
      if (!raw.includes(normalized) && !display.includes(normalized)) return;
      matches += 1;
      if (matches > limit) return;
      visible.push('<label><input type="checkbox" data-tag-option="' + index + '"' + (checked.has(tag) ? ' checked' : '') +
        '><span>' + escape(label) + '</span></label>');
    });
    add.hidden = !query || knownName(query) !== undefined;
    more.hidden = matches <= limit;
    list.innerHTML = visible.join('') || '<p class="review-tag-empty">' + t('No matching labels', '暂无匹配标签') + '</p>';
  }

  function syncSelection() {
    stored.value = JSON.stringify(selected);
    chipList.innerHTML = chips(selected);
    updateBatchButton();
    for (const checkbox of list.querySelectorAll('[data-tag-option]')) {
      checkbox.checked = selected.includes(known[Number(checkbox.dataset.tagOption)]);
    }
    stored.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectValues(values) {
    const start = selected.length;
    for (const value of values) {
      if (!value) continue;
      let tag = knownName(value);
      if (tag === undefined) {
        tag = value;
        known.push(tag);
        aliases.set(tag, tag);
        indexAliases(tag);
      }
      if (!selected.includes(tag)) selected.push(tag);
    }
    if (selected.length !== start) syncSelection();
    search.value = '';
    limit = batchSize;
    renderOptions();
    search.focus();
  }

  search.oninput = () => {
    limit = batchSize;
    renderOptions();
  };
  search.oncompositionstart = () => { composing = true; };
  search.oncompositionend = () => {
    composing = false;
    renderOptions();
  };
  picker.onkeydown = (event) => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && event.target === search) {
      event.preventDefault();
      selectValues([search.value.trim()]);
    }
    if (event.key === 'Escape' && picker.open) {
      event.preventDefault();
      event.stopPropagation();
      picker.open = false;
      picker.querySelector('summary').focus();
    }
  };
  list.onchange = (event) => {
    const checkbox = event.target.closest('[data-tag-option]');
    if (!checkbox) return;
    const tag = known[Number(checkbox.dataset.tagOption)];
    if (checkbox.checked) selected.push(tag);
    else selected = selected.filter((value) => value !== tag);
    syncSelection();
  };
  chipList.onclick = (event) => {
    const button = event.target.closest('[data-tag-remove]');
    if (!button) return;
    const index = Number(button.dataset.tagRemove);
    selected.splice(index, 1);
    syncSelection();
    const remaining = chipList.querySelectorAll('[data-tag-remove]');
    (remaining[Math.min(index, remaining.length - 1)] || picker.querySelector('summary')).focus();
  };
  add.onclick = () => selectValues([search.value.trim()]);
  addBatch.onclick = () => selectValues(batch);
  more.onclick = () => {
    const shown = list.querySelectorAll('[data-tag-option]').length;
    limit += batchSize;
    renderOptions();
    list.querySelectorAll('[data-tag-option]')[shown]?.focus();
  };
  renderOptions();
}
