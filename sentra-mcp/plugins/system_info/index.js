import os from 'node:os';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import logger from '../../src/logger/index.js';

// 内存缓存: Map<key, { expireAt: number, data: any }>
const memCache = new Map();

function now() { return Date.now(); }

function execCmd(cmd, fallback = null) {
  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    return output.trim();
  } catch {
    return fallback;
  }
}

// 缓存相关函数
function getCacheDir() {
  return path.resolve(process.cwd(), 'cache', 'system_info');
}

async function ensureCacheDir() {
  await fsp.mkdir(getCacheDir(), { recursive: true });
}

function getCacheKey(categories, detailed) {
  const sortedCategories = [...categories].sort().join(',');
  return `${sortedCategories}:${detailed}`;
}

function getCacheFilePath(cacheKey) {
  const safeKey = cacheKey.replace(/[^\w,-]/g, '_');
  return path.join(getCacheDir(), `${safeKey}.json`);
}

async function readFileCache(cacheKey) {
  try {
    const p = getCacheFilePath(cacheKey);
    const txt = await fsp.readFile(p, 'utf-8');
    const cached = JSON.parse(txt);
    if (cached.expireAt && Number(cached.expireAt) > now()) {
      return cached.data || null;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeFileCache(cacheKey, data, ttlSec) {
  try {
    await ensureCacheDir();
    const p = getCacheFilePath(cacheKey);
    const cacheObj = {
      expireAt: now() + ttlSec * 1000,
      data,
      cachedAt: new Date().toISOString()
    };
    await fsp.writeFile(p, JSON.stringify(cacheObj, null, 2), 'utf-8');
  } catch (e) {
    logger.warn?.('system_info:write_cache_failed', { label: 'PLUGIN', error: String(e?.message || e) });
  }
}

function getFromMem(cacheKey) {
  const v = memCache.get(cacheKey);
  if (v && v.expireAt > now()) return v.data;
  return null;
}

function setToMem(cacheKey, data, ttlSec) {
  memCache.set(cacheKey, { expireAt: now() + ttlSec * 1000, data });
}

function bytesToGB(bytes) {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}

function getOSInfo(detailed = true) {
  const platform = os.platform();
  const type = os.type();
  const release = os.release();
  const arch = os.arch();
  const hostname = os.hostname();
  const uptime = os.uptime();

  const info = {
    platform,
    type,
    release,
    arch,
    hostname,
    uptime_seconds: uptime,
    uptime_human: formatUptime(uptime),
  };

  if (detailed) {
    if (platform === 'win32') {
      const osName = execCmd('wmic os get Caption /value', '').split('=')[1] || 'Windows';
      const osVersion = execCmd('wmic os get Version /value', '').split('=')[1] || release;
      const osBuildNumber = execCmd('wmic os get BuildNumber /value', '').split('=')[1] || '';
      info.os_name = osName.trim();
      info.os_version = osVersion.trim();
      info.os_build = osBuildNumber.trim();
    } else if (platform === 'linux') {
      const osRelease = execCmd('cat /etc/os-release 2>/dev/null || echo ""');
      if (osRelease) {
        const lines = osRelease.split('\n');
        for (const line of lines) {
          if (line.startsWith('PRETTY_NAME=')) {
            info.os_name = line.split('=')[1].replace(/"/g, '').trim();
          }
          if (line.startsWith('VERSION_ID=')) {
            info.os_version = line.split('=')[1].replace(/"/g, '').trim();
          }
        }
      }
      info.kernel = execCmd('uname -r', '');
    } else if (platform === 'darwin') {
      info.os_name = execCmd('sw_vers -productName', 'macOS');
      info.os_version = execCmd('sw_vers -productVersion', '');
      info.os_build = execCmd('sw_vers -buildVersion', '');
    }
  }

  return info;
}

function getCPUInfo(detailed = true) {
  const cpus = os.cpus();
  const model = cpus[0]?.model || 'Unknown';
  const cores = cpus.length;
  const speed = cpus[0]?.speed || 0;

  const info = {
    model,
    cores,
    speed_mhz: speed,
    architecture: os.arch(),
  };

  if (detailed) {
    const platform = os.platform();
    if (platform === 'win32') {
      const procName = execCmd('wmic cpu get Name /value', '').split('=')[1] || model;
      const procCores = execCmd('wmic cpu get NumberOfCores /value', '').split('=')[1] || cores;
      const procThreads = execCmd('wmic cpu get NumberOfLogicalProcessors /value', '').split('=')[1] || cores;
      info.name = procName.trim();
      info.physical_cores = parseInt(procCores) || cores;
      info.logical_processors = parseInt(procThreads) || cores;
    } else if (platform === 'linux') {
      const cpuinfo = execCmd('lscpu 2>/dev/null || cat /proc/cpuinfo', '');
      if (cpuinfo.includes('Model name')) {
        const match = cpuinfo.match(/Model name:\s*(.+)/);
        if (match) info.name = match[1].trim();
      }
      if (cpuinfo.includes('CPU(s):')) {
        const match = cpuinfo.match(/^CPU\(s\):\s*(\d+)/m);
        if (match) info.logical_processors = parseInt(match[1]);
      }
      if (cpuinfo.includes('Core(s) per socket:')) {
        const match = cpuinfo.match(/Core\(s\) per socket:\s*(\d+)/);
        if (match) info.physical_cores = parseInt(match[1]);
      }
    } else if (platform === 'darwin') {
      info.name = execCmd('sysctl -n machdep.cpu.brand_string', model);
      info.physical_cores = parseInt(execCmd('sysctl -n hw.physicalcpu', cores));
      info.logical_processors = parseInt(execCmd('sysctl -n hw.logicalcpu', cores));
    }

    // CPU usage
    const loadAvg = os.loadavg();
    info.load_average = {
      '1min': loadAvg[0].toFixed(2),
      '5min': loadAvg[1].toFixed(2),
      '15min': loadAvg[2].toFixed(2),
    };
  }

  return info;
}

function getMemoryInfo(detailed = true) {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const info = {
    total_bytes: totalMem,
    free_bytes: freeMem,
    used_bytes: usedMem,
    total_gb: bytesToGB(totalMem),
    free_gb: bytesToGB(freeMem),
    used_gb: bytesToGB(usedMem),
    usage_percent: ((usedMem / totalMem) * 100).toFixed(2),
  };

  if (detailed) {
    const platform = os.platform();
    if (platform === 'win32') {
      const memInfo = execCmd('wmic computersystem get TotalPhysicalMemory /value', '').split('=')[1];
      if (memInfo) info.total_physical_gb = bytesToGB(parseInt(memInfo.trim()));
    } else if (platform === 'linux') {
      const meminfo = execCmd('cat /proc/meminfo', '');
      if (meminfo) {
        const totalMatch = meminfo.match(/MemTotal:\s+(\d+)/);
        const availMatch = meminfo.match(/MemAvailable:\s+(\d+)/);
        if (totalMatch) info.total_kb = parseInt(totalMatch[1]);
        if (availMatch) info.available_kb = parseInt(availMatch[1]);
      }
    } else if (platform === 'darwin') {
      const memSize = execCmd('sysctl -n hw.memsize', '0');
      if (memSize) info.total_physical_gb = bytesToGB(parseInt(memSize));
    }
  }

  return info;
}

function getGPUInfo(detailed = true) {
  const platform = os.platform();
  const gpus = [];

  try {
    if (platform === 'win32') {
      // Try NVIDIA first
      const nvidiaOutput = execCmd('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>nul', null);
      if (nvidiaOutput) {
        const lines = nvidiaOutput.split('\n').filter(Boolean);
        for (const line of lines) {
          const [name, memory, driver] = line.split(',').map(s => s.trim());
          gpus.push({ vendor: 'NVIDIA', name, memory, driver_version: driver });
        }
      }

      // Fallback to wmic
      if (gpus.length === 0) {
        const wmicOutput = execCmd('wmic path win32_VideoController get Name,AdapterRAM,DriverVersion /format:csv', null);
        if (wmicOutput) {
          const lines = wmicOutput.split('\n').filter(l => l && !l.startsWith('Node'));
          for (const line of lines) {
            const parts = line.split(',');
            if (parts.length >= 3) {
              const ram = parseInt(parts[1]) || 0;
              gpus.push({
                name: parts[2]?.trim() || 'Unknown',
                memory_bytes: ram,
                memory_gb: ram > 0 ? bytesToGB(ram) : null,
                driver_version: parts[3]?.trim() || null,
              });
            }
          }
        }
      }
    } else if (platform === 'linux') {
      // Try NVIDIA
      const nvidiaOutput = execCmd('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>/dev/null', null);
      if (nvidiaOutput) {
        const lines = nvidiaOutput.split('\n').filter(Boolean);
        for (const line of lines) {
          const [name, memory, driver] = line.split(',').map(s => s.trim());
          gpus.push({ vendor: 'NVIDIA', name, memory, driver_version: driver });
        }
      }

      // Fallback to lspci
      if (gpus.length === 0) {
        const lspciOutput = execCmd('lspci | grep -i vga 2>/dev/null', null);
        if (lspciOutput) {
          const lines = lspciOutput.split('\n').filter(Boolean);
          for (const line of lines) {
            const match = line.match(/VGA compatible controller:\s*(.+)/);
            if (match) gpus.push({ name: match[1].trim() });
          }
        }
      }
    } else if (platform === 'darwin') {
      const sysProfiler = execCmd('system_profiler SPDisplaysDataType 2>/dev/null', null);
      if (sysProfiler) {
        const lines = sysProfiler.split('\n');
        let currentGPU = null;
        for (const line of lines) {
          if (line.includes('Chipset Model:')) {
            const match = line.match(/Chipset Model:\s*(.+)/);
            if (match) {
              currentGPU = { name: match[1].trim() };
              gpus.push(currentGPU);
            }
          }
          if (currentGPU && line.includes('VRAM')) {
            const match = line.match(/VRAM[^:]*:\s*(.+)/);
            if (match) currentGPU.memory = match[1].trim();
          }
        }
      }
    }
  } catch (e) {
    logger.warn('GPU info extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return gpus.length > 0 ? gpus : [{ name: 'No discrete GPU detected or unable to query' }];
}

function getDiskInfo(detailed = true) {
  const platform = os.platform();
  const disks = [];

  try {
    if (platform === 'win32') {
      const output = execCmd('wmic logicaldisk get DeviceID,Size,FreeSpace,FileSystem /format:csv', null);
      if (output) {
        const lines = output.split('\n').filter(l => l && !l.startsWith('Node'));
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 4) {
            const deviceId = parts[1]?.trim();
            const fileSystem = parts[2]?.trim();
            const freeSpace = parseInt(parts[3]) || 0;
            const size = parseInt(parts[4]) || 0;
            if (deviceId && size > 0) {
              disks.push({
                device: deviceId,
                filesystem: fileSystem,
                size_bytes: size,
                size_gb: bytesToGB(size),
                free_bytes: freeSpace,
                free_gb: bytesToGB(freeSpace),
                used_gb: bytesToGB(size - freeSpace),
                usage_percent: size > 0 ? (((size - freeSpace) / size) * 100).toFixed(2) : '0',
              });
            }
          }
        }
      }
    } else if (platform === 'linux' || platform === 'darwin') {
      const output = execCmd('df -h 2>/dev/null', null);
      if (output) {
        const lines = output.split('\n').slice(1).filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length >= 6 && !parts[0].startsWith('tmpfs') && !parts[0].startsWith('devtmpfs')) {
            disks.push({
              device: parts[0],
              size: parts[1],
              used: parts[2],
              available: parts[3],
              usage_percent: parts[4],
              mount_point: parts[5],
            });
          }
        }
      }
    }
  } catch (e) {
    logger.warn('Disk info extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return disks;
}

function getNetworkInfo(detailed = true) {
  const interfaces = os.networkInterfaces();
  const networks = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    const ipv4 = addrs.find(a => a.family === 'IPv4');
    const ipv6 = addrs.find(a => a.family === 'IPv6');
    if (ipv4 || ipv6) {
      networks.push({
        interface: name,
        ipv4_address: ipv4?.address || null,
        ipv4_netmask: ipv4?.netmask || null,
        ipv6_address: ipv6?.address || null,
        mac_address: ipv4?.mac || ipv6?.mac || null,
        internal: ipv4?.internal || ipv6?.internal || false,
      });
    }
  }

  return networks;
}

function getProcessInfo(detailed = true) {
  const info = {
    pid: process.pid,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    uptime_seconds: process.uptime().toFixed(2),
    memory_usage: process.memoryUsage(),
  };

  if (detailed) {
    info.memory_usage_formatted = {
      rss_mb: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
      heap_total_mb: (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2),
      heap_used_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
      external_mb: (process.memoryUsage().external / 1024 / 1024).toFixed(2),
    };
    info.cpu_usage = process.cpuUsage();
    info.resource_usage = process.resourceUsage ? process.resourceUsage() : null;
  }

  return info;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${mins}m`;
}

function getBatteryInfo(detailed = true) {
  const platform = os.platform();
  const batteries = [];

  try {
    if (platform === 'win32') {
      const output = execCmd('wmic path Win32_Battery get BatteryStatus,EstimatedChargeRemaining,EstimatedRunTime,Name /format:csv', null);
      if (output) {
        const lines = output.split('\n').filter(l => l && !l.startsWith('Node'));
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 4) {
            batteries.push({
              name: parts[4]?.trim() || 'Battery',
              status_code: parts[1]?.trim(),
              charge_percent: parts[2]?.trim() + '%',
              estimated_runtime_min: parts[3]?.trim(),
            });
          }
        }
      }
      if (batteries.length === 0) {
        const powerStatus = execCmd('powercfg /batteryreport /duration 1 /output nul & echo %errorlevel%', null);
        if (powerStatus === '0') batteries.push({ status: 'Battery present, details require admin rights' });
      }
    } else if (platform === 'linux') {
      const output = execCmd('upower -i /org/freedesktop/UPower/devices/battery_BAT0 2>/dev/null || acpi -b 2>/dev/null', null);
      if (output) {
        batteries.push({ info: output.trim() });
      }
    } else if (platform === 'darwin') {
      const output = execCmd('pmset -g batt', null);
      if (output) {
        batteries.push({ info: output.trim() });
      }
    }
  } catch (e) {
    logger.warn('Battery info extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return batteries.length > 0 ? batteries : [{ status: 'No battery detected or not a laptop' }];
}

function getUSBDevices(detailed = true) {
  const platform = os.platform();
  const devices = [];

  try {
    if (platform === 'win32') {
      const output = execCmd('wmic path Win32_USBControllerDevice get Dependent /format:csv', null);
      if (output) {
        const lines = output.split('\n').filter(l => l && !l.startsWith('Node'));
        for (const line of lines) {
          const match = line.match(/DeviceID="([^"]+)"/);
          if (match) devices.push({ device_id: match[1] });
        }
      }
    } else if (platform === 'linux') {
      const output = execCmd('lsusb 2>/dev/null', null);
      if (output) {
        const lines = output.split('\n').filter(Boolean);
        for (const line of lines) {
          devices.push({ info: line.trim() });
        }
      }
    } else if (platform === 'darwin') {
      const output = execCmd('system_profiler SPUSBDataType 2>/dev/null', null);
      if (output) {
        const lines = output.split('\n').filter(l => l.includes(':'));
        for (const line of lines.slice(0, 20)) {
          devices.push({ info: line.trim() });
        }
      }
    }
  } catch (e) {
    logger.warn('USB devices extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return devices.length > 0 ? devices : [{ status: 'No USB devices detected or unable to query' }];
}

function getAudioDevices(detailed = true) {
  const platform = os.platform();
  const devices = [];

  try {
    if (platform === 'win32') {
      const output = execCmd('wmic sounddev get Name,Status /format:csv', null);
      if (output) {
        const lines = output.split('\n').filter(l => l && !l.startsWith('Node'));
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 2) {
            devices.push({ name: parts[1]?.trim(), status: parts[2]?.trim() });
          }
        }
      }
    } else if (platform === 'linux') {
      const output = execCmd('aplay -l 2>/dev/null || cat /proc/asound/cards 2>/dev/null', null);
      if (output) {
        devices.push({ info: output.trim().split('\n').slice(0, 10).join('\n') });
      }
    } else if (platform === 'darwin') {
      const output = execCmd('system_profiler SPAudioDataType 2>/dev/null', null);
      if (output) {
        devices.push({ info: output.trim().split('\n').slice(0, 15).join('\n') });
      }
    }
  } catch (e) {
    logger.warn('Audio devices extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return devices.length > 0 ? devices : [{ status: 'No audio devices detected' }];
}

function getDisplayInfo(detailed = true) {
  const platform = os.platform();
  const displays = [];

  try {
    if (platform === 'win32') {
      const output = execCmd('wmic path Win32_DesktopMonitor get Name,ScreenHeight,ScreenWidth /format:csv', null);
      if (output) {
        const lines = output.split('\n').filter(l => l && !l.startsWith('Node'));
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 3) {
            displays.push({
              name: parts[1]?.trim(),
              width: parts[3]?.trim(),
              height: parts[2]?.trim(),
            });
          }
        }
      }
    } else if (platform === 'linux') {
      const output = execCmd('xrandr 2>/dev/null | grep " connected" || echo "Display info requires X server"', null);
      if (output) {
        displays.push({ info: output.trim() });
      }
    } else if (platform === 'darwin') {
      const output = execCmd('system_profiler SPDisplaysDataType 2>/dev/null', null);
      if (output) {
        displays.push({ info: output.trim().split('\n').slice(0, 20).join('\n') });
      }
    }
  } catch (e) {
    logger.warn('Display info extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return displays.length > 0 ? displays : [{ status: 'No display information available' }];
}

function getBIOSInfo(detailed = true) {
  const platform = os.platform();
  const info = {};

  try {
    if (platform === 'win32') {
      const manufacturer = execCmd('wmic bios get Manufacturer /value', '').split('=')[1]?.trim();
      const version = execCmd('wmic bios get Version /value', '').split('=')[1]?.trim();
      const releaseDate = execCmd('wmic bios get ReleaseDate /value', '').split('=')[1]?.trim();
      const serialNumber = execCmd('wmic bios get SerialNumber /value', '').split('=')[1]?.trim();
      info.manufacturer = manufacturer;
      info.version = version;
      info.release_date = releaseDate;
      info.serial_number = serialNumber;
    } else if (platform === 'linux') {
      const vendor = execCmd('cat /sys/class/dmi/id/bios_vendor 2>/dev/null', null);
      const version = execCmd('cat /sys/class/dmi/id/bios_version 2>/dev/null', null);
      const date = execCmd('cat /sys/class/dmi/id/bios_date 2>/dev/null', null);
      if (vendor) info.vendor = vendor;
      if (version) info.version = version;
      if (date) info.date = date;
    } else if (platform === 'darwin') {
      const output = execCmd('system_profiler SPHardwareDataType 2>/dev/null', null);
      if (output) {
        info.hardware_info = output.trim().split('\n').slice(0, 10).join('\n');
      }
    }
  } catch (e) {
    logger.warn('BIOS info extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return Object.keys(info).length > 0 ? info : { status: 'BIOS information not available' };
}

function getEnvironmentInfo(detailed = true) {
  const env = process.env;
  const info = {
    path: env.PATH || env.Path,
    home: env.HOME || env.USERPROFILE,
    user: env.USER || env.USERNAME,
    shell: env.SHELL || env.ComSpec,
    lang: env.LANG || env.LANGUAGE,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  if (detailed) {
    info.node_path = env.NODE_PATH;
    info.temp = env.TEMP || env.TMP || env.TMPDIR;
    info.editor = env.EDITOR || env.VISUAL;
    info.all_vars_count = Object.keys(env).length;
  }

  return info;
}

function getUsersInfo(detailed = true) {
  const platform = os.platform();
  const users = [];

  try {
    if (platform === 'win32') {
      const output = execCmd('wmic useraccount get Name,FullName,Disabled /format:csv', null);
      if (output) {
        const lines = output.split('\n').filter(l => l && !l.startsWith('Node'));
        for (const line of lines.slice(0, 20)) {
          const parts = line.split(',');
          if (parts.length >= 3) {
            users.push({
              username: parts[2]?.trim(),
              full_name: parts[3]?.trim(),
              disabled: parts[1]?.trim(),
            });
          }
        }
      }
    } else if (platform === 'linux' || platform === 'darwin') {
      const output = execCmd('cat /etc/passwd 2>/dev/null | cut -d: -f1,5', null);
      if (output) {
        const lines = output.split('\n').filter(Boolean).slice(0, 30);
        for (const line of lines) {
          const [username, fullname] = line.split(':');
          if (username) users.push({ username: username.trim(), full_name: fullname?.trim() || '' });
        }
      }
    }
  } catch (e) {
    logger.warn('Users info extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return users.length > 0 ? users : [{ status: 'Unable to retrieve user information' }];
}

function getServicesInfo(detailed = true) {
  const platform = os.platform();
  const services = [];

  try {
    if (platform === 'win32') {
      const output = execCmd('wmic service where "State=\'Running\'" get Name,DisplayName,State /format:csv 2>nul', null);
      if (output) {
        const lines = output.split('\n').filter(l => l && !l.startsWith('Node')).slice(0, 50);
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 3) {
            services.push({
              name: parts[2]?.trim(),
              display_name: parts[1]?.trim(),
              state: parts[3]?.trim(),
            });
          }
        }
      }
    } else if (platform === 'linux') {
      const output = execCmd('systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | head -30', null);
      if (output) {
        const lines = output.split('\n').filter(Boolean);
        for (const line of lines) {
          services.push({ info: line.trim().split(/\s+/).slice(0, 3).join(' ') });
        }
      }
    } else if (platform === 'darwin') {
      const output = execCmd('launchctl list 2>/dev/null | head -30', null);
      if (output) {
        const lines = output.split('\n').filter(Boolean);
        for (const line of lines) {
          services.push({ info: line.trim() });
        }
      }
    }
  } catch (e) {
    logger.warn('Services info extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return services.length > 0 ? services.slice(0, 30) : [{ status: 'Unable to retrieve services' }];
}

function getSoftwareInfo(detailed = true) {
  const platform = os.platform();
  const software = [];

  try {
    if (platform === 'win32') {
      const output = execCmd('wmic product get Name,Version,Vendor /format:csv 2>nul', null);
      if (output) {
        const lines = output.split('\n').filter(l => l && !l.startsWith('Node')).slice(0, 50);
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 3) {
            software.push({
              name: parts[1]?.trim(),
              version: parts[3]?.trim(),
              vendor: parts[2]?.trim(),
            });
          }
        }
      }
    } else if (platform === 'linux') {
      const output = execCmd('dpkg -l 2>/dev/null | head -50 || rpm -qa 2>/dev/null | head -50', null);
      if (output) {
        const lines = output.split('\n').filter(Boolean).slice(0, 40);
        for (const line of lines) {
          software.push({ info: line.trim() });
        }
      }
    } else if (platform === 'darwin') {
      const output = execCmd('ls /Applications 2>/dev/null | head -40', null);
      if (output) {
        const lines = output.split('\n').filter(Boolean);
        for (const line of lines) {
          software.push({ app: line.trim() });
        }
      }
    }
  } catch (e) {
    logger.warn('Software info extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return software.length > 0 ? software.slice(0, 40) : [{ status: 'Unable to retrieve installed software (may require elevated permissions)' }];
}

function getTemperatureInfo(detailed = true) {
  const platform = os.platform();
  const temps = [];

  try {
    if (platform === 'win32') {
      temps.push({ status: 'Temperature monitoring requires third-party tools (e.g., OpenHardwareMonitor, HWiNFO)' });
    } else if (platform === 'linux') {
      const output = execCmd('sensors 2>/dev/null || cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null', null);
      if (output) {
        temps.push({ info: output.trim() });
      }
    } else if (platform === 'darwin') {
      const output = execCmd('sudo powermetrics --samplers smc -i1 -n1 2>/dev/null | grep -i temp', null);
      if (output) {
        temps.push({ info: output.trim() });
      } else {
        temps.push({ status: 'Temperature monitoring requires sudo or third-party tools' });
      }
    }
  } catch (e) {
    logger.warn('Temperature info extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return temps.length > 0 ? temps : [{ status: 'Temperature sensors not available' }];
}

function getBluetoothInfo(detailed = true) {
  const platform = os.platform();
  const devices = [];

  try {
    if (platform === 'win32') {
      const output = execCmd('powershell "Get-PnpDevice -Class Bluetooth | Select-Object FriendlyName,Status | ConvertTo-Csv -NoTypeInformation" 2>nul', null);
      if (output) {
        const lines = output.split('\n').filter(l => l && !l.startsWith('"FriendlyName"')).slice(0, 20);
        for (const line of lines) {
          devices.push({ info: line.trim() });
        }
      }
    } else if (platform === 'linux') {
      const output = execCmd('bluetoothctl devices 2>/dev/null || hciconfig 2>/dev/null', null);
      if (output) {
        devices.push({ info: output.trim() });
      }
    } else if (platform === 'darwin') {
      const output = execCmd('system_profiler SPBluetoothDataType 2>/dev/null', null);
      if (output) {
        devices.push({ info: output.trim().split('\n').slice(0, 20).join('\n') });
      }
    }
  } catch (e) {
    logger.warn('Bluetooth info extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return devices.length > 0 ? devices : [{ status: 'No Bluetooth devices detected or Bluetooth not available' }];
}

function getPrintersInfo(detailed = true) {
  const platform = os.platform();
  const printers = [];

  try {
    if (platform === 'win32') {
      const output = execCmd('wmic printer get Name,PortName,DriverName,PrinterStatus /format:csv', null);
      if (output) {
        const lines = output.split('\n').filter(l => l && !l.startsWith('Node'));
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 3) {
            printers.push({
              name: parts[2]?.trim(),
              driver: parts[1]?.trim(),
              port: parts[3]?.trim(),
              status: parts[4]?.trim(),
            });
          }
        }
      }
    } else if (platform === 'linux') {
      const output = execCmd('lpstat -p -d 2>/dev/null', null);
      if (output) {
        printers.push({ info: output.trim() });
      }
    } else if (platform === 'darwin') {
      const output = execCmd('lpstat -p -d 2>/dev/null', null);
      if (output) {
        printers.push({ info: output.trim() });
      }
    }
  } catch (e) {
    logger.warn('Printers info extraction failed', { label: 'PLUGIN', error: String(e) });
  }

  return printers.length > 0 ? printers : [{ status: 'No printers configured' }];
}

export default async function handler(args = {}) {
  const detailed = args.detailed !== false;
  const useCache = args.useCache !== false;
  const cacheScope = args.cacheScope || 'both';
  const cacheTTL = Math.max(60, Math.min(2592000, Number(args.cacheTTL) || 604800)); // 默认 7 天

  // Support both single 'category' and multiple 'categories'
  let categoriesToFetch = [];
  if (Array.isArray(args.categories) && args.categories.length > 0) {
    // Use categories array if provided
    categoriesToFetch = args.categories.map(c => String(c).toLowerCase());
  } else if (args.category) {
    // Fallback to single category
    categoriesToFetch = [String(args.category).toLowerCase()];
  } else {
    // Default to 'all'
    categoriesToFetch = ['all'];
  }

  // If 'all' is in the list, fetch everything
  const fetchAll = categoriesToFetch.includes('all');

  // 生成缓存键
  const cacheKey = getCacheKey(categoriesToFetch, detailed);

  // 尝试从缓存读取
  if (useCache) {
    let cachedData = null;

    // 尝试内存缓存
    if (cacheScope === 'memory' || cacheScope === 'both') {
      cachedData = getFromMem(cacheKey);
      if (cachedData) {
        logger.debug?.('system_info:cache_hit', { label: 'PLUGIN', source: 'memory', cacheKey });
        return { success: true, data: cachedData, cached: true, source: 'memory' };
      }
    }

    // 尝试文件缓存
    if (cacheScope === 'file' || cacheScope === 'both') {
      cachedData = await readFileCache(cacheKey);
      if (cachedData) {
        // 回填内存缓存
        if (cacheScope === 'both') {
          setToMem(cacheKey, cachedData, cacheTTL);
        }
        logger.debug?.('system_info:cache_hit', { label: 'PLUGIN', source: 'file', cacheKey });
        return { success: true, data: cachedData, cached: true, source: 'file' };
      }
    }
  }

  // 缓存未命中，获取新数据
  const data = {};

  try {
    if (fetchAll || categoriesToFetch.includes('os')) {
      data.os = getOSInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('cpu')) {
      data.cpu = getCPUInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('memory')) {
      data.memory = getMemoryInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('gpu')) {
      data.gpu = getGPUInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('disk')) {
      data.disk = getDiskInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('network')) {
      data.network = getNetworkInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('process')) {
      data.process = getProcessInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('battery')) {
      data.battery = getBatteryInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('usb')) {
      data.usb = getUSBDevices(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('audio')) {
      data.audio = getAudioDevices(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('display')) {
      data.display = getDisplayInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('bios')) {
      data.bios = getBIOSInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('environment')) {
      data.environment = getEnvironmentInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('users')) {
      data.users = getUsersInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('services')) {
      data.services = getServicesInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('software')) {
      data.software = getSoftwareInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('temperature')) {
      data.temperature = getTemperatureInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('bluetooth')) {
      data.bluetooth = getBluetoothInfo(detailed);
    }
    if (fetchAll || categoriesToFetch.includes('printers')) {
      data.printers = getPrintersInfo(detailed);
    }

    // 写入缓存
    if (useCache && Object.keys(data).length > 0) {
      if (cacheScope === 'memory' || cacheScope === 'both') {
        setToMem(cacheKey, data, cacheTTL);
      }
      if (cacheScope === 'file' || cacheScope === 'both') {
        await writeFileCache(cacheKey, data, cacheTTL);
      }
      logger.debug?.('system_info:cache_written', { label: 'PLUGIN', cacheKey, ttl: cacheTTL });
    }

    return { success: true, data, cached: false };
  } catch (e) {
    logger.error('system_info handler error', { label: 'PLUGIN', error: String(e?.message || e) });
    return { success: false, code: 'ERR', error: String(e?.message || e) };
  }
}
