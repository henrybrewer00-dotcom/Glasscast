import Foundation
import CoreGraphics
import AppKit
import ScreenCaptureKit

struct WindowListEntry: Codable {
	let id: String
	let name: String
	let display_id: String
	let appName: String?
	let windowTitle: String?
	let bundleId: String?
	let appIcon: String?
	var thumbnail: String?
	let x: Double
	let y: Double
	let width: Double
	let height: Double
}

// Pass --thumbnails to also capture a live JPEG preview per window via
// SCScreenshotManager. Kept behind a flag because captures cost ~30-80ms each
// and the bare metadata listing is polled on a hot path during recording.
let includeThumbnails = CommandLine.arguments.contains("--thumbnails")

func captureWindowThumbnail(_ window: SCWindow) async -> String? {
	let frame = window.frame
	guard frame.width > 0, frame.height > 0 else { return nil }

	let targetWidth: CGFloat = 320
	let scale = min(1, targetWidth / frame.width)
	let config = SCStreamConfiguration()
	config.width = max(1, Int(frame.width * scale))
	config.height = max(1, Int(frame.height * scale))
	config.showsCursor = false
	config.capturesAudio = false

	let filter = SCContentFilter(desktopIndependentWindow: window)
	do {
		let image = try await SCScreenshotManager.captureImage(
			contentFilter: filter,
			configuration: config
		)
		let rep = NSBitmapImageRep(cgImage: image)
		guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.6])
		else { return nil }
		return "data:image/jpeg;base64," + jpeg.base64EncodedString()
	} catch {
		// Minimized or otherwise uncapturable windows fall back to the app icon.
		return nil
	}
}

var appIconCache: [pid_t: String?] = [:]

func appIconDataUrl(for pid: pid_t) -> String? {
	if let cached = appIconCache[pid] {
		return cached
	}

	var result: String? = nil
	if let app = NSRunningApplication(processIdentifier: pid), let icon = app.icon {
		let size = NSSize(width: 64, height: 64)
		let resized = NSImage(size: size)
		resized.lockFocus()
		icon.draw(in: NSRect(origin: .zero, size: size))
		resized.unlockFocus()
		if let tiff = resized.tiffRepresentation,
			let rep = NSBitmapImageRep(data: tiff),
			let png = rep.representation(using: .png, properties: [:]) {
			result = "data:image/png;base64," + png.base64EncodedString()
		}
	}

	appIconCache[pid] = result
	return result
}

func normalize(_ value: String?) -> String? {
	guard let rawValue = value?.trimmingCharacters(in: .whitespacesAndNewlines), !rawValue.isEmpty else {
		return nil
	}

	return rawValue
}

let excludedBundleIds: Set<String> = [
	"com.apple.controlcenter",
	"com.apple.dock",
	"com.apple.WindowManager",
	"com.apple.wallpaper.agent",
]

let excludedWindowTitles: Set<String> = [
	"Display 1 Backstop",
	"Event Shield Window",
	"Menubar",
	"Offscreen Wallpaper Window",
	"Wallpaper-",
]

// Force CoreGraphics Services initialization before asking ScreenCaptureKit for
// shareable content. Without this, the helper can stall sporadically when run
// as a standalone CLI process from Electron.
let _ = CGMainDisplayID()

let group = DispatchGroup()
group.enter()

