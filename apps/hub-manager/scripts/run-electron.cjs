const { spawn } = require("node:child_process");
const path = require("node:path");

const electronBinary = require("electron");
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [path.join(__dirname, "..")], {
  cwd: path.join(__dirname, ".."),
  env: childEnv,
  stdio: "inherit",
  shell: false
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
