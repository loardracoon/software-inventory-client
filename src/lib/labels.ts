// User-facing names for enum values.

export const PLATFORM_LABEL: Record<string, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

export const KIND_LABEL: Record<string, string> = {
  program: "Program",
  extension: "Browser extension",
  ide_extension: "IDE extension",
  package: "Package",
};

export const SOURCE_LABEL: Record<string, string> = {
  programs: "Windows programs",
  apps: "macOS apps",
  deb: "deb",
  rpm: "rpm",
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  brave: "Brave",
  vivaldi: "Vivaldi",
  opera: "Opera",
  chromium: "Chromium",
  vscode: "VS Code",
  npm: "npm",
  pip: "pip",
  chocolatey: "Chocolatey",
  homebrew: "Homebrew",
};

export const CHANGE_LABEL: Record<string, string> = { added: "Added", updated: "Updated", removed: "Removed" };

export function label(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "—";
  return map[value] ?? value;
}
