import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../src/logger/index.js';
import mime from 'mime-types';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import pdfParse from 'pdf-parse';
import { XMLParser } from 'fast-xml-parser';
import iconv from 'iconv-lite';

function isHttpUrl(s) {
  try { const u = new URL(String(s)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

function detectEncoding(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return 'utf8';
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) return 'utf16le';
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) return 'utf16be';
  try { const text = buffer.toString('utf8'); if (!text.includes('\uFFFD')) return 'utf8'; } catch {}
  return 'gbk';
}

async function parseTXT(buffer, options = {}) {
  const encoding = options.encoding || detectEncoding(buffer);
  logger.info?.('document_read:txt_encoding', { label: 'PLUGIN', encoding });
  if (encoding === 'utf8') return buffer.toString('utf8');
  return iconv.decode(buffer, encoding);
}

async function parseDOCX(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function parsePDF(buffer) {
  const data = await pdfParse(buffer);
  return data.text;
}

async function parseExcel(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheets = [];
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const rows = data.map(row => row.join('\t'));
    sheets.push(`Sheet: ${sheetName}\n${rows.join('\n')}`);
  });
  return sheets.join('\n\n');
}

async function parseCSV(buffer, options = {}) {
  const encoding = options.encoding || detectEncoding(buffer);
  const text = encoding === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, encoding);
  const lines = text.split(/\r?\n/);
  return lines.map(line => line.split(',').join('\t')).join('\n');
}

async function parseXML(buffer, options = {}) {
  const encoding = options.encoding || detectEncoding(buffer);
  const text = encoding === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, encoding);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const result = parser.parse(text);
  return JSON.stringify(result, null, 2);
}

async function parseJSON(buffer, options = {}) {
  const encoding = options.encoding || detectEncoding(buffer);
  const text = encoding === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, encoding);
  const data = JSON.parse(text);
  return JSON.stringify(data, null, 2);
}

async function parseMarkdown(buffer, options = {}) {
  const encoding = options.encoding || detectEncoding(buffer);
  return encoding === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, encoding);
}

async function parseHTML(buffer, options = {}) {
  const encoding = options.encoding || detectEncoding(buffer);
  const text = encoding === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, encoding);
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function parseDocument(buffer, fileType, options = {}) {
  const type = String(fileType || '').toLowerCase();
  
  // Office 文档
  if (type.includes('wordprocessingml') || type.includes('.docx') || type === 'docx' || type === '.docx') return await parseDOCX(buffer);
  if (type.includes('pdf') || type === 'pdf' || type === '.pdf') return await parsePDF(buffer);
  if (type.includes('spreadsheetml') || type.includes('excel') || type === 'xlsx' || type === 'xls' || type === '.xlsx' || type === '.xls') return await parseExcel(buffer);
  
  // 数据格式
  if (type.includes('csv') || type === 'csv' || type === '.csv') return await parseCSV(buffer, options);
  if (type.includes('xml') || type === 'xml' || type === '.xml') return await parseXML(buffer, options);
  if (type.includes('json') || type === 'json' || type === '.json') return await parseJSON(buffer, options);
  
  // Web 格式
  if (type.includes('markdown') || type === 'md' || type === '.md') return await parseMarkdown(buffer, options);
  if (type.includes('html') || type === 'html' || type === 'htm' || type === '.html' || type === '.htm') return await parseHTML(buffer, options);
  
  // 编程语言文件（作为文本处理）
  const codeExtensions = [
    '.py', '.js', '.ts', '.jsx', '.tsx', '.vue', '.java', '.go', '.c', '.cpp', '.h', '.hpp', 
    '.cs', '.php', '.rb', '.swift', '.kt', '.rs', '.scala', '.r', '.m', '.sh', '.bash', 
    '.sql', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.properties', 
    '.log', '.css', '.scss', '.sass', '.less', '.dart', '.lua', '.pl', '.pm'
  ];
  if (codeExtensions.some(ext => type === ext || type.endsWith(ext))) return await parseTXT(buffer, options);
  
  // 默认作为文本处理
  return await parseTXT(buffer, options);
}

async function fetchDocument(src) {
  let buffer; let mimeType = ''; let ext = '';
  if (isHttpUrl(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    const ct = (res.headers?.get?.('content-type') || '').split(';')[0].trim();
    if (ct) mimeType = ct;
    try { const u = new URL(src); ext = path.extname(u.pathname).toLowerCase(); } catch {}
  } else {
    const absPath = path.resolve(src);
    if (!path.isAbsolute(absPath)) throw new Error('Local file path must be absolute');
    buffer = await fs.readFile(absPath);
    ext = path.extname(absPath).toLowerCase();
    mimeType = String(mime.lookup(absPath) || '');
  }
  return { buffer, mimeType, ext };
}

export default async function handler(args = {}, options = {}) {
  const files = Array.isArray(args.files) ? args.files : [];
  const encoding = String(args.encoding || '').trim() || undefined;
  
  // 从环境变量读取文件大小限制
  const penv = options?.pluginEnv || {};
  const maxFileSizeMB = Number(penv.DOC_MAX_FILE_SIZE_MB || process.env.DOC_MAX_FILE_SIZE_MB || 10);
  
  if (!files.length) return { success: false, code: 'INVALID', error: 'files is required (array of urls or absolute paths)' };
  
  logger.info?.('document_read:start', { label: 'PLUGIN', fileCount: files.length, encoding, maxFileSizeMB });
  const results = [];
  
  for (const file of files) {
    try {
      const { buffer, mimeType, ext } = await fetchDocument(file);
      const sizeMB = buffer.length / (1024 * 1024);
      if (sizeMB > maxFileSizeMB) throw new Error(`File size ${sizeMB.toFixed(2)}MB exceeds limit of ${maxFileSizeMB}MB`);
      
      logger.info?.('document_read:file_loaded', { label: 'PLUGIN', file, mimeType, ext, sizeMB: sizeMB.toFixed(2) });
      const fileType = mimeType || ext;
      const content = await parseDocument(buffer, fileType, { encoding });
      
      results.push({ file, type: fileType, size_mb: sizeMB.toFixed(2), content, length: content.length });
      logger.info?.('document_read:parsed', { label: 'PLUGIN', file, type: fileType, contentLength: content.length });
    } catch (e) {
      logger.warn?.('document_read:parse_failed', { label: 'PLUGIN', file, error: String(e?.message || e) });
      results.push({ file, error: String(e?.message || e), success: false });
    }
  }
  
  const successCount = results.filter(r => !r.error).length;
  if (successCount === 0) return { success: false, code: 'ALL_FAILED', error: 'All files failed to parse', data: { results } };
  return { success: true, data: { files: results, total: files.length, success: successCount, failed: files.length - successCount } };
}
