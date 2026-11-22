import { t } from './i18n.js';

const FILE_LIMIT = 15 * 1024 * 1024;
const XML_LIMIT = 16 * 1024 * 1024;
const WORKBOOK_XML_LIMIT = 40 * 1024 * 1024;
const ROW_LIMIT = 20000;
const COLUMN_LIMIT = 200;
const CELL_LIMIT = 800000;

const aliases = {
  reference: ['原工单号','工单号','工单编号','反馈编号','反馈ID','工单ID','客户工单号','服务单号','original ticket id','ticket id','ticket number','case number','reference','feedback id','id'],
  text: ['客户反馈原文','反馈原文','反馈正文', '反馈内容', '反馈文本', '客户反馈', '评价内容', '评论内容', '评论正文', '评价正文', '评价详情', '评论文本', '评论', '工单描述', '问题描述', '客户意见', '反馈', '正文', '内容', '描述', '文本', 'feedback text', 'feedback body', 'feedback', 'review text', 'review body', 'review', 'ticket description', 'body', 'description', 'message', 'comment', 'text', 'content', 'customer feedback', 'customer comment', 'customer verbatim', 'verbatim', 'issue description'],
  date: ['提交日期', '反馈日期', '评论日期', '评价日期', '创建日期', '受理日期', '反馈时间', '评价时间', '创建时间', '提交时间', '工单日期', '录入时间', '日期', '时间', 'created at', 'created on', 'date', 'timestamp', 'created date', 'review date', 'feedback date', 'submitted at', 'submitted on', 'time', 'submission date'],
  product: ['产品或服务', '产品名称', '产品线', '产品型号', '服务名称', '商品名称', '产品', '服务', '商品', '型号', 'product or service', 'product name', 'product line', 'product model', 'product', 'item', 'service', 'model', 'sku'],
  channel: ['反馈渠道', '渠道来源', '渠道', '平台', '来源', 'channel', 'source channel', 'source', 'platform', 'feedback channel'],
  rating: ['客户评分', '评价星级', '星级评分', '客户满意度', '满意度', '评分', '星级', '打分', 'rating', 'stars', 'star rating', 'score', 'customer rating', 'csat'],
  tags: ['已有标签', '反馈标签', '问题标签', '问题类别', '问题类型', '工单分类', '主题', '标签', '类别', '分类', 'tags', 'tag', 'existing tags', 'feedback tags', 'labels', 'label', 'topic', 'topics', 'category', 'categories', 'issue type'],
};

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function limit(message) {
  return failure('limit', message);
}

function headerKey(value) {
  return String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function guessMapping(headers) {
  const keys = headers.map(headerKey);
  const assigned = new Set();
  return Object.fromEntries(Object.entries(aliases).map(([field, names]) => {
    const index = names.map(headerKey)
      .map((name) => keys.findIndex((key, column) => key === name && !assigned.has(column)))
      .find((column) => column >= 0);
    if (index !== undefined) assigned.add(index);
    return [field, index ?? ''];
  }));
}

export function csvText(headers, rows) {
  const escape = (cell) => {
    const source = String(cell ?? '');
    const value = /^[\s\u200B\uFEFF]*[=+\-@]/u.test(source) || /^[\t\r\n]/u.test(source)
      ? "'" + source
      : source;
    return '"' + value.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n') + '\r\n';
}

function decodeDelimited(bytes) {
  const hasLE = bytes[0] === 255 && bytes[1] === 254;
  const hasBE = bytes[0] === 254 && bytes[1] === 255;
  if (hasLE || hasBE) return new TextDecoder(hasLE ? 'utf-16le' : 'utf-16be').decode(bytes);
  let evenZeros = 0;
  let oddZeros = 0;
  const sampleLength = Math.min(bytes.length, 512);
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] !== 0) continue;
    if (index % 2 === 0) evenZeros += 1;
    else oddZeros += 1;
  }
  if (oddZeros > 2 && oddZeros > evenZeros * 3) return new TextDecoder('utf-16le').decode(bytes);
  if (evenZeros > 2 && evenZeros > oddZeros * 3) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gb18030', { fatal: true }).decode(bytes);
    } catch {
      throw failure('encoding', t('The encoding could not be read. Save the file as UTF-8 CSV and try again.', '无法识别文件编码，请另存为 UTF-8 CSV 后再导入。'));
    }
  }
}

