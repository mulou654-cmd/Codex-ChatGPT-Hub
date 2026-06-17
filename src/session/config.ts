import path from "node:path";

import { dataDir } from "../hub/config.js";

export const sessionStatePath = path.join(dataDir, "session-state.json");
