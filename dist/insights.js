export const MIN_TRAINING_ROWS = 14;

const MODEL_METRICS = new Set(["hrv", "restingHeartRate", "sleep", "respiratoryRate"]);

/**
 * Send only the compact daily values used by the Python model. The Apple
 * Health ZIP and unrelated measurements never leave the browser.
 */
export async function fetchReadinessInsights(health, checkins, date) {
  const response = await fetch("/api/readiness", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date,
      health: health
        .filter((item) => MODEL_METRICS.has(item.metric))
        .map(({ date: itemDate, metric, value }) => ({ date: itemDate, metric, value })),
      checkins: checkins.map(({ date: itemDate, recovery }) => ({ date: itemDate, recovery })),
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The Python readiness model is unavailable.");
  return result;
}
