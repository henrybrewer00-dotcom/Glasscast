import type { RowDefinition } from "dnd-timeline";
import { useRow } from "dnd-timeline";

interface RowProps extends RowDefinition {
	children: React.ReactNode;
	label?: string;
	hint?: string;
	isEmpty?: boolean;
	labelColor?: string;
	/** Zebra index — even rows get #0c0c0e, odd rows #0e0e10. */
	rowIndex?: number;
	onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
	onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
	onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
	onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
	onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export default function Row({
	id,
	children,
	label,
	hint,
	isEmpty,
	labelColor = "#8a8a93",
	rowIndex = 0,
	onMouseEnter,
	onMouseMove,
	onMouseLeave,
	onMouseDown,
	onClick,
}: RowProps) {
	const { setNodeRef, rowWrapperStyle, rowStyle } = useRow({ id });
	const zebraBg = rowIndex % 2 === 0 ? "#0c0c0e" : "#0e0e10";

	return (
		<div
			className="relative flex-1 min-h-[26px]"
			style={{ ...rowWrapperStyle, marginBottom: 2, background: zebraBg }}
		>
			{label && (
				<div
					className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-semibold uppercase tracking-[0.14em] z-20 pointer-events-none select-none"
					style={{ color: labelColor, writingMode: "horizontal-tb" }}
				>
					{label}
				</div>
			)}
			{isEmpty && hint && (
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-10">
					<span className="text-[10px] uppercase tracking-[0.12em] text-[#4a4a52] font-medium">
						{hint}
					</span>
				</div>
			)}
			<div
				ref={setNodeRef}
				className="relative h-full min-h-[26px] overflow-hidden"
				style={rowStyle}
				onMouseEnter={onMouseEnter}
				onMouseMove={onMouseMove}
				onMouseLeave={onMouseLeave}
				onMouseDown={onMouseDown}
				onClick={onClick}
			>
				{children}
			</div>
		</div>
	);
}
