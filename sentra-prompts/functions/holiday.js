/**
 * 节日相关函数模块
 * 提供农历、节日判断等功能
 */

import { Lunar, Solar, HolidayUtil } from 'lunar-javascript';

/**
 * 获取当前日期的节日信息
 * @returns {string} 节日信息
 */
export function getHolidayInfo() {
  const solar = Solar.fromDate(new Date());
  const lunar = solar.getLunar();
  
  const holidays = [];
  
  // 获取公历节日
  const solarFestivals = solar.getFestivals();
  if (solarFestivals.length > 0) {
    holidays.push(...solarFestivals);
  }
  
  // 获取农历节日
  const lunarFestivals = lunar.getFestivals();
  if (lunarFestivals.length > 0) {
    holidays.push(...lunarFestivals);
  }
  
  // 获取节气
  const jieQi = lunar.getJieQi();
  if (jieQi) {
    holidays.push(`节气：${jieQi}`);
  }
  
  // 获取法定假日
  const holiday = HolidayUtil.getHoliday(solar.getYear(), solar.getMonth(), solar.getDay());
  if (holiday) {
    const holidayName = holiday.getName();
    const isWork = holiday.isWork();
    if (isWork) {
      holidays.push(`${holidayName}（调休工作日）`);
    } else {
      holidays.push(`${holidayName}（假期）`);
    }
  }
  
  if (holidays.length > 0) {
    return `今天是：${holidays.join('、')}`;
  }
  
  return '今天是普通工作日。';
}

/**
 * 获取农历日期
 * @returns {string} 农历日期
 */
export function getLunarDate() {
  const solar = Solar.fromDate(new Date());
  const lunar = solar.getLunar();
  
  return `农历${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
}

/**
 * 获取生肖
 * @returns {string} 生肖
 */
export function getZodiac() {
  const solar = Solar.fromDate(new Date());
  const lunar = solar.getLunar();
  return lunar.getYearShengXiao();
}

/**
 * 获取干支纪年
 * @returns {string} 干支纪年
 */
export function getGanZhi() {
  const solar = Solar.fromDate(new Date());
  const lunar = solar.getLunar();
  return `${lunar.getYearInGanZhi()}年`;
}

/**
 * 判断是否是工作日
 * @returns {boolean} 是否是工作日
 */
export function isWorkday() {
  const solar = Solar.fromDate(new Date());
  const holiday = HolidayUtil.getHoliday(solar.getYear(), solar.getMonth(), solar.getDay());
  
  if (holiday) {
    return holiday.isWork();
  }
  
  // 如果不是法定假日，判断是否是周末
  const day = solar.getWeek();
  return day !== 0 && day !== 6; // 0是周日，6是周六
}

/**
 * 获取是否是周末
 * @returns {boolean} 是否是周末
 */
export function isWeekend() {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

/**
 * 获取距离下一个重要节日的天数和名称
 * @returns {string} 节日倒计时信息
 */
export function getNextHoliday() {
  const today = Solar.fromDate(new Date());
  const currentYear = today.getYear();
  
  // 定义重要节日（公历）
  const solarHolidays = [
    { month: 1, day: 1, name: '元旦' },
    { month: 2, day: 14, name: '情人节' },
    { month: 3, day: 8, name: '妇女节' },
    { month: 5, day: 1, name: '劳动节' },
    { month: 6, day: 1, name: '儿童节' },
    { month: 10, day: 1, name: '国庆节' },
    { month: 12, day: 25, name: '圣诞节' }
  ];
  
  let nearestHoliday = null;
  let minDays = Infinity;
  
  for (const holiday of solarHolidays) {
    let year = currentYear;
    let holidayDate = Solar.fromYmd(year, holiday.month, holiday.day);
    
    // 如果今年的节日已过，计算明年的
    if (holidayDate.getJulianDay() < today.getJulianDay()) {
      year++;
      holidayDate = Solar.fromYmd(year, holiday.month, holiday.day);
    }
    
    const days = holidayDate.getJulianDay() - today.getJulianDay();
    
    if (days < minDays) {
      minDays = days;
      nearestHoliday = holiday.name;
    }
  }
  
  if (minDays === 0) {
    return `今天是${nearestHoliday}！`;
  } else if (minDays === 1) {
    return `明天是${nearestHoliday}`;
  } else {
    return `距离${nearestHoliday}还有${minDays}天`;
  }
}

/**
 * 获取当前节气
 * @returns {string} 节气名称
 */
export function getCurrentJieQi() {
  const solar = Solar.fromDate(new Date());
  const lunar = solar.getLunar();
  const jieQi = lunar.getJieQi();
  
  if (jieQi) {
    return `当前节气：${jieQi}`;
  }
  
  return '今日无节气';
}

/**
 * 获取星座
 * @returns {string} 星座
 */
export function getConstellation() {
  const solar = Solar.fromDate(new Date());
  return solar.getXingZuo();
}
