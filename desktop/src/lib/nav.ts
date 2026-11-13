export type TabKey = "run" | "stats" | "guide" | "settings" | "extract";

export interface NavItem {
  key: TabKey;
  label: string;
  short: string;
  desktopOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "run", label: "运动", short: "运动" },
  { key: "stats", label: "成绩", short: "成绩" },
  { key: "guide", label: "指南", short: "指南" },
  { key: "settings", label: "设置", short: "设置" },
  { key: "extract", label: "取码", short: "取码", desktopOnly: true },
];

export function isTabKey(value: string): value is TabKey {
  return NAV_ITEMS.some((item) => item.key === value);
}
