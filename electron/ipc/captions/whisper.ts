import { createWriteStream } from "node:fs";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import type Electron from "electron";
import { WHISPER_MODEL_DIR } from "../constants";
import {
	DEFAULT_WHISPER_MODEL_ID,
	getWhisperModel,
	getWhisperModelPath,
	isWhisperModelId,
	WHISPER_MODELS,
	type WhisperModelId,
} from "./models";

export const CAPTION_MODEL_DOWNLOAD_PROGRESS_CHANNEL = "caption-model-download-progress";

export type CaptionModelDownloadProgress = {
	modelId: WhisperModelId;
	status: "idle" | "downloading" | "downloaded" | "error";
	progress: number;
	path?: string | null;
	error?: string;
};

export function sendCaptionModelDownloadProgress(
	webContents: Electron.WebContents,
	payload: CaptionModelDownloadProgress,
) {
	webContents.send(CAPTION_MODEL_DOWNLOAD_PROGRESS_CHANNEL, payload);
}

function resolveModelId(modelId?: string | null): WhisperModelId {
	return isWhisperModelId(modelId) ? modelId : DEFAULT_WHISPER_MODEL_ID;
}

export async function getWhisperModelStatus(modelId?: string | null) {
	const resolvedId = resolveModelId(modelId);
	const modelPath = getWhisperModelPath(resolvedId);
	try {
		await fs.access(modelPath, fsConstants.R_OK);
		return {
			success: true,
			modelId: resolvedId,
			exists: true,
			path: modelPath,
		};
	} catch {
		return {
			success: true,
			modelId: resolvedId,
			exists: false,
			path: null,
		};
	}
}

export async function listWhisperModelStatuses() {
	const models = await Promise.all(
		Object.values(WHISPER_MODELS).map(async (model) => {
			const status = await getWhisperModelStatus(model.id);
			return {
				id: model.id,
				label: model.label,
				sizeBytes: model.sizeBytes,
				exists: status.exists,
				path: status.path,
			};
		}),
	);
	return { success: true, models };
}

export function downloadFileWithProgress(
	url: string,
	destinationPath: string,
	onProgress: (progress: number) => void,
): Promise<void> {
	const request = (currentUrl: string, redirectCount = 0): Promise<void> => {
		return new Promise((resolve, reject) => {
			const req = httpsGet(currentUrl, { timeout: 30_000 }, (response) => {
				const statusCode = response.statusCode ?? 0;
				const location = response.headers.location;

				if (statusCode >= 300 && statusCode < 400 && location) {
					response.resume();
					if (redirectCount >= 5) {
						reject(new Error("Too many redirects while downloading Whisper model."));
						return;
					}

					const nextUrl = new URL(location, currentUrl).toString();
					void request(nextUrl, redirectCount + 1)
						.then(resolve)
						.catch(reject);
					return;
				}

				if (statusCode < 200 || statusCode >= 300) {
					response.resume();
					reject(new Error(`Whisper model download failed with status ${statusCode}.`));
					return;
				}

				const totalBytes = Number.parseInt(
					String(response.headers["content-length"] ?? "0"),
					10,
				);
				let downloadedBytes = 0;
				const fileStream = createWriteStream(destinationPath);

				response.on("data", (chunk: Buffer) => {
					downloadedBytes += chunk.length;
					if (Number.isFinite(totalBytes) && totalBytes > 0) {
						onProgress(Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
					}
				});

				response.on("error", (error) => {
					fileStream.destroy(error);
				});

				fileStream.on("error", (error) => {
					response.destroy(error);
					reject(error);
				});

				fileStream.on("finish", () => {
					onProgress(100);
					resolve();
				});

				response.pipe(fileStream);
			});

			req.on("error", reject);
			req.on("timeout", () => {
				req.destroy(new Error("Whisper model download timed out."));
			});
		});
	};

	return request(url);
}

export async function downloadWhisperModel(
	webContents: Electron.WebContents,
	modelId?: string | null,
): Promise<string> {
	const resolvedId = resolveModelId(modelId);
	const descriptor = getWhisperModel(resolvedId);
	const modelPath = getWhisperModelPath(resolvedId);

	await fs.mkdir(WHISPER_MODEL_DIR, { recursive: true });
	const tempPath = `${modelPath}.download`;

	sendCaptionModelDownloadProgress(webContents, {
		modelId: resolvedId,
		status: "downloading",
		progress: 0,
		path: null,
	});

	try {
		await fs.rm(tempPath, { force: true });
		await downloadFileWithProgress(descriptor.downloadUrl, tempPath, (progress) => {
			sendCaptionModelDownloadProgress(webContents, {
				modelId: resolvedId,
				status: "downloading",
				progress,
				path: null,
			});
		});
		await fs.rename(tempPath, modelPath);
		sendCaptionModelDownloadProgress(webContents, {
			modelId: resolvedId,
			status: "downloaded",
			progress: 100,
			path: modelPath,
		});
		return modelPath;
	} catch (error) {
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		sendCaptionModelDownloadProgress(webContents, {
			modelId: resolvedId,
			status: "error",
			progress: 0,
			path: null,
			error: String(error),
		});
		throw error;
	}
}

export async function deleteWhisperModel(modelId?: string | null): Promise<void> {
	const resolvedId = resolveModelId(modelId);
	await fs.rm(getWhisperModelPath(resolvedId), { force: true });
}
