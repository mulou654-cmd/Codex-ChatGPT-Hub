import path from "node:path";

import { dataDir } from "../hub/config.js";

export const paperStatePath = path.join(dataDir, "paper-state.json");