function* delimitedRows(text, separator) {
  let row = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') cell += character;
      else if (text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (character === separator) {
      row.push(cell);
      if (row.length >= COLUMN_LIMIT) throw limit(t('Each sheet supports up to 200 columns.', '单张表最多支持 200 列。'));
      cell = '';
      closed = false;
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      yield row;
      row = [];
      cell = '';
      closed = false;
    } else if (character === '"' && cell === '' && !closed) {
      quoted = true;
    } else if (!closed || !/[ \t]/.test(character)) {
      cell += character;
    }
  }
  if (quoted) throw failure('csv', t('A quoted field is not closed. Check the double quotes in the CSV.', '有带引号的字段未闭合，请检查 CSV 中的双引号。'));
  if (row.length || cell || closed) yield [...row, cell];
}

function delimiters(text) {
  const separatorDeclaration = /^sep=([,;\t])(?:\r\n|\r|\n)/i.exec(text);
  if (separatorDeclaration) {
    return [text.slice(separatorDeclaration[0].length), separatorDeclaration[1]];
  }
  let best = ',';
  let bestScore = 0;
  for (const separator of [',', '\t', ';']) {
    let count = 0;
    let matchingWidth = 0;
    let width;
    try {
      for (const row of delimitedRows(text, separator)) {
        if (!row.some((value) => value.trim())) continue;
        width ??= row.length;
        if (width === row.length) matchingWidth += 1;
        count += 1;
        if (count === 12) break;
      }
    } catch {
      continue;
    }
    const score = width > 1 && count > 0 ? matchingWidth / count * 100 + Math.min(width, 25) : 0;
    if (score > bestScore) {
      best = separator;
      bestScore = score;
    }
  }
  return [text, best];
}

function makeSheet(name, entries) {
  let widest = 0;
  let cellCount = 0;
  const rows = [];
  for (const row of entries) {
    if (!row.some((value) => value?.trim())) continue;
    if (row.length > COLUMN_LIMIT) throw limit(t('Each sheet supports up to 200 columns.', '单张表最多支持 200 列。'));
    widest = Math.max(widest, row.length);
    cellCount += row.length;
    if (rows.length > ROW_LIMIT || cellCount > CELL_LIMIT) {
      throw limit(t('Each sheet supports up to 20,000 rows and 800,000 cells.', '单张表最多支持 20,000 条记录和 800,000 个单元格。'));
    }
    rows.push(row);
  }
  if (!rows.length) return null;
  if (widest * rows.length > CELL_LIMIT) throw limit(t('Each sheet supports up to 800,000 cells.', '单张表最多支持 800,000 个单元格。'));
  const header = rows.shift();
  const used = new Set();
  const headers = Array.from({ length: widest }, (_, column) => {
    const base = header[column]?.trim() || 'Column ' + (column + 1);
    let value = base;
    for (let duplicate = 2; used.has(value); duplicate += 1) value = base + ' (' + duplicate + ')';
    used.add(value);
    return value;
  });
  return {
    name,
    headers,
    rows: rows.map((row) => Array.from({ length: widest }, (_, column) => row[column] ?? '')),
  };
}

function invalidWorkbook() {
  return failure('workbook', t('Could not read the workbook. Save it as .xlsx or CSV and try again.', '无法读取 Excel 工作簿，请用 Excel 另存为 .xlsx 或 CSV 后重试。'));
}

function openZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const uint32 = (at) => view.getUint32(at, true);
  const uint16 = (at) => view.getUint16(at, true);
  let end = bytes.length - 22;
  const first = Math.max(0, end - 65535);
  for (; end >= first; end -= 1) {
    if (uint32(end) === 0x06054b50 && end + 22 + uint16(end + 20) === bytes.length) break;
  }
  if (end < first || uint16(end + 4) || uint16(end + 6) || uint16(end + 10) === 65535) {
    throw invalidWorkbook();
  }
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  const directoryStart = uint32(end + 16);
  const directoryEnd = directoryStart + uint32(end + 12);
  if (directoryEnd > end) throw invalidWorkbook();
  let position = directoryStart;
  for (let index = 0; index < uint16(end + 10); index += 1) {
    if (position + 46 > directoryEnd || uint32(position) !== 0x02014b50) throw invalidWorkbook();
    const nameStart = position + 46;
    const nameEnd = nameStart + uint16(position + 28);
    const next = nameEnd + uint16(position + 30) + uint16(position + 32);
    if (next > directoryEnd) throw invalidWorkbook();
    const name = decoder.decode(bytes.subarray(nameStart, nameEnd));
    entries.set(name, {
      encrypted: Boolean(uint16(position + 8) & 1),
      compression: uint16(position + 10),
      compressedSize: uint32(position + 20),
      size: uint32(position + 24),
      offset: uint32(position + 42),
    });
    position = next;
  }
  let expanded = 0;
  return {
    has: (path) => entries.has(path),
    async read(path) {
      const item = entries.get(path);
      if (!item || item.encrypted) throw invalidWorkbook();
      if (item.size > XML_LIMIT || expanded + item.size > WORKBOOK_XML_LIMIT) {
        throw limit(t('The workbook is too large to open. Split it or save it as CSV.', '工作簿解压后过大，请拆分或另存为 CSV。'));
      }
      if (item.offset + 30 > directoryStart || uint32(item.offset) !== 0x04034b50) throw invalidWorkbook();
      const start = item.offset + 30 + uint16(item.offset + 26) + uint16(item.offset + 28);
      const stop = start + item.compressedSize;
      if (stop > directoryStart) throw invalidWorkbook();
      const payload = bytes.subarray(start, stop);
      expanded += item.size;
      if (item.compression === 0 && payload.length === item.size) return payload;
      if (item.compression !== 8) throw invalidWorkbook();
      let stream;
      try {
        stream = new DecompressionStream('deflate-raw');
      } catch {
        throw failure('browser', t('This browser cannot open the workbook. Use a current browser or save it as CSV.', '当前浏览器无法解压 Excel 文件，请使用新版浏览器或另存为 CSV。'));
      }
      const reader = new Blob([payload]).stream().pipeThrough(stream).getReader();
      const result = new Uint8Array(item.size);
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (size + value.length > result.length) {
          await reader.cancel();
          throw invalidWorkbook();
        }
        result.set(value, size);
        size += value.length;
      }
      if (size !== result.length) throw invalidWorkbook();
      return result;
    },
  };
}

