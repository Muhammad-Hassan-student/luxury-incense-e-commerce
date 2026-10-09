import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-3 overflow-hidden whitespace-nowrap text-[0.6875rem] uppercase tracking-[0.28em] transition-[color,background-color,border-color,opacity,scale] duration-700 ease-luxe active:scale-[0.98] active:duration-150 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        // Gold fill that wipes in from the left on hover.
        primary:
          "bg-gold text-bg before:absolute before:inset-0 before:-translate-x-full before:bg-fg before:transition-transform before:duration-700 before:ease-luxe hover:before:translate-x-0 [&>*]:relative",
        outline:
          "border border-line-strong text-fg before:absolute before:inset-0 before:translate-y-full before:bg-fg before:transition-transform before:duration-700 before:ease-luxe hover:text-bg hover:before:translate-y-0 [&>*]:relative",
        ghost: "text-fg hover:text-gold",
        link: "link-draw px-0 text-fg",
        danger: "border border-ember/50 text-ember hover:bg-ember hover:text-bg",
      },
      size: {
        sm: "h-9 px-4",
        md: "h-12 px-7",
        lg: "h-14 px-10",
        icon: "size-10 p-0 tracking-normal",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type Props = ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, children, ...props }: Props) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {asChild ? children : <span className="inline-flex items-center gap-3">{children}</span>}
    </Comp>
  );
}
