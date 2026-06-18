import path from "node:path";

import { spaceDataDir } from "../hub/config.js";

export const runsDir = path.join(spaceDataDir, "runs");
