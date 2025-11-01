import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../src/logger/index.js';

// 缓存目录路径
const CACHE_DIR = path.resolve(process.cwd(), 'cache', 'weather');
const CITY_CACHE_FILE_PATH = path.join(CACHE_DIR, 'city_cache.txt');
const WEATHER_DATA_CACHE_PATH = path.join(CACHE_DIR, 'weather_data_cache.json');

// 默认缓存过期时间（毫秒）
const DEFAULT_CACHE_EXPIRY_MS = 30 * 60 * 1000; // 30分钟

function pluginEnv(options = {}) { 
  return options.pluginEnv || {}; 
}

// 确保缓存目录存在
async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      logger.error('天气报告', `创建缓存目录失败: ${error.message}`, { label: 'PLUGIN' });
    }
  }
}

// 检查缓存是否过期
function isCacheExpired(timestamp, expiryMs = DEFAULT_CACHE_EXPIRY_MS) {
  if (!timestamp) return true;
  try {
    const cacheTime = new Date(timestamp).getTime();
    const now = Date.now();
    return (now - cacheTime) > expiryMs;
  } catch {
    return true;
  }
}

// --- 天气数据缓存管理 ---

// 读取天气数据缓存
async function readWeatherDataCache() {
  try {
    const data = await fs.readFile(WEATHER_DATA_CACHE_PATH, 'utf-8');
    const cache = JSON.parse(data);
    logger.debug?.('天气报告', '成功读取天气数据缓存文件', { label: 'PLUGIN' });
    return cache;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error?.('天气报告', `读取天气数据缓存文件时出错: ${error.message}`, { label: 'PLUGIN' });
    }
    return {};
  }
}

// 写入天气数据缓存
async function writeWeatherDataCache(cache) {
  try {
    await ensureCacheDir();
    await fs.writeFile(WEATHER_DATA_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
    logger.debug?.('天气报告', '成功写入天气数据缓存文件', { label: 'PLUGIN' });
  } catch (error) {
    logger.error?.('天气报告', `写入天气数据缓存文件时出错: ${error.message}`, { label: 'PLUGIN' });
  }
}

// 生成缓存键
function generateCacheKey(city, queryType) {
  return `${city}_${queryType}`;
}

// 获取缓存的天气数据
async function getCachedWeatherData(city, queryType) {
  try {
    const cache = await readWeatherDataCache();
    const cacheKey = generateCacheKey(city, queryType);
    const cachedData = cache[cacheKey];
    
    if (cachedData && !isCacheExpired(cachedData.timestamp)) {
      logger.debug?.('天气报告', `使用缓存的天气数据: ${cacheKey}`, { label: 'PLUGIN' });
      return cachedData.data;
    }
    
    if (cachedData && isCacheExpired(cachedData.timestamp)) {
      logger.debug?.('天气报告', `天气数据缓存已过期: ${cacheKey}`, { label: 'PLUGIN' });
    }
    
    return null;
  } catch (error) {
    logger.error?.('天气报告', `获取缓存天气数据时出错: ${error.message}`, { label: 'PLUGIN' });
    return null;
  }
}

// 缓存天气数据
async function cacheWeatherData(city, queryType, data) {
  try {
    const cache = await readWeatherDataCache();
    const cacheKey = generateCacheKey(city, queryType);
    
    cache[cacheKey] = {
      timestamp: new Date().toISOString(),
      data: data
    };
    
    await writeWeatherDataCache(cache);
    logger.debug?.('天气报告', `成功缓存天气数据: ${cacheKey}`, { label: 'PLUGIN' });
  } catch (error) {
    logger.error?.('天气报告', `缓存天气数据时出错: ${error.message}`, { label: 'PLUGIN' });
  }
}

// --- 城市ID缓存管理 ---

// 读取城市缓存
async function readCityCache() {
  try {
    const data = await fs.readFile(CITY_CACHE_FILE_PATH, 'utf-8');
    const cache = new Map();
    data.split('\n').forEach(line => {
      const [cityName, cityId] = line.split(':');
      if (cityName && cityId) {
        cache.set(cityName.trim(), cityId.trim());
      }
    });
    logger.debug?.('天气报告', `成功读取城市缓存文件 ${CITY_CACHE_FILE_PATH}`, { label: 'PLUGIN' });
    return cache;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error?.('天气报告', `读取城市缓存文件时出错 ${CITY_CACHE_FILE_PATH}: ${error.message}`, { label: 'PLUGIN' });
    }
    return new Map();
  }
}

