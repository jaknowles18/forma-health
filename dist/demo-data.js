// Portfolio demo data is generated in memory from today's date. It never enters
// IndexedDB, so trying the demo cannot overwrite a visitor's personal records.
const UNITS = {
  steps: "steps", sleep: "hours", restingHeartRate: "bpm", hrv: "ms", weight: "kg",
  respiratoryRate: "breaths/min", oxygenSaturation: "%", activeEnergy: "kcal",
  exercise: "min", distance: "km", vo2Max: "mL/kg/min",
};

const round = (value, digits = 1) => Number(value.toFixed(digits));
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function shiftDay(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function record(date, metric, value) {
  return { id: `${date}:${metric}`, date, metric, value, unit: UNITS[metric], source: "Demo Apple Watch" };
}

export function isDemoMode(search = globalThis.location?.search || "") {
  return new URLSearchParams(search).get("demo") === "1";
}

export function createDemoData(today) {
  const health = [];
  const checkins = [];

  // Smooth cycles create believable variation while keeping every demo repeatable.
  // Recovery follows sleep, HRV, and RHR, so Python learns a real relationship.
  for (let offset = -119; offset <= 0; offset += 1) {
    const date = shiftDay(today, offset);
    const index = offset + 119;
    const readiness = Math.sin(index / 6.2) + 0.35 * Math.cos(index / 14.5);
    const activity = Math.sin(index / 3.7) + 0.45 * Math.cos(index / 9.1);
    const weekend = [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? 1 : 0;
    const values = {
      steps: Math.round(8200 + 1350 * activity + 900 * weekend),
      sleep: round(7.25 + 0.42 * readiness + 0.18 * Math.sin(index / 2.8)),
      restingHeartRate: Math.round(58 - 2.4 * readiness + 0.7 * Math.cos(index / 4.1)),
      hrv: Math.round(55 + 7.5 * readiness + 1.8 * Math.sin(index / 2.3)),
      weight: round(78.4 - index * 0.006 + 0.25 * Math.sin(index / 8.4)),
      respiratoryRate: round(14.6 - 0.22 * readiness + 0.12 * Math.cos(index / 5.3)),
      oxygenSaturation: round(97.3 + 0.35 * Math.sin(index / 7.2)),
      activeEnergy: Math.round(510 + 105 * activity + 55 * weekend),
      exercise: Math.round(39 + 13 * activity + 10 * weekend),
      distance: round(6.4 + 1.15 * activity + 0.65 * weekend),
      vo2Max: round(44.1 + index * 0.008 + 0.45 * Math.sin(index / 12.1)),
    };
    for (const [metric, value] of Object.entries(values)) health.push(record(date, metric, Math.max(0, value)));

    if (offset >= -69) {
      const recovery = clamp(Math.round(3.25 + readiness), 1, 5);
      checkins.push({
        date,
        energy: clamp(recovery + (index % 5 === 0 ? -1 : 0), 1, 5),
        soreness: clamp(6 - recovery + (index % 9 === 0 ? 1 : 0), 1, 5),
        mood: clamp(recovery + (index % 7 === 0 ? 1 : 0), 1, 5),
        recovery,
        notes: offset === 0 ? "Morning check-in from the portfolio demo." : "",
        updatedAt: `${date}T12:00:00.000Z`,
      });
    }
  }

  const foods = [
    ["demo-breakfast", "Breakfast", "Greek yogurt, oats & berries", 445, 31, 58, 10],
    ["demo-lunch", "Lunch", "Chicken avocado rice bowl", 680, 52, 75, 19],
    ["demo-snack", "Snacks", "Banana protein smoothie", 315, 30, 39, 6],
    ["demo-dinner", "Dinner", "Salmon, potatoes & greens", 705, 48, 64, 27],
  ].map(([id, meal, name, calories, protein, carbs, fat]) => ({
    id, date: today, meal, name, calories, protein, carbs, fat, servings: 1,
    notes: "Sample entry", source: "demo", updatedAt: `${today}T12:00:00.000Z`,
  }));

  return {
    foods, health, checkins,
    targets: { calories: 2300, protein: 165, carbs: 260, fat: 75 },
    importMeta: { importedAt: `${today}T12:00:00.000Z`, fileName: "portfolio-demo", days: 120, records: health.length },
  };
}
