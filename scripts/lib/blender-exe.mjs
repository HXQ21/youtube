// Where Blender is: --blender <path>, BLENDER_EXE, D:\app\blender.exe (this machine), Program Files, or the Windows
// installed-apps list. Shared by scripts/blender.mjs and scripts/film.mjs.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const findBlender = (explicit) => {
  const c = [explicit, process.env.BLENDER_EXE, "D:/app/blender.exe"].filter((x) => x && x !== true);
  for (const base of ["C:/Program Files/Blender Foundation", "D:/Program Files/Blender Foundation", "C:/Program Files (x86)/Steam/steamapps/common"]) {
    if (!fs.existsSync(base)) continue;
    const dirs = fs.readdirSync(base).filter((d) => /^blender/i.test(d)).sort((x, y) => y.localeCompare(x, undefined, { numeric: true }));
    for (const d of dirs) c.push(path.join(base, d, "blender.exe"));
  }
  let hit = c.find((x) => fs.existsSync(x));
  if (!hit && process.platform === "win32") {
    const r = spawnSync("powershell", ["-NoProfile", "-Command", "Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*,HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -EA SilentlyContinue | ? DisplayName -eq 'Blender' | % InstallLocation"], { encoding: "utf8" });
    hit = String(r.stdout ?? "").split(/\r?\n/).map((d) => d.trim()).filter(Boolean).map((d) => path.join(d, "blender.exe")).find((x) => fs.existsSync(x));
  }
  return hit ?? null;
};