// 写入城市缓存
async function writeCityCache(cityName, cityId) {
  try {
    await ensureCacheDir();
    await fs.appendFile(CITY_CACHE_FILE_PATH, `${cityName}:${cityId}\n`, 'utf-8');
    logger.debug?.('天气报告', `成功写入城市缓存 ${cityName}:${cityId} 到 ${CITY_CACHE_FILE_PATH}`, { label: 'PLUGIN' });
  } catch (error) {
    logger.error?.('天气报告', `写入城市缓存文件时出错 ${CITY_CACHE_FILE_PATH}: ${error.message}`, { label: 'PLUGIN' });
  }
}

// --- 和风天气API调用 ---

// 获取城市ID
async function getCityId(cityName, weatherKey, weatherUrl) {
  if (!cityName || !weatherKey || !weatherUrl) {
    logger.error?.('天气报告', '获取城市ID缺少必要参数：城市名称、天气密钥或天气URL', { label: 'PLUGIN' });
    return { success: false, data: null, error: new Error('Missing parameters for getCityId.') };
  }

  // 检查缓存
  const cityCache = await readCityCache();
  if (cityCache.has(cityName)) {
    const cachedCityId = cityCache.get(cityName);
    logger.debug?.('天气报告', `使用缓存的城市ID ${cityName}: ${cachedCityId}`, { label: 'PLUGIN' });
    return { success: true, data: cachedCityId, error: null };
  }

  const lookupUrl = `https://${weatherUrl}/geo/v2/city/lookup?location=${encodeURIComponent(cityName)}&key=${weatherKey}`;

  try {
    logger.debug?.('天气报告', `正在获取城市ID：${cityName}`, { label: 'PLUGIN' });
    const { default: fetch } = await import('node-fetch');
    const response = await fetch(lookupUrl, { timeout: 10000 });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QWeather City Lookup API failed: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (data.code === '200' && data.location && data.location.length > 0) {
      const cityId = data.location[0].id;
      logger.debug?.('天气报告', `成功找到城市ID：${cityId}`, { label: 'PLUGIN' });
      await writeCityCache(cityName, cityId);
      return { success: true, data: cityId, error: null };
    } else {
      const errorMsg = data.code === '200' ? 'No location found' : `API returned code ${data.code}`;
      throw new Error(`获取城市ID失败：${cityName}。${errorMsg}`);
    }
  } catch (error) {
    logger.error?.('天气报告', `获取城市ID时出错：${error.message}`, { label: 'PLUGIN' });
    return { success: false, data: null, error: error };
  }
}

// 获取当前天气
async function getCurrentWeather(cityId, weatherKey, weatherUrl) {
  if (!cityId || !weatherKey || !weatherUrl) {
    logger.error?.('天气报告', '获取当前天气缺少必要参数：城市ID、天气密钥或天气URL', { label: 'PLUGIN' });
    return { success: false, data: null, error: new Error('Missing parameters for getCurrentWeather.') };
  }

  const weatherUrlEndpoint = `https://${weatherUrl}/v7/weather/now?location=${cityId}&key=${weatherKey}`;

  try {
    logger.debug?.('天气报告', `正在获取当前天气，城市ID：${cityId}`, { label: 'PLUGIN' });
    const { default: fetch } = await import('node-fetch');
    const response = await fetch(weatherUrlEndpoint, { timeout: 10000 });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QWeather Current Weather API failed: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (data.code === '200' && data.now) {
      logger.debug?.('天气报告', `成功获取当前天气，城市ID：${cityId}`, { label: 'PLUGIN' });
      return { success: true, data: data.now, error: null };
    } else {
      throw new Error(`获取当前天气失败，城市ID：${cityId}。API返回码：${data.code}`);
    }
  } catch (error) {
    logger.error?.('天气报告', `获取当前天气时出错：${error.message}`, { label: 'PLUGIN' });
    return { success: false, data: null, error: error };
  }
}

