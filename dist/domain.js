export const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];
export const DEFAULT_TARGETS = { calories: 2200, protein: 140, carbs: 260, fat: 65 };
export const HEALTH_METRIC_KEYS = ["steps", "sleep", "restingHeartRate", "hrv", "weight", "respiratoryRate", "oxygenSaturation", "activeEnergy", "exercise", "distance", "vo2Max"];

export function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function validateFood(input) {
  const food = {
    id: String(input.id || crypto.randomUUID()),
    date: String(input.date || ""),
    meal: String(input.meal || ""),
    name: String(input.name || "").trim(),
    calories: Number(input.calories),
    protein: Number(input.protein),
    carbs: Number(input.carbs),
    fat: Number(input.fat),
    servings: Number(input.servings),
    notes: String(input.notes || "").trim(),
    source: "manual",
    updatedAt: new Date().toISOString(),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(food.date)) throw new Error("Choose a valid date.");
  if (!MEALS.includes(food.meal)) throw new Error("Choose a meal.");
  if (!food.name) throw new Error("Enter a food name.");
  for (const key of ["calories", "protein", "carbs", "fat"]) {
    if (!Number.isFinite(food[key]) || food[key] < 0 || food[key] > 10000) throw new Error(`Enter a valid ${key} value.`);
  }
  if (!Number.isFinite(food.servings) || food.servings <= 0 || food.servings > 100) throw new Error("Servings must be greater than zero.");
  return food;
}

export function totalsForDate(foods, date) {
  return foods.filter((food) => food.date === date).reduce((totals, food) => {
    for (const key of ["calories", "protein", "carbs", "fat"]) totals[key] += food[key] * food.servings;
    return totals;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

export function validateTargets(input) {
  const result = {};
  for (const key of ["calories", "protein", "carbs", "fat"]) {
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value <= 0 || value > 10000) throw new Error(`${key} target must be greater than zero.`);
    result[key] = value;
  }
  return result;
}

export function validateCheckin(input) {
  const checkin = {
    date: String(input.date || ""),
    energy: Number(input.energy),
    soreness: Number(input.soreness),
    mood: Number(input.mood),
    recovery: Number(input.recovery),
    notes: String(input.notes || "").trim(),
    updatedAt: String(input.updatedAt || new Date().toISOString()),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin.date)) throw new Error("Choose a valid check-in date.");
  for (const key of ["energy", "soreness", "mood", "recovery"]) {
    if (!Number.isInteger(checkin[key]) || checkin[key] < 1 || checkin[key] > 5) throw new Error(`Choose a ${key} rating from 1 to 5.`);
  }
  if (checkin.notes.length > 500) throw new Error("Keep check-in notes under 500 characters.");
  return checkin;
}

export function validateBackup(data) {
  if (!data || ![1, 2].includes(data.schemaVersion) || !Array.isArray(data.foods) || !Array.isArray(data.health) || !data.targets) {
    throw new Error("This is not a valid Forma backup.");
  }
  const foods = data.foods.map(validateFood);
  const targets = validateTargets(data.targets);
  const health = data.health.map((item) => {
    if (!item || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !HEALTH_METRIC_KEYS.includes(item.metric)) {
      throw new Error("The backup contains an invalid health record.");
    }
    const value = Number(item.value);
    if (!Number.isFinite(value) || value < 0) throw new Error("The backup contains an invalid health value.");
    return { ...item, id: `${item.date}:${item.metric}`, value };
  });
  const checkins = (data.checkins || []).map(validateCheckin);
  return { schemaVersion: 2, exportedAt: String(data.exportedAt || ""), foods, health, checkins, targets, importMeta: data.importMeta || null };
}

function shiftDay(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function trendForMetric(health, metric, endDate, days) {
  if (!HEALTH_METRIC_KEYS.includes(metric) || !Number.isInteger(days) || days < 2 || days > 365) throw new Error("Invalid trend request.");
  const currentStart = shiftDay(endDate, -(days - 1));
  const previousStart = shiftDay(currentStart, -days);
  const previousEnd = shiftDay(currentStart, -1);
  const current = health.filter((item) => item.metric === metric && item.date >= currentStart && item.date <= endDate).sort((a, b) => a.date.localeCompare(b.date));
  const previous = health.filter((item) => item.metric === metric && item.date >= previousStart && item.date <= previousEnd);
  const average = (items) => items.length ? items.reduce((sum, item) => sum + Number(item.value), 0) / items.length : null;
  const currentAverage = average(current);
  const previousAverage = average(previous);
  const changePercent = currentAverage !== null && previousAverage ? ((currentAverage - previousAverage) / previousAverage) * 100 : null;
  return {
    points: current,
    latest: current.at(-1) || null,
    average: currentAverage,
    previousAverage,
    changePercent,
    minimum: current.length ? Math.min(...current.map((item) => Number(item.value))) : null,
    maximum: current.length ? Math.max(...current.map((item) => Number(item.value))) : null,
    daysWithData: current.length,
    startDate: currentStart,
    endDate,
  };
}
