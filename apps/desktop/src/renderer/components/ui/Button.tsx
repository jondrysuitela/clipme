import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "icon";
};

export default function Button({ variant = "primary", className = "", children, ...props }: ButtonProps) {
  const map: Record<string, string> = {
    primary: "primary-action",
    secondary: "secondary-action",
    ghost: "ghost-button",
    icon: "icon-button"
  };
  const cls = map[variant] ?? "ghost-button";
  return (
    <button {...props} className={`${cls} ${className}`.trim()}>
      {children}
    </button>
  );
}