// 获取7天预报
async function get7DayForecast(cityId, weatherKey, weatherUrl) {
  if (!cityId || !weatherKey || !weatherUrl) {
    logger.error?.('天气报告', '获取7天预报缺少必要参数：城市ID、天气密钥或天气URL', { label: 'PLUGIN' });
    return { success: false, data: null, error: new Error('Missing parameters for get7DayForecast.') };
  }

  const forecastUrlEndpoint = `https://${weatherUrl}/v7/weather/7d?location=${cityId}&key=${weatherKey}`;

  try {
    logger.debug?.('天气报告', `正在获取7天预报，城市ID：${cityId}`, { label: 'PLUGIN' });
    const { default: fetch } = await import('node-fetch');
    const response = await fetch(forecastUrlEndpoint, { timeout: 10000 });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QWeather 7-day Forecast API failed: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (data.code === '200' && data.daily) {
      logger.debug?.('天气报告', `成功获取7天预报，城市ID：${cityId}`, { label: 'PLUGIN' });
      return { success: true, data: data.daily, error: null };
    } else {
      throw new Error(`获取7天预报失败，城市ID：${cityId}。API返回码：${data.code}`);
    }
  } catch (error) {
    logger.error?.('天气报告', `获取7天预报时出错：${error.message}`, { label: 'PLUGIN' });
    return { success: false, data: null, error: error };
  }
}

// 获取24小时预报
async function get24HourForecast(cityId, weatherKey, weatherUrl) {
  if (!cityId || !weatherKey || !weatherUrl) {
    logger.error?.('天气报告', '获取24小时预报缺少必要参数：城市ID、天气密钥或天气URL', { label: 'PLUGIN' });
    return { success: false, data: null, error: new Error('Missing parameters for get24HourForecast.') };
  }

  const hourlyUrlEndpoint = `https://${weatherUrl}/v7/weather/24h?location=${cityId}&key=${weatherKey}`;

  try {
    logger.debug?.('天气报告', `正在获取24小时预报，城市ID：${cityId}`, { label: 'PLUGIN' });
    const { default: fetch } = await import('node-fetch');
    const response = await fetch(hourlyUrlEndpoint, { timeout: 10000 });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QWeather 24-hour Forecast API failed: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (data.code === '200' && data.hourly) {
      logger.debug?.('天气报告', `成功获取24小时预报，城市ID：${cityId}`, { label: 'PLUGIN' });
      return { success: true, data: data.hourly, error: null };
    } else {
      throw new Error(`获取24小时预报失败，城市ID：${cityId}。API返回码：${data.code}`);
    }
  } catch (error) {
    logger.error?.('天气报告', `获取24小时预报时出错：${error.message}`, { label: 'PLUGIN' });
    return { success: false, data: null, error: error };
  }
}

// 获取天气预警
async function getWeatherWarning(cityId, weatherKey, weatherUrl) {
  if (!cityId || !weatherKey || !weatherUrl) {
    logger.error?.('天气报告', '获取天气预警缺少必要参数：城市ID、天气密钥或天气URL', { label: 'PLUGIN' });
    return { success: false, data: null, error: new Error('Missing parameters for getWeatherWarning.') };
  }

  const warningUrlEndpoint = `https://${weatherUrl}/v7/warning/now?location=${cityId}&key=${weatherKey}`;

  try {
    logger.debug?.('天气报告', `正在获取天气预警，城市ID：${cityId}`, { label: 'PLUGIN' });
    const { default: fetch } = await import('node-fetch');
    const response = await fetch(warningUrlEndpoint, { timeout: 10000 });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QWeather Warning API failed: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (data.code === '200') {
      logger.debug?.('天气报告', `成功获取天气预警，城市ID：${cityId}`, { label: 'PLUGIN' });
      return { success: true, data: data.warning || [], error: null };
    } else {
      throw new Error(`获取天气预警失败，城市ID：${cityId}。API返回码：${data.code}`);
    }
  } catch (error) {
    logger.error?.('天气报告', `获取天气预警时出错：${error.message}`, { label: 'PLUGIN' });
    return { success: false, data: null, error: error };
  }
}

// --- 格式化天气信息 ---

