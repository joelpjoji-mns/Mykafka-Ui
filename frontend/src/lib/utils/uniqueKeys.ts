// Suffixes repeated keys so React keys stay unique, while unique items keep
// keys that don't depend on their position in the list.
export const uniqueKeys = (keys: string[]) => {
  const occurrences = new Map<string, number>();
  return keys.map((key) => {
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    return occurrence === 0 ? key : `${key}-${occurrence}`;
  });
};