function elements(node, name) {
  return [...node.getElementsByTagNameNS('*', name)];
}

function children(node, name) {
  return Array.from(node?.children ?? []).filter((child) => child.localName === name);
}

function xmlString(bytes) {
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

async function openXml(zip, path) {
  const text = xmlString(await zip.read(path));
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw invalidWorkbook();
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (elements(xml, 'parsererror').length) throw invalidWorkbook();
  return xml;
}

function resolvePart(source, target) {
  const parts = target.startsWith('/') ? [] : source.split('/').slice(0, -1);
  for (const component of target.split('/')) {
    if (!component || component === '.') continue;
    if (component === '..') {
      if (!parts.length) throw invalidWorkbook();
      parts.pop();
    } else {
      parts.push(component);
    }
  }
  return parts.join('/');
}

function relationships(xml, source) {
  return elements(xml, 'Relationship')
    .filter((rel) => rel.getAttribute('TargetMode') !== 'External')
    .map((rel) => ({
      id: rel.getAttribute('Id'),
      kind: rel.getAttribute('Type')?.split('/').pop(),
      path: resolvePart(source, rel.getAttribute('Target') || ''),
    }));
}

function spreadsheetText(text) {
  return text.replace(/_x([a-f0-9]{4})_/gi, (_, value) => String.fromCharCode(parseInt(value, 16)));
}

function richText(node) {
  if (!node) return '';
  const text = [...node.children].map((child) => {
    if (child.localName === 't') return child.textContent;
    if (child.localName === 'r') return children(child, 't').map((run) => run.textContent).join('');
    return '';
  }).join('');
  return spreadsheetText(text);
}

function dateStyles(styles) {
  const customDates = new Set(elements(styles, 'numFmt').filter((format) => {
    const code = (format.getAttribute('formatCode') || '').replace(/"[^"]*"|\\.|\[[^\]]*\]|[_*]./g, '');
    return /[dy]/i.test(code) || /(?:^|[^0])m{2,}(?:[^0]|$)/i.test(code);
  }).map((format) => Number(format.getAttribute('numFmtId'))));
  return children(elements(styles, 'cellXfs')[0], 'xf').map((format) => {
    const id = Number(format.getAttribute('numFmtId'));
    return (id >= 14 && id <= 17) || id === 22 || (id >= 27 && id <= 36) ||
      (id >= 50 && id <= 58) || customDates.has(id);
  });
}

function excelDate(serial, uses1904) {
  const number = Number(serial);
  if (!Number.isFinite(number) || number < 0 || number > 2958465) return serial;
  // The 1900 date system includes Excel's fictional 1900-02-29.
  const epochDay = uses1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, number < 60 ? 31 : 30);
  const formatted = new Date(epochDay + Math.round(number * 86400000)).toISOString();
  return Number.isInteger(number) ? formatted.slice(0, 10) : formatted;
}

function cellColumn(reference) {
  const letters = /^[A-Z]+/i.exec(reference)?.[0]?.toUpperCase();
  if (!letters) return null;
  let column = 0;
  for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
  return column - 1;
}

