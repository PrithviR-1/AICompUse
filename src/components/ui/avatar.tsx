// Model avatar (monogram on a vendor-colored rounded square) and the profile circle (§15.9, §15.3).
import { cn } from "@/lib/utils";
import { avatarColorIndex, monogram } from "@/lib/avatar";

// Literal class names so Tailwind generates each palette color.
const COLOR_CLASSES = [
  "bg-avatar-1",
  "bg-avatar-2",
  "bg-avatar-3",
  "bg-avatar-4",
  "bg-avatar-5",
  "bg-avatar-6",
  "bg-avatar-7",
  "bg-avatar-8",
  "bg-avatar-9",
  "bg-avatar-10",
  "bg-avatar-11",
  "bg-avatar-12",
];

const SIZE_CLASSES = {
  sm: "size-7 text-meta",
  md: "size-10 text-title",
  lg: "size-24 text-page",
} as const;

export type AvatarSize = keyof typeof SIZE_CLASSES;

interface ModelAvatarProps {
  name: string;
  vendor: string;
  size?: AvatarSize;
  className?: string;
}

export function ModelAvatar({ name, vendor, size = "sm", className }: ModelAvatarProps) {
  const color = COLOR_CLASSES[avatarColorIndex(vendor) - 1];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-avatar font-semibold text-avatar-text",
        SIZE_CLASSES[size],
        color,
        className,
      )}
    >
      {monogram(name)}
    </span>
  );
}

export function ProfileAvatar({ initial, className }: { initial: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-fill text-meta font-semibold text-accent-contrast",
        className,
      )}
    >
      {initial.slice(0, 1).toUpperCase()}
    </span>
  );
}
