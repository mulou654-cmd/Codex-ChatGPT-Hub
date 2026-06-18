import path from "node:path";

import { spaceDataDir } from "../hub/config.js";

export const paperStatePath = path.join(spaceDataDir, "paper-state.json");
