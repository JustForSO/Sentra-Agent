import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import logger from '../../src/logger/index.js';
import { abs as toAbs } from '../../src/utils/path.js';

// 获取当前文件所在目录（插件目录）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 文件类型检测
function detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const typeMap = {
    '.txt': 'text',
    '.md': 'text',
    '.json': 'json',
    '.xml': 'text',
    '.html': 'text',
    '.css': 'text',
    '.js': 'text',
    '.ts': 'text',
    '.yaml': 'text',
    '.yml': 'text',
    '.xlsx': 'excel',
    '.xls': 'excel',
    '.docx': 'word',
    '.doc': 'word',
    '.pdf': 'pdf',
    '.csv': 'csv',
    '.zip': 'zip',
    '.bin': 'binary',
    '.dat': 'binary',
  };
  
  return typeMap[ext] || 'auto';
}

async function writeExcelFile(absPath, data) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  
  // 支持两种数据格式：
  // 1. { sheets: [{ name, data: [[]] }] } - 多个工作表
  // 2. [[]] - 单个工作表数据
  
  if (Array.isArray(data)) {
    // 单个工作表
    const worksheet = workbook.addWorksheet('Sheet1');
    data.forEach(row => worksheet.addRow(row));
    
    // 自动调整列宽
    worksheet.columns.forEach(column => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, cell => {
        const length = cell.value ? String(cell.value).length : 10;
        maxLength = Math.max(maxLength, length);
      });
      column.width = Math.min(maxLength + 2, 50);
    });
    
  } else if (data.sheets && Array.isArray(data.sheets)) {
    // 多个工作表
    data.sheets.forEach(sheet => {
      const worksheet = workbook.addWorksheet(sheet.name || 'Sheet');
      
      if (sheet.data && Array.isArray(sheet.data)) {
        sheet.data.forEach(row => worksheet.addRow(row));
        
        // 自动调整列宽
        worksheet.columns.forEach(column => {
          let maxLength = 0;
          column.eachCell({ includeEmpty: true }, cell => {
            const length = cell.value ? String(cell.value).length : 10;
            maxLength = Math.max(maxLength, length);
          });
          column.width = Math.min(maxLength + 2, 50);
        });
      }
      
      // 应用样式
      if (sheet.style) {
        const { headerRow, fontSize, bold } = sheet.style;
        if (headerRow) {
          const header = worksheet.getRow(1);
          header.font = { bold: true, size: fontSize || 12 };
          header.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
          };
        }
      }
    });
  } else {
    throw new Error('Excel 数据格式错误：必须是数组 [[]] 或对象 { sheets: [...] }');
  }
  
  await workbook.xlsx.writeFile(absPath);
  const stats = await fs.stat(absPath);
  return { path: absPath, size: stats.size, type: 'excel' };
}

async function writeWordFile(absPath, data) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  
  // 支持两种数据格式：
  // 1. { sections: [{ children: [...] }] } - 完整结构
  // 2. string - 纯文本
  // 3. { paragraphs: ['text1', 'text2'] } - 段落数组
  
  let doc;
  
  if (typeof data === 'string') {
    // 纯文本，按行分段
    const paragraphs = data.split('\n').map(line => 
      new Paragraph({
        children: [new TextRun(line)],
      })
    );
    doc = new Document({ sections: [{ children: paragraphs }] });
    
  } else if (data.paragraphs && Array.isArray(data.paragraphs)) {
    // 段落数组
    const paragraphs = data.paragraphs.map((p, index) => {
      if (typeof p === 'string') {
        return new Paragraph({
          children: [new TextRun(p)],
        });
      } else if (p.heading) {
        return new Paragraph({
          text: p.text || '',
          heading: HeadingLevel[`HEADING_${p.level || 1}`],
        });
      } else {
        return new Paragraph({
          children: [new TextRun({
            text: p.text || '',
            bold: p.bold,
            italics: p.italics,
            underline: p.underline ? {} : undefined,
            size: p.fontSize ? p.fontSize * 2 : undefined, // 半点
          })],
        });
      }
    });
    doc = new Document({ sections: [{ children: paragraphs }] });
    
  } else if (data.sections) {
    // 完整结构（高级用法）
    doc = new Document(data);
  } else {
    throw new Error('Word 数据格式错误');
  }
  
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(absPath, buffer);
  return { path: absPath, size: buffer.length, type: 'word' };
}

// 检测是否包含中文
function hasChinese(text) {
  if (!text) return false;
  if (typeof text !== 'string') return false;
  return /[\u4e00-\u9fa5]/.test(text);
}

// 检测内容中是否有中文
function hasChineseInContent(data) {
  if (typeof data === 'string') {
    return hasChinese(data);
  }
  
  if (data.title && hasChinese(data.title)) return true;
  if (data.footer && hasChinese(data.footer)) return true;
  
  if (data.content) {
    if (typeof data.content === 'string') {
      return hasChinese(data.content);
    }
    if (Array.isArray(data.content)) {
      return data.content.some(item => {
        if (typeof item === 'string') return hasChinese(item);
        if (item.text) return hasChinese(item.text);
        return false;
      });
    }
  }
  
  return false;
}

