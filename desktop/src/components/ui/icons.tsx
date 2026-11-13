import type { SVGProps } from "react";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
}

function base(props: IconProps) {
  const { size = 20, strokeWidth = 1.7, ...rest } = props;
  return {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...rest,
  };
}

export function IconRun(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.8 12.2h3.4l2.1-6.1 3.3 11.8 2.5-7.7 1.9 3.7h5.2" />
    </svg>
  );
}

export function IconStats(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 20V11M12 20V4.5M19.5 20v-6.2" />
      <path d="M2.5 20h19" opacity="0.55" />
    </svg>
  );
}

export function IconGuide(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.2 5.6A2.6 2.6 0 0 1 6.8 3H19.5v15.4H6.8a2.6 2.6 0 0 0-2.6 2.6V5.6Z" />
      <path d="M8 7.2h7.5M8 10.8h5" opacity="0.65" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2.3" />
      <circle cx="9" cy="17" r="2.3" />
    </svg>
  );
}

export function IconQr(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.2" y="3.2" width="6.4" height="6.4" rx="1.5" />
      <rect x="14.4" y="3.2" width="6.4" height="6.4" rx="1.5" />
      <rect x="3.2" y="14.4" width="6.4" height="6.4" rx="1.5" />
      <path d="M14.4 14.4h3.1v3.1h-3.1zM20.8 14.4v6.4h-5.1M14.4 20.8h1.3" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...base(props)} fill="currentColor" stroke="none">
      <path d="M8.4 5.9c0-.8.9-1.3 1.6-.9l8.1 5.1c.7.4.7 1.4 0 1.8l-8.1 5.1c-.7.4-1.6-.1-1.6-.9V5.9Z" />
    </svg>
  );
}

export function IconStop(props: IconProps) {
  return (
    <svg {...base(props)} fill="currentColor" stroke="none">
      <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.2" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5.2 12.6 4.3 4.2 9.3-9.6" />
    </svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4.2 21 20H3L12 4.2Z" />
      <path d="M12 9.4v4.5M12 17.1h.01" />
    </svg>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11v5.4M12 7.9h.01" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6.5 9.5 5.5 5.4 5.5-5.4" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9.5 6.5 5.4 5.5-5.4 5.5" />
    </svg>
  );
}

export function IconPin(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 21s6.5-5.4 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.6 6.5 11 6.5 11Z" />
      <circle cx="12" cy="9.7" r="2.2" />
    </svg>
  );
}

export function IconSync(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 5.5v5h-5" />
      <path d="M19.3 10.5a7.5 7.5 0 1 0 .2 4.2" />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 6.5h15M9 6.5V4.8c0-.6.5-1.1 1.1-1.1h3.8c.6 0 1.1.5 1.1 1.1v1.7M6.5 6.5l.9 12.3c0 .9.8 1.7 1.7 1.7h5.8c.9 0 1.7-.8 1.7-1.7l.9-12.3" />
      <path d="M10 10.5v6M14 10.5v6" opacity="0.7" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.4" />
      <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function IconEye(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.7 12S6.2 5.8 12 5.8 21.3 12 21.3 12 17.8 18.2 12 18.2 2.7 12 2.7 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

export function IconEyeOff(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.1 4.2 19.9 20M9.9 6.2A9.6 9.6 0 0 1 12 5.8c5.8 0 9.3 6.2 9.3 6.2a17 17 0 0 1-2.7 3.4M6.5 8A16.7 16.7 0 0 0 2.7 12S6.2 18.2 12 18.2c1 0 2-.2 2.8-.6" />
      <path d="M10.3 10.4a2.4 2.4 0 0 0 3.3 3.3" />
    </svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 2.8v2.1M12 19.1v2.1M4.1 4.1l1.5 1.5M18.4 18.4l1.5 1.5M2.8 12h2.1M19.1 12h2.1M4.1 19.9l1.5-1.5M18.4 5.6l1.5-1.5" />
    </svg>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 14.7A8.3 8.3 0 0 1 9.3 4a8.5 8.5 0 1 0 10.7 10.7Z" />
    </svg>
  );
}

export function IconAuto(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 3.4v17.2A8.6 8.6 0 0 0 12 3.4Z" fill="currentColor" stroke="none" opacity="0.9" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  );
}

export function IconMinus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5.5 12h13" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6.2 6.2 11.6 11.6M17.8 6.2 6.2 17.8" />
    </svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4.9" y="10.5" width="14.2" height="9.6" rx="2.4" />
      <path d="M8.3 10.5V7.8a3.7 3.7 0 0 1 7.4 0v2.7" />
    </svg>
  );
}