function* sheetRows(xml, strings, dates, uses1904) {
  const sheetData = elements(xml, 'sheetData')[0];
  for (const source of children(sheetData, 'row')) {
    const row = [];
    let nextColumn = 0;
    for (const cell of children(source, 'c')) {
      const kind = cell.getAttribute('t');
      const raw = children(cell, 'v')[0]?.textContent ?? '';
      let value = raw;
      if (kind === 'inlineStr') value = richText(children(cell, 'is')[0]);
      else if (kind === 's') value = strings[Number(raw)] ?? '';
      else if (kind === 'str') value = spreadsheetText(raw);
      else if (kind === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if ((kind === null || kind === 'n') && raw && dates[Number(cell.getAttribute('s'))]) {
        value = excelDate(raw, uses1904);
      }
      const column = cellColumn(cell.getAttribute('r') || '') ?? nextColumn;
      nextColumn = column + 1;
      if (value !== '') {
        if (column >= COLUMN_LIMIT) throw limit(t('Each sheet supports up to 200 columns.', '单张表最多支持 200 列。'));
        row[column] = value;
      }
    }
    yield row;
  }
}

async function readExcel(bytes) {
  try {
    const zip = openZip(bytes);
    const packageRels = zip.has('_rels/.rels')
      ? relationships(await openXml(zip, '_rels/.rels'), '')
      : [];
    const workbookPath = packageRels.find((rel) => rel.kind === 'officeDocument')?.path || 'xl/workbook.xml';
    const workbook = await openXml(zip, workbookPath);
    const workbookParts = workbookPath.split('/');
    const workbookFile = workbookParts.pop();
    const workbookRels = relationships(
      await openXml(zip, [...workbookParts, '_rels', workbookFile + '.rels'].join('/')),
      workbookPath,
    );
    const stringsPath = workbookRels.find((rel) => rel.kind === 'sharedStrings')?.path;
    const stylePath = workbookRels.find((rel) => rel.kind === 'styles')?.path;
    const strings = stringsPath ? elements(await openXml(zip, stringsPath), 'si').map(richText) : [];
    const dates = stylePath ? dateStyles(await openXml(zip, stylePath)) : [];
    const uses1904 = ['true', '1'].includes(elements(workbook, 'workbookPr')[0]?.getAttribute('date1904'));
    const sheets = [];
    let totalCells = 0;
    for (const sheet of elements(workbook, 'sheet')) {
      const id = [...sheet.attributes].find((attribute) => attribute.localName === 'id')?.value;
      const rel = workbookRels.find((entry) => entry.id === id && entry.kind === 'worksheet');
      if (!rel) continue;
      const name = sheet.getAttribute('name') || 'Sheet ' + (sheets.length + 1);
      const data = makeSheet(name, sheetRows(await openXml(zip, rel.path), strings, dates, uses1904));
      if (data) {
        totalCells += data.headers.length * (data.rows.length + 1);
        if (totalCells > CELL_LIMIT) throw limit(t('A workbook supports up to 800,000 cells.', '一个工作簿最多支持 800,000 个单元格。'));
        sheets.push(data);
      }
    }
    return sheets;
  } catch (error) {
    if (error.code && typeof error.code === 'string') throw error;
    throw invalidWorkbook();
  }
}

export async function readSpreadsheet(file) {
  if (!file?.size) throw failure('empty', t('The file is empty. Select a file with headers and feedback rows.', '文件为空，请选择含有表头和反馈数据的表格。'));
  if (file.size > FILE_LIMIT) throw limit(t('Each file can be up to 15 MB.', '单个文件最大支持 15 MB。'));
  const name = file.name || 'Feedback.csv';
  const ext = name.split('.').at(-1)?.toLowerCase();
  if (!['xlsx', 'csv', 'tsv', 'txt'].includes(ext)) {
    throw failure('format', t('Select an .xlsx, .csv or .tsv file.', '请选择 .xlsx、.csv 或 .tsv 文件。'));
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let sheets;
  if (ext === 'xlsx') {
    sheets = await readExcel(bytes);
  } else {
    const decoded = decodeDelimited(bytes);
    const [text, separator] = ext === 'tsv' ? [decoded, '\t'] : delimiters(decoded);
    sheets = [makeSheet(name, delimitedRows(text, separator))].filter(Boolean);
  }
  if (!sheets.some((sheet) => sheet.rows.length)) {
    throw failure('empty', t('No feedback rows were found. Put column names in the first row and start entering data in the next row.', '找不到可导入的反馈记录。请确认表格首行是字段名称，下一行开始填写数据。'));
  }
  return { sheets: sheets.filter((sheet) => sheet.rows.length) };
}