// 获取中文字体路径（只使用插件内置字体）
function getChineseFontPath() {
  // 从环境变量读取配置
  const customFontDir = process.env.WRITE_FILE_FONT_DIR || 'fonts';
  const customFontName = process.env.WRITE_FILE_FONT_NAME || 'AaRiFuYiRiKeAiYuan-2.ttf';
  
  // 构建字体路径候选列表（按优先级）
  const fontCandidates = [
    path.join(__dirname, customFontDir, customFontName),
    path.join(__dirname, customFontName),
  ];
  
  // 查找第一个存在的字体文件
  for (const fontPath of fontCandidates) {
    if (fssync.existsSync(fontPath)) {
      const fontSizeMB = (fssync.statSync(fontPath).size / 1024 / 1024).toFixed(2);
      logger.info?.('write_file', `✅ 使用插件字体: ${path.basename(fontPath)} (${fontSizeMB} MB)`, { label: 'PLUGIN' });
      logger.debug?.('write_file', `   路径: ${fontPath}`, { label: 'PLUGIN' });
      return fontPath;
    }
  }
  
  return null;
}

async function writePdfFile(absPath, data) {
  const PDFDocument = (await import('pdfkit')).default;
  
  return new Promise((resolve, reject) => {
    try {
      // 检测是否需要中文支持
      const needChineseFont = hasChineseInContent(data);
      const chineseFontPath = needChineseFont ? getChineseFontPath() : null;
      
      // 创建 PDF 文档，如果有中文字体就注册
      const docOptions = {};
      const doc = new PDFDocument(docOptions);
      const stream = fssync.createWriteStream(absPath);
      
      doc.pipe(stream);
      
      // 如果有中文字体，注册字体
      if (chineseFontPath) {
        try {
          doc.registerFont('ChineseFont', chineseFontPath);
          doc.font('ChineseFont');
        } catch (fontErr) {
          logger.error?.('write_file', `中文字体注册失败: ${fontErr.message}，PDF 中文可能显示为方块`, { label: 'PLUGIN' });
        }
      } else if (needChineseFont) {
        logger.warn?.('write_file', 'PDF 包含中文但未找到中文字体，文字可能显示为方块', { label: 'PLUGIN' });
      }
      
      // 支持两种数据格式：
      // 1. string - 纯文本
      // 2. { title, content, options } - 结构化内容
      
      if (typeof data === 'string') {
        doc.fontSize(12).text(data, 100, 100);
      } else {
        // 标题
        if (data.title) {
          doc.fontSize(20).text(data.title, { align: 'center' });
          doc.moveDown(2);
        }
        
        // 内容
        if (data.content) {
          if (typeof data.content === 'string') {
            doc.fontSize(12).text(data.content);
          } else if (Array.isArray(data.content)) {
            // 段落数组
            data.content.forEach(para => {
              if (typeof para === 'string') {
                doc.fontSize(12).text(para);
                doc.moveDown(0.5);
              } else {
                const fontSize = para.fontSize || 12;
                const options = {
                  align: para.align || 'left',
                  underline: para.underline || false,
                };
                doc.fontSize(fontSize).text(para.text || '', options);
                doc.moveDown(0.5);
              }
            });
          }
        }
        
        // 页脚
        if (data.footer) {
          doc.fontSize(10).text(data.footer, 50, doc.page.height - 50, {
            align: 'center',
          });
        }
      }
      
      doc.end();
      
      stream.on('finish', async () => {
        const stats = await fs.stat(absPath);
        resolve({ path: absPath, size: stats.size, type: 'pdf' });
      });
      
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

async function writeCsvFile(absPath, data) {
  const { createObjectCsvWriter } = await import('csv-writer');
  
  // 支持两种数据格式：
  // 1. { headers, records } - 完整结构
  // 2. [[]] - 二维数组
  
  if (Array.isArray(data) && data.length > 0) {
    // 二维数组：第一行作为表头
    const headers = data[0].map((header, index) => ({
      id: `col${index}`,
      title: String(header)
    }));
    
    const records = data.slice(1).map(row => {
      const record = {};
      row.forEach((cell, index) => {
        record[`col${index}`] = cell;
      });
      return record;
    });
    
    const csvWriter = createObjectCsvWriter({
      path: absPath,
      header: headers
    });
    
    await csvWriter.writeRecords(records);
    
  } else if (data.headers && data.records) {
    // 完整结构
    const csvWriter = createObjectCsvWriter({
      path: absPath,
      header: data.headers
    });
    
    await csvWriter.writeRecords(data.records);
  } else {
    throw new Error('CSV 数据格式错误：必须是二维数组 [[]] 或对象 { headers, records }');
  }
  
  const stats = await fs.stat(absPath);
  return { path: absPath, size: stats.size, type: 'csv' };
}

// ==================== ZIP 文件处理 ====================
async function writeZipFile(absPath, data) {
  const archiver = (await import('archiver')).default;
  
  return new Promise((resolve, reject) => {
    const output = fssync.createWriteStream(absPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      resolve({ path: absPath, size: archive.pointer(), type: 'zip' });
    });
    
    archive.on('error', reject);
    archive.pipe(output);
    
    // 支持两种数据格式：
    // 1. { files: [{ name, content }] } - 文件列表
    // 2. { directory: '/path/to/dir' } - 压缩整个目录
    
    if (data.files && Array.isArray(data.files)) {
      data.files.forEach(file => {
        if (file.path) {
          // 添加已存在的文件
          archive.file(file.path, { name: file.name || path.basename(file.path) });
        } else if (file.content) {
          // 添加内容
          archive.append(file.content, { name: file.name });
        }
      });
    } else if (data.directory) {
      // 压缩整个目录
      archive.directory(data.directory, false);
    } else {
      reject(new Error('ZIP 数据格式错误'));
      return;
    }
    
    archive.finalize();
  });
}

async function writeJsonFile(absPath, data) {
  const jsonString = JSON.stringify(data, null, 2);
  await fs.writeFile(absPath, jsonString, 'utf-8');
  const stats = await fs.stat(absPath);
  return { path: absPath, size: stats.size, type: 'json' };
}

async function writeTextFile(absPath, content, encoding = 'utf-8') {
  const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  await fs.writeFile(absPath, data, { encoding });
  const stats = await fs.stat(absPath);
  return { path: absPath, size: stats.size, type: 'text' };
}

async function writeBinaryFile(absPath, content) {
  let buffer;
  
  if (Buffer.isBuffer(content)) {
    buffer = content;
  } else if (typeof content === 'string') {
    // 假设是 base64 编码
    buffer = Buffer.from(content, 'base64');
  } else {
    throw new Error('二进制内容必须是 Buffer 或 base64 字符串');
  }
  
  await fs.writeFile(absPath, buffer);
  return { path: absPath, size: buffer.length, type: 'binary' };
}

async function doWrite(absPath, content, options = {}) {
  const abs = toAbs(absPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  
  const exists = fssync.existsSync(abs);
  const overwrite = options.overwrite !== false;
  
  if (exists && !overwrite) {
    throw new Error('文件已存在且 overwrite=false');
  }
  
  // 自动检测文件类型
  const fileType = options.fileType || detectFileType(abs);
  const encoding = options.encoding || 'utf-8';
  
  logger.debug?.('write_file', `写入文件类型: ${fileType}, 路径: ${abs}`, { label: 'PLUGIN' });
  
  try {
    switch (fileType) {
      case 'excel':
        return await writeExcelFile(abs, content);
        
      case 'word':
        return await writeWordFile(abs, content);
        
      case 'pdf':
        return await writePdfFile(abs, content);
        
      case 'csv':
        return await writeCsvFile(abs, content);
        
      case 'zip':
        return await writeZipFile(abs, content);
        
      case 'json':
        return await writeJsonFile(abs, content);
        
      case 'binary':
        return await writeBinaryFile(abs, content);
        
      case 'text':
      case 'auto':
      default:
        // base64 编码的二进制数据
        if (encoding === 'base64' && typeof content === 'string') {
          return await writeBinaryFile(abs, content);
        }
        // 普通文本
        return await writeTextFile(abs, content, encoding);
    }
  } catch (error) {
    logger.error?.('write_file', `写入文件失败: ${error.message}`, { label: 'PLUGIN' });
    throw error;
  }
}

// ==================== Markdown 路径格式化 ====================
function toMarkdownPath(abs) {
  const label = path.basename(abs);
  return `![${label}](${abs})`;
}

// ==================== 主处理函数 ====================
export default async function handler(args = {}, options = {}) {
  const rawPath = args.path;
  
  if (!rawPath || typeof rawPath !== 'string') {
    return { success: false, code: 'INVALID', error: 'path 是必须的字符串参数' };
  }
  
  if (args.content === undefined) {
    return { success: false, code: 'INVALID', error: 'content 不能为空' };
  }
  
  try {
    const penv = options?.pluginEnv || {};
    const baseDir = String(args.baseDir || penv.WRITE_FILE_BASE_DIR || 'artifacts');
    const baseAbs = toAbs(baseDir);
    const abs = path.isAbsolute(rawPath) ? toAbs(rawPath) : toAbs(path.join(baseAbs, rawPath));
    
    const writeOptions = {
      encoding: args.encoding || 'utf-8',
      overwrite: args.overwrite !== false,
      fileType: args.fileType, // 可选：手动指定文件类型
    };
    
    logger.info?.('write_file', `开始写入文件: ${abs}`, { label: 'PLUGIN' });
    
    const res = await doWrite(abs, args.content, writeOptions);
    const { size, type } = res || {};
    
    logger.info?.('write_file', `文件写入成功: ${abs}, 大小: ${size} 字节, 类型: ${type}`, { label: 'PLUGIN' });
    
    return {
      success: true,
      data: {
        action: 'write_file',
        path: abs,
        path_markdown: toMarkdownPath(abs),
        size,
        fileType: type,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (e) {
    logger.error?.('write_file error', { label: 'PLUGIN', error: String(e?.message || e) });
    return { 
      success: false, 
      code: 'ERR', 
      error: String(e?.message || e),
      stack: e?.stack 
    };
  }
}
