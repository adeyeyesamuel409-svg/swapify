import Link from "next/link";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "token";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-btn font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-soft disabled:pointer-events-none disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white shadow-glow hover:brightness-110 hover:shadow-raise active:scale-[0.98]",
  secondary:
    "border border-line-strong bg-surface-2 text-foreground hover:border-primary/60 hover:bg-surface-3 active:scale-[0.98]",
  ghost:
    "text-muted hover:text-foreground hover:bg-surface-2",
  token:
    "border border-token/30 bg-token/10 text-token hover:bg-token/20",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

type ButtonProps = {
  href?: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
} & ({ href: string } | { onClick?: () => void; type?: "button" | "submit" });

export default function Button({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const classes = `${base} ${variants[variant]} ${sizes[size]} ${className}`;

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} {...(rest as { onClick?: () => void; type?: "button" | "submit" })}>
      {children}
    </button>
  );
}
