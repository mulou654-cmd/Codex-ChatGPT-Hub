import path from "node:path";

import { spaceDataDir } from "../hub/config.js";

export const sessionStatePath = path.join(spaceDataDir, "session-state.json");