Task {
	do {
		// onScreenWindowsOnly:false so windows on other Spaces / fullscreen desktops /
		// minimized windows are still listed (matches QuickTime/Zoom picker behavior).
		let shareableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

		struct RawWindowEntry {
			let entry: WindowListEntry
			let hasRawTitle: Bool
			let bundleId: String?
		}

		let rawEntries = shareableContent.windows.compactMap { window -> RawWindowEntry? in
			let appName = normalize(window.owningApplication?.applicationName)
			let windowTitle = normalize(window.title)
			let bundleId = normalize(window.owningApplication?.bundleIdentifier)
			let frame = window.frame

			guard window.windowLayer == 0 else {
				return nil
			}

			// Off-screen listing pulls in system service windows (CursorUIViewService,
			// loginwindow, …). Only keep windows owned by regular Dock applications.
			if let pid = window.owningApplication?.processID,
				let app = NSRunningApplication(processIdentifier: pid) {
				guard app.activationPolicy == .regular else {
					return nil
				}
			}

			guard frame.width >= 50, frame.height >= 50 else {
				return nil
			}

			guard appName != nil || windowTitle != nil else {
				return nil
			}

			if let bundleId, excludedBundleIds.contains(bundleId) {
				return nil
			}

			if let windowTitle, excludedWindowTitles.contains(windowTitle) {
				return nil
			}

			let matchedDisplay = shareableContent.displays.first(where: { display in
				display.frame.intersects(frame) || display.frame.contains(CGPoint(x: frame.midX, y: frame.midY))
			})

			let resolvedWindowTitle = windowTitle ?? appName ?? "Window"
			let resolvedName: String
			if let appName, let windowTitle {
				resolvedName = "\(appName) — \(windowTitle)"
			} else {
				resolvedName = resolvedWindowTitle
			}

			let entry = WindowListEntry(
				id: "window:\(window.windowID):0",
				name: resolvedName,
				display_id: matchedDisplay.map { String($0.displayID) } ?? "",
				appName: appName,
				windowTitle: resolvedWindowTitle,
				bundleId: bundleId,
				appIcon: window.owningApplication.map { appIconDataUrl(for: $0.processID) } ?? nil,
				x: Double(frame.origin.x),
				y: Double(frame.origin.y),
				width: Double(frame.width),
				height: Double(frame.height)
			)

			return RawWindowEntry(entry: entry, hasRawTitle: windowTitle != nil, bundleId: bundleId)
		}

		// For apps with multiple windows, drop auxiliary windows that lack a
		// distinct title (e.g. Arc's sidebar/tab-bar chrome). If ALL windows
		// from an app lack titles, keep them all.
		var titledCountByBundle: [String: Int] = [:]
		for raw in rawEntries {
			if let bid = raw.bundleId, raw.hasRawTitle {
				titledCountByBundle[bid, default: 0] += 1
			}
		}

		let entries = rawEntries
			.filter { raw in
				guard let bid = raw.bundleId else { return true }
				if let titled = titledCountByBundle[bid], titled > 0 {
					return raw.hasRawTitle
				}
				return true
			}
			.map { $0.entry }
		.sorted { lhs, rhs in
			let lhsApp = lhs.appName ?? lhs.name
			let rhsApp = rhs.appName ?? rhs.name
			if lhsApp != rhsApp {
				return lhsApp.localizedCaseInsensitiveCompare(rhsApp) == .orderedAscending
			}

			return (lhs.windowTitle ?? lhs.name).localizedCaseInsensitiveCompare(rhs.windowTitle ?? rhs.name) == .orderedAscending
		}

		var finalEntries = entries
		if includeThumbnails {
			var windowsById: [String: SCWindow] = [:]
			for window in shareableContent.windows {
				windowsById["window:\(window.windowID):0"] = window
			}

			let thumbnails = await withTaskGroup(
				of: (Int, String?).self,
				returning: [Int: String].self
			) { group in
				var results: [Int: String] = [:]
				var inFlight = 0
				for (index, entry) in finalEntries.enumerated() {
					guard let window = windowsById[entry.id] else { continue }
					if inFlight >= 16, let (doneIndex, thumbnail) = await group.next() {
						inFlight -= 1
						if let thumbnail { results[doneIndex] = thumbnail }
					}
					inFlight += 1
					group.addTask {
						(index, await captureWindowThumbnail(window))
					}
				}
				for await (doneIndex, thumbnail) in group {
					if let thumbnail { results[doneIndex] = thumbnail }
				}
				return results
			}

			for (index, thumbnail) in thumbnails {
				finalEntries[index].thumbnail = thumbnail
			}
		}

		let encoder = JSONEncoder()
		encoder.outputFormatting = [.sortedKeys]
		let data = try encoder.encode(finalEntries)
		FileHandle.standardOutput.write(data)
	} catch {
		fputs("Error listing windows: \(error.localizedDescription)\n", stderr)
		fflush(stderr)
		exit(1)
	}

	group.leave()
}

group.wait()