function formatWeatherInfo(currentWeather, hourlyForecast, weatherWarning, forecast, queryType = 'all') {
  if (!currentWeather && !hourlyForecast && (!weatherWarning || weatherWarning.length === 0) && (!forecast || forecast.length === 0)) {
    return '[天气信息获取失败]';
  }

  let result = '';

  // 当前天气
  if ((queryType === 'current' || queryType === 'all') && currentWeather) {
    result += '【当前天气】\n';
    result += `天气: ${currentWeather.text}\n`;
    result += `温度: ${currentWeather.temp}℃\n`;
    result += `体感温度: ${currentWeather.feelsLike}℃\n`;
    result += `风向: ${currentWeather.windDir}\n`;
    result += `风力: ${currentWeather.windScale}级\n`;
    result += `风速: ${currentWeather.windSpeed}公里/小时\n`;
    result += `湿度: ${currentWeather.humidity}%\n`;
    result += `降水量: ${currentWeather.precip}毫米\n`;
    result += `能见度: ${currentWeather.vis}公里\n`;
    result += `云量: ${currentWeather.cloud}%\n`;
    result += `大气压强: ${currentWeather.pressure}百帕\n`;
    result += `数据观测时间: ${new Date(currentWeather.obsTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
    result += '\n';
  }

  // 天气预警
  if ((queryType === 'warning' || queryType === 'all') && weatherWarning) {
    result += '【天气预警】\n';
    if (weatherWarning.length > 0) {
      weatherWarning.forEach(warning => {
        result += `\n标题: ${warning.title}\n`;
        result += `发布时间: ${new Date(warning.pubTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
        result += `级别: ${warning.severityColor || '未知'}\n`;
        result += `类型: ${warning.typeName}\n`;
        result += `内容: ${warning.text}\n`;
      });
    } else {
      result += '当前无天气预警信息。\n';
    }
    result += '\n';
  }

  // 24小时预报
  if ((queryType === 'hourly' || queryType === 'all') && hourlyForecast) {
    result += '【未来24小时天气预报】\n';
    if (hourlyForecast.length > 0) {
      for (let i = 0; i < hourlyForecast.length; i++) {
        if (i < 8 || i === 9 || i === 11 || i === 16 || i === 20) {
          const hour = hourlyForecast[i];
          const time = new Date(hour.fxTime).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
          result += `\n时间: ${time}\n`;
          result += `天气: ${hour.text}\n`;
          result += `温度: ${hour.temp}℃\n`;
          result += `风向: ${hour.windDir}\n`;
          result += `风力: ${hour.windScale}级\n`;
          result += `湿度: ${hour.humidity}%\n`;
          result += `降水概率: ${hour.pop}%\n`;
          result += `降水量: ${hour.precip}毫米\n`;
        }
      }
    } else {
      result += '未来24小时天气预报获取失败。\n';
    }
    result += '\n';
  }

  // 7天预报
  if ((queryType === 'forecast' || queryType === 'all') && forecast) {
    if (forecast.length > 0) {
      result += '【未来7日天气预报】\n';
      forecast.forEach(day => {
        result += `\n日期: ${day.fxDate}\n`;
        result += `白天: ${day.textDay} (图标: ${day.iconDay}), 最高温: ${day.tempMax}℃, 风向: ${day.windDirDay}, 风力: ${day.windScaleDay}级\n`;
        result += `夜间: ${day.textNight} (图标: ${day.iconNight}), 最低温: ${day.tempMin}℃, 风向: ${day.windDirNight}, 风力: ${day.windScaleNight}级\n`;
        result += `湿度: ${day.humidity}%\n`;
        result += `降水: ${day.precip}毫米\n`;
        result += `紫外线指数: ${day.uvIndex}\n`;
      });
    } else {
      result += '未来7日天气预报获取失败。\n';
    }
  }

  return result.trim();
}

// --- 主处理函数 ---

