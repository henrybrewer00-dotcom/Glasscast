import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
	React.ElementRef<typeof SliderPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
	<SliderPrimitive.Root
		ref={ref}
		className={cn("relative flex w-full touch-none select-none items-center", className)}
		{...props}
	>
		<SliderPrimitive.Track className="relative h-0.5 w-full grow overflow-hidden rounded-full bg-[hsl(var(--slider-track))]">
			<SliderPrimitive.Range className="absolute h-full bg-[var(--brand-accent)]" />
		</SliderPrimitive.Track>
		<SliderPrimitive.Thumb className="block h-3 w-3 rounded-full border-0 bg-[hsl(var(--slider-thumb))] shadow-[0_1px_4px_hsl(var(--slider-thumb-shadow))] transition-all duration-150 ease-out hover:scale-110 hover:shadow-[0_0_0_4px_hsl(var(--slider-glow)),0_1px_4px_hsl(var(--slider-thumb-shadow))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]/55 disabled:pointer-events-none disabled:opacity-50" />
	</SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
