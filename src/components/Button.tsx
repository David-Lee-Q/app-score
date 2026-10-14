import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "soft"
  | "ghost"
  | "danger";

export type ButtonSize = "xs" | "sm" | "md" | "tab";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-slate-300 disabled:shadow-none",
  secondary:
    "border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:text-slate-300 disabled:hover:border-slate-300 disabled:hover:bg-white",
  soft: "border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:border-indigo-100 disabled:text-indigo-300",
  ghost:
    "text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:text-slate-300 disabled:hover:bg-transparent",
  danger:
    "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:border-rose-100 disabled:text-rose-300 disabled:hover:bg-white",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "px-3 py-1.5 text-xs",
  sm: "px-3.5 py-2 text-sm",
  md: "px-4 py-2.5 text-sm",
  tab: "px-4 py-1.5 text-sm",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
