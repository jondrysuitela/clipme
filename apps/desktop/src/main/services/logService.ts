import fs from "node:fs";
import path from "node:path";
import { projectPaths } from "./projectService";

export function writeProjectLog(projectId: string, name: string, message: string) {
  const logsDir = projectPaths(projectId).logs;
  fs.mkdirSync(logsDir, { recursive: true });
  const filePath = path.join(logsDir, `${name}.log`);
  fs.appendFileSync(filePath, `[${new Date().toISOString()}]\n${message}\n\n`, "utf8");
}
