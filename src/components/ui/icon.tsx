// Lucide icon wrapper: one stroke width and the four sizes of the design system (§15.10).
import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = { xs: "icon-xs", sm: "icon-sm", md: "icon-md", lg: "icon-lg" } as const;

export type IconSize = keyof typeof SIZES;

interface IconProps extends Omit<LucideProps, "size" | "ref"> {
  icon: LucideIcon;
  size?: IconSize;
}

export function Icon({ icon: Component, size = "md", className, strokeWidth = 1.75, ...props }: IconProps) {
  return <Component aria-hidden className={cn(SIZES[size], className)} strokeWidth={strokeWidth} {...props} />;
}