export function IconTimer(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="13.2" r="7.4" />
      <path d="M12 9.8v3.7l2.4 1.4M9.5 3.2h5" />
    </svg>
  );
}

export function IconFlag(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5.5 21V4.2M5.5 4.6c3.5-1.7 6.6 1.6 10.1 0v8.1c-3.5 1.7-6.6-1.6-10.1 0" />
    </svg>
  );
}

export function IconBattery(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="8" width="16.5" height="8" rx="2.2" />
      <path d="M21.5 10.6v2.8" />
      <path d="M6.2 10.6h6.4v2.8H6.2z" fill="currentColor" stroke="none" opacity="0.55" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12h14M13.5 7l5 5-5 5" />
    </svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 15.5V4.8M7.7 9.1 12 4.8l4.3 4.3" />
      <path d="M4.8 15.4v2.4c0 1.2 1 2.2 2.2 2.2h10c1.2 0 2.2-1 2.2-2.2v-2.4" />
    </svg>
  );
}

export function IconScan(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 8.5V5.7c0-1.2 1-2.2 2.2-2.2h2.8M15.5 3.5h2.8c1.2 0 2.2 1 2.2 2.2v2.8M20.5 15.5v2.8c0 1.2-1 2.2-2.2 2.2h-2.8M8.5 20.5H5.7c-1.2 0-2.2-1-2.2-2.2v-2.8" />
      <path d="M3.8 12h16.4" opacity="0.7" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 5.5v5h-5" />
      <path d="M19.2 10.5a7.5 7.5 0 1 0 .2 4.2" />
    </svg>
  );
}

export function IconField(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7.2 3.2v17.6M16.8 3.2v17.6" opacity="0.55" />
      <rect x="3.2" y="5" width="17.6" height="14" rx="7" />
    </svg>
  );
}

export function BrandMark({ size = 28, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden
      {...rest}
    >
      <rect width="32" height="32" rx="9" fill="currentColor" opacity="0.1" />
      <path
        d="M16.2 7.3c3.6 3.7 6.2 6.3 6.2 9.8a6.2 6.2 0 1 1-12.4 0c0-3.5 2.6-6.1 6.2-9.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12.7 17.6c.5 1.7 1.8 2.7 3.5 2.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.4 19 6v5.4c0 4.5-3 7.8-7 9.2-4-1.4-7-4.7-7-9.2V6l7-2.6Z" />
      <path d="m9.2 12.1 2 2 3.7-4" />
    </svg>
  );
}

export function IconPower(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.2v8.2" />
      <path d="M7.1 6.4a7.4 7.4 0 1 0 9.8 0" />
    </svg>
  );
}

export function IconDatabase(props: IconProps) {
  return (
    <svg {...base(props)}>
      <ellipse cx="12" cy="6.4" rx="7.4" ry="2.8" />
      <path d="M4.6 6.4v11.2c0 1.5 3.3 2.8 7.4 2.8s7.4-1.3 7.4-2.8V6.4" />
      <path d="M4.6 12c0 1.5 3.3 2.8 7.4 2.8s7.4-1.3 7.4-2.8" opacity="0.6" />
    </svg>
  );
}

export function IconShuffle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 7h3.2c1.2 0 2.3.6 3 1.6l4.4 6.8c.7 1 1.8 1.6 3 1.6h3.4" />
      <path d="M3.5 17h3.2c1.2 0 2.3-.6 3-1.6M14 8.6c.7-1 1.8-1.6 3-1.6h3.4" />
      <path d="m17.6 4.4 2.8 2.6-2.8 2.6M17.6 14.4l2.8 2.6-2.8 2.6" />
    </svg>
  );
}

export function IconTrack(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.8" y="6.4" width="18.4" height="11.2" rx="5.6" />
      <path d="M7.6 6.4v11.2M16.4 6.4v11.2" opacity="0.4" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
