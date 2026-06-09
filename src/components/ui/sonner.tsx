import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
	// Follow the app's resolved theme so toasts never render as white cards on
	// the Studio Black surfaces (sonner defaults to its light theme otherwise).
	const { theme } = useTheme();

	return (
		<Sonner
			className="toaster group"
			theme={theme}
			duration={3000}
			toastOptions={{
				classNames: {
					toast: "group toast group-[.toaster]:bg-[hsl(var(--editor-surface))] group-[.toaster]:text-foreground group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:rounded-md group-[.toaster]:shadow-lg",
					description: "group-[.toast]:text-muted-foreground",
					actionButton:
						"group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
					cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
					error: "group-[.toaster]:border-primary/40 group-[.toaster]:text-primary",
					success: "group-[.toaster]:text-foreground",
				},
			}}
			{...props}
		/>
	);
};

export { Toaster };
