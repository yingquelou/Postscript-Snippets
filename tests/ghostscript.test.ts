import { spawn } from "child_process";
const gs = spawn("gswin64c", ['-dNOPROMPT','-q' ,'ps/dap.ps'])

gs.stdout.on("data", (data) => {
  process.stdout.write('[stout]');
});
gs.stderr.on("data", (data) => {
  process.stderr.write('[stderr]');
  process.stderr.write(data);
});
gs.on("close", (code) => {
  console.log(`Child exited with code ${code}`);
});
process.stdin.pipe(gs.stdin);