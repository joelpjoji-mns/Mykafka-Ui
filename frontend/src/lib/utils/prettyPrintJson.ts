// Returns the input unchanged when it is not valid JSON so malformed schemas still render.
export const prettyPrintJson = (value: string, indent: string = '\t') => {
  try {
    return JSON.stringify(JSON.parse(value), null, indent);
  } catch {
    return value;
  }
};
