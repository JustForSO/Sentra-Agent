/**
 * 系统信息相关函数模块
 * 提供系统、环境等信息
 */

import os from 'os';
import process from 'process';
import si from 'systeminformation';

/**
 * 获取系统信息
 * @returns {string} 系统信息
 */
export function getSystemInfo() {
  const platform = os.platform();
  const arch = os.arch();
  const hostname = os.hostname();
  
  return `${platform} ${arch} (${hostname})`;
}

/**
 * 获取Node.js版本
 * @returns {string} Node版本
 */
export function getNodeVersion() {
  return process.version;
}

/**
 * 获取操作系统类型
 * @returns {string} 操作系统类型
 */
export function getOSType() {
  return os.type();
}

/**
 * 获取操作系统平台
 * @returns {string} 平台名称
 */
export function getPlatform() {
  return os.platform();
}

/**
 * 获取系统架构
 * @returns {string} 架构类型
 */
export function getArchitecture() {
  return os.arch();
}

/**
 * 获取主机名
 * @returns {string} 主机名
 */
export function getHostname() {
  return os.hostname();
}

/**
 * 获取CPU核心数
 * @returns {number} CPU核心数
 */
export function getCPUCount() {
  return os.cpus().length;
}

/**
 * 获取总内存（GB）
 * @returns {string} 总内存
 */
export function getTotalMemory() {
  const totalMem = os.totalmem();
  const totalMemGB = (totalMem / (1024 ** 3)).toFixed(2);
  return `${totalMemGB} GB`;
}

/**
 * 获取可用内存（GB）
 * @returns {string} 可用内存
 */
export function getFreeMemory() {
  const freeMem = os.freemem();
  const freeMemGB = (freeMem / (1024 ** 3)).toFixed(2);
  return `${freeMemGB} GB`;
}

/**
 * 获取系统运行时间
 * @returns {string} 运行时间
 */
export function getSystemUptime() {
  const uptime = os.uptime();
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  
  return `${days}天${hours}小时${minutes}分钟`;
}

/**
 * 获取当前用户名
 * @returns {string} 用户名
 */
export function getUsername() {
  return os.userInfo().username;
}

/**
 * 获取当前进程ID
 * @returns {number} 进程ID
 */
export function getProcessId() {
  return process.pid;
}

/**
 * 获取当前工作目录
 * @returns {string} 工作目录
 */
export function getCurrentDirectory() {
  return process.cwd();
}

/**
 * 获取环境变量
 * @param {string} key - 环境变量名
 * @returns {string} 环境变量值
 */
export function getEnvVariable(key) {
  return process.env[key] || '';
}

// ==============================
// 扩展：GPU 与详细系统信息
// 依赖：systeminformation
// ==============================

// 简易缓存，减少底层命令重复执行引起的控制台噪音（例如 Windows 上的路径提示）
const __siCache = {
  graphics: null,
  graphicsAt: 0,
  osInfo: null,
  osInfoAt: 0,
  cpu: null,
  cpuAt: 0,
  mem: null,
  memAt: 0,
  fsSize: null,
  fsSizeAt: 0,
  currentLoad: null,
  currentLoadAt: 0,
  network: null,
  networkAt: 0
};

async function graphicsCached(ttlMs = 15000) {
  const now = Date.now();
  if (__siCache.graphics && now - __siCache.graphicsAt < ttlMs) {
    return __siCache.graphics;
  }
  const g = await si.graphics();
  __siCache.graphics = g;
  __siCache.graphicsAt = now;
  return g;
}

function cacheWrap(key, fetcher, ttlMs = 15000) {
  return async () => {
    const now = Date.now();
    const val = __siCache[key];
    const at = __siCache[key + 'At'];
    if (val && now - at < ttlMs) return val;
    const fresh = await fetcher();
    __siCache[key] = fresh;
    __siCache[key + 'At'] = now;
    return fresh;
  };
}

const osInfoCached = cacheWrap('osInfo', () => si.osInfo());
const cpuCached = cacheWrap('cpu', () => si.cpu());
const memCached = cacheWrap('mem', () => si.mem());
const fsSizeCached = cacheWrap('fsSize', () => si.fsSize());
const currentLoadCached = cacheWrap('currentLoad', () => si.currentLoad());
const networkCached = cacheWrap('network', () => si.networkInterfaces());

/**
 * 获取GPU信息摘要
 * @returns {Promise<string>} GPU摘要（厂商 型号 (显存MB)）
 */
export async function getGPUInfo() {
  try {
    const g = await graphicsCached();
    if (!g || !Array.isArray(g.controllers) || g.controllers.length === 0) {
      return '未检测到GPU';
    }
    const parts = g.controllers.map(c => {
      const vram = Math.round(c.vram || c.vramDynamic || 0);
      const vramStr = vram ? ` (${vram} MB)` : '';
      return `${c.vendor || ''} ${c.model || ''}${vramStr}`.trim();
    });
    return parts.join(', ');
  } catch (e) {
    return `GPU信息获取失败: ${e.message}`;
  }
}

/**
 * 获取GPU数量
 * @returns {Promise<number>} GPU数量
 */
export async function getGPUCount() {
  try {
    const g = await graphicsCached();
    return Array.isArray(g.controllers) ? g.controllers.length : 0;
  } catch {
    return 0;
  }
}

