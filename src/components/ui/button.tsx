import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground hover:bg-[#ff5247] active:bg-[#d92e24]",
				destructive:
					"border border-primary/40 bg-transparent text-primary hover:bg-primary/10 active:bg-primary/15",
				outline:
					"border border-border bg-transparent text-foreground hover:bg-foreground/[0.04] hover:border-foreground/20",
				secondary:
					"border border-border bg-secondary text-secondary-foreground hover:bg-foreground/[0.04]",
				ghost: "bg-transparent hover:bg-foreground/[0.06] hover:text-foreground",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-4 py-2",
				sm: "h-8 rounded-md px-3 text-xs",
				lg: "h-10 rounded-md px-8",
				icon: "h-9 w-9",
			},
			// Special variant for icon buttons with consistent sizing
			iconSize: {
				default: "[&_svg]:size-4",
				sm: "[&_svg]:size-3.5",
				lg: "[&_svg]:size-5",
				xl: "[&_svg]:size-6",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
			iconSize: "default",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	/** Whether to render the button as a child component (useful for composition) */
	asChild?: boolean;
	/** Size of the icon inside the button */
	iconSize?: "default" | "sm" | "lg" | "xl";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, iconSize, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button";
		return (
			<Comp
				className={cn(buttonVariants({ variant, size, iconSize, className }))}
				ref={ref}
				{...props}
			/>
		);
	},
);
Button.displayName = "Button";

export { Button, buttonVariants };