async function fetchAndCacheWeather(cityName, queryType, weatherKey, weatherUrl) {
  let lastError = null;

  if (!cityName || !weatherKey || !weatherUrl) {
    lastError = new Error('天气插件错误：获取天气所需的配置不完整 (city, WeatherKey, WeatherUrl)。');
    logger.error?.('天气报告', `${lastError.message}`, { label: 'PLUGIN' });
    return { success: false, data: null, error: lastError };
  }

  // 首先检查缓存
  const cachedData = await getCachedWeatherData(cityName, queryType);
  if (cachedData) {
    logger.info?.('天气报告', `使用缓存的天气数据: ${cityName} - ${queryType}`, { label: 'PLUGIN' });
    return { success: true, data: cachedData, error: null, fromCache: true };
  }

  let cityId = null;
  let currentWeather = null;
  let hourlyForecast = null;
  let weatherWarning = null;
  let forecast = null;

  // 1. 获取城市ID
  const cityResult = await getCityId(cityName, weatherKey, weatherUrl);
  if (cityResult.success) {
    cityId = cityResult.data;
  } else {
    lastError = cityResult.error;
    logger.error?.('天气报告', `获取失败 city ID: ${lastError.message}`, { label: 'PLUGIN' });
    return { success: false, data: null, error: lastError };
  }

  // 2. 获取当前天气（如果需要）
  if ((queryType === 'current' || queryType === 'all') && cityId) {
    const currentResult = await getCurrentWeather(cityId, weatherKey, weatherUrl);
    if (currentResult.success) {
      currentWeather = currentResult.data;
    } else {
      lastError = currentResult.error;
      logger.error?.('天气报告', `获取失败 current weather: ${lastError.message}`, { label: 'PLUGIN' });
    }
  }

  // 3. 获取24小时预报（如果需要）
  if ((queryType === 'hourly' || queryType === 'all') && cityId) {
    const hourlyResult = await get24HourForecast(cityId, weatherKey, weatherUrl);
    if (hourlyResult.success) {
      hourlyForecast = hourlyResult.data;
    } else {
      lastError = hourlyResult.error;
      logger.error?.('天气报告', `获取失败 24-hour forecast: ${lastError.message}`, { label: 'PLUGIN' });
    }
  }

  // 4. 获取天气预警（如果需要）
  if ((queryType === 'warning' || queryType === 'all') && cityId) {
    const warningResult = await getWeatherWarning(cityId, weatherKey, weatherUrl);
    if (warningResult.success) {
      weatherWarning = warningResult.data;
    } else {
      lastError = warningResult.error;
      logger.error?.('天气报告', `获取失败 weather warning: ${lastError.message}`, { label: 'PLUGIN' });
    }
  }

  // 5. 获取7天预报（如果需要）
  if ((queryType === 'forecast' || queryType === 'all') && cityId) {
    const forecastResult = await get7DayForecast(cityId, weatherKey, weatherUrl);
    if (forecastResult.success) {
      forecast = forecastResult.data;
    } else {
      lastError = forecastResult.error;
      logger.error?.('天气报告', `获取失败 7-day forecast: ${lastError.message}`, { label: 'PLUGIN' });
    }
  }

  // 6. 格式化和缓存结果
  if (currentWeather || hourlyForecast || weatherWarning || (forecast && forecast.length > 0)) {
    const formattedWeather = formatWeatherInfo(currentWeather, hourlyForecast, weatherWarning, forecast, queryType);
    
    // 缓存天气数据
    await cacheWeatherData(cityName, queryType, formattedWeather);
    
    return { success: true, data: formattedWeather, error: null, fromCache: false };
  } else {
    lastError = lastError || new Error('未能获取天气信息。');
    logger.error?.('天气报告', `${lastError.message}`, { label: 'PLUGIN' });
    return { success: false, data: null, error: lastError };
  }
}

// --- 导出处理函数 ---

export default async function handler(args = {}, options = {}) {
  const penv = pluginEnv(options);
  const city = String(args.city || '').trim();
  
  if (!city) {
    return { success: false, code: 'INVALID', error: 'city 参数是必填的，请提供城市名称，如：北京、上海、广州等' };
  }

  const queryType = (args.queryType || 'all').toLowerCase();
  const weatherKey = penv.WEATHER_API_KEY || penv.WEATHER_KEY || process.env.WEATHER_API_KEY || process.env.WEATHER_KEY;
  const weatherUrl = penv.WEATHER_API_HOST || penv.WEATHER_HOST || process.env.WEATHER_API_HOST || process.env.WEATHER_HOST || 'devapi.qweather.com';
  
  if (!weatherKey) {
    return { success: false, code: 'NO_API_KEY', error: 'WEATHER_API_KEY 未配置，请在 .env 文件中配置' };
  }

  // 验证查询类型
  const validTypes = ['current', 'forecast', 'hourly', 'warning', 'all'];
  if (!validTypes.includes(queryType)) {
    return { success: false, code: 'INVALID', error: `无效的查询类型: ${queryType}。支持的类型: ${validTypes.join(', ')}` };
  }

  logger.info?.('天气报告', `开始处理天气查询: 城市=${city}, 类型=${queryType}`, { label: 'PLUGIN' });

  const result = await fetchAndCacheWeather(city, queryType, weatherKey, weatherUrl);

  if (result.success && result.data) {
    logger.info?.('天气报告', `天气查询成功，内容长度: ${result.data.length} 字符${result.fromCache ? ' (来自缓存)' : ''}`, { label: 'PLUGIN' });
    
    return {
      success: true,
      data: {
        city,
        queryType,
        formatted: result.data,
        fromCache: result.fromCache || false,
        timestamp: new Date().toISOString()
      }
    };
  } else {
    const errorMessage = result.error ? result.error.message : '天气查询失败';
    logger.error?.('天气报告', `天气查询失败: ${errorMessage}`, { label: 'PLUGIN' });
    return { success: false, code: 'WEATHER_API_FAILED', error: errorMessage };
  }
}
