// Text input primitive: raised surface, 1 px border, accent border on focus, inline invalid state.
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { disabledStyle, transition } from "./styles";

export const fieldBase = cn(
  "w-full rounded-control border border-border bg-raised px-3 text-body text-fg placeholder:text-faint",
  "outline-none hover:border-border-strong focus-visible:border-accent-ring focus:border-accent-ring",
  "aria-invalid:border-danger",
  transition,
  disabledStyle,
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, type = "text", ...props },
  ref,
) {
  return <input ref={ref} type={type} className={cn(fieldBase, "h-10", className)} {...props} />;
});
