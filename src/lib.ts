export const CATEGORIES = ["power tools", "hand tools", "garden", "kitchen", "camping", "cleaning", "other"] as const;
export const CONDITIONS = ["like new", "good", "worn"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Condition = (typeof CONDITIONS)[number];

export const errorMessage = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  // Convex wraps server errors; show only the human part.
  const hit = /Uncaught Error: ([^\n]+)/.exec(m);
  return hit ? hit[1] : m.replace(/^\[.*?\]\s*/, "").split("\n")[0];
};

export const today = () => new Date().toISOString().slice(0, 10);
