import path from "node:path";

import { dataDir } from "../hub/config.js";

export const runsDir = path.join(dataDir, "runs");