/**
 * 获取CPU型号
 * @returns {Promise<string>} CPU型号
 */
export async function getCPUModel() {
  try {
    const cpu = await si.cpu();
    return cpu?.brand || cpu?.manufacturer || '未知CPU';
  } catch (e) {
    return `CPU信息获取失败: ${e.message}`;
  }
}

/**
 * 获取CPU当前负载
 * @returns {Promise<string>} 负载百分比字符串
 */
export async function getCPULoad() {
  try {
    const load = await currentLoadCached();
    // 兼容不同字段与异常情况
    let val = null;
    if (typeof load?.currentload === 'number') {
      val = load.currentload;
    } else if (typeof load?.currentLoad === 'number') {
      val = load.currentLoad;
    } else if (typeof load?.avgload === 'number') {
      val = load.avgload;
    } else if (Array.isArray(load?.cpus) && typeof load.cpus[0]?.load === 'number') {
      val = load.cpus[0].load;
    }
    return typeof val === 'number' ? `${Number(val).toFixed(1)}%` : 'N/A';
  } catch (e) {
    return `CPU负载获取失败: ${e.message}`;
  }
}

/**
 * 获取内存详细信息（已用/总量 与占比）
 * @returns {Promise<string>} 内存用量字符串
 */
export async function getMemoryDetail() {
  try {
    const m = await memCached();
    const totalGB = m.total / (1024 ** 3);
    const usedGB = (m.total - m.available) / (1024 ** 3);
    const pct = (usedGB / totalGB) * 100;
    return `${usedGB.toFixed(2)} / ${totalGB.toFixed(2)} GB (${pct.toFixed(1)}%)`;
  } catch (e) {
    return `内存信息获取失败: ${e.message}`;
  }
}

/**
 * 获取磁盘容量摘要（合计）
 * @returns {Promise<string>} 磁盘容量字符串
 */
export async function getDiskInfo() {
  try {
    const disks = await fsSizeCached();
    if (!Array.isArray(disks) || disks.length === 0) return '未检测到磁盘';
    const total = disks.reduce((acc, d) => acc + (d.size || 0), 0);
    const used = disks.reduce((acc, d) => acc + (d.used || 0), 0);
    const totalGB = total / (1024 ** 3);
    const usedGB = used / (1024 ** 3);
    const pct = total ? (used / total) * 100 : 0;
    return `${usedGB.toFixed(2)} / ${totalGB.toFixed(2)} GB (${pct.toFixed(1)}%)`;
  } catch (e) {
    return `磁盘信息获取失败: ${e.message}`;
  }
}

/**
 * 获取操作系统版本信息
 * @returns {Promise<string>} OS版本与版本号
 */
export async function getOSVersion() {
  try {
    const info = await osInfoCached();
    const platform = (info?.platform || os.platform() || '').toLowerCase();
    const version = info?.release || info?.build || '';

    // Windows: 优先使用 Node 的 API，避免 distro 文本乱码
    if (platform.startsWith('win')) {
      const name = typeof os.version === 'function' ? os.version() : 'Windows';
      return version ? `${name} ${version}` : name;
    }

    // 其他平台保留原策略
    let name = info?.distro || info?.codename || info?.platform || '';
    return version ? `${name} ${version}` : name;
  } catch (e) {
    return `OS信息获取失败: ${e.message}`;
  }
}

/**
 * 获取网络接口摘要（IPv4）
 * @returns {Promise<string>} 接口名:IP 列表
 */
export async function getNetworkSummary() {
  try {
    const nics = await networkCached();
    const list = nics
      .filter(n => n.ip4)
      .map(n => `${n.iface}:${n.ip4}`);
    return list.length ? list.join(', ') : '无IPv4地址';
  } catch (e) {
    return `网络信息获取失败: ${e.message}`;
  }
}

/**
 * 系统摘要（适合展示）
 * @returns {Promise<string>} 多行摘要
 */
export async function getSystemSummary() {
  const [osv, cpuModel, cpuLoad, mem, disk, gpu, nics] = await Promise.all([
    getOSVersion(),
    getCPUModel(),
    getCPULoad(),
    getMemoryDetail(),
    getDiskInfo(),
    getGPUInfo(),
    getNetworkSummary()
  ]);
  return [
    `系统: ${osv}`,
    `CPU: ${cpuModel} | 负载: ${cpuLoad}`,
    `内存: ${mem}`,
    `磁盘: ${disk}`,
    `GPU: ${gpu}`,
    `网络: ${nics}`
  ].join('\n');
}

/**
 * 获取完整系统信息（JSON字符串）
 * @returns {Promise<string>} JSON字符串
 */
export async function getFullSystemJSON() {
  try {
    const [osInfo, cpu, mem, fsSize, currentLoad, net, graphics] = await Promise.all([
      osInfoCached(),
      cpuCached(),
      memCached(),
      fsSizeCached(),
      currentLoadCached(),
      networkCached(),
      graphicsCached()
    ]);
    const payload = { osInfo, cpu, mem, graphics, fsSize, currentLoad, network: net };
    return JSON.stringify(payload, null, 2);
  } catch (e) {
    return JSON.stringify({ error: `获取系统信息失败: ${e.message}` });
  }
}
