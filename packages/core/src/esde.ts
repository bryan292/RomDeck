import { SYSTEMS } from "./systems.js";
import type { SystemKey } from "./types.js";

export function esdeDirectoryNamesForSystem(systemKey: SystemKey): string[] {
  return SYSTEMS[systemKey].esdeDirectoryNames;
}
