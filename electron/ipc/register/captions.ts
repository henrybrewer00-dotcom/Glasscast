import { dialog, ipcMain } from "electron";
import { setCurrentProjectPath } from "../state";
import {
	getWhisperModelStatus,
	listWhisperModelStatuses,
	downloadWhisperModel,
	deleteWhisperModel,
	sendCaptionModelDownloadProgress,
} from "../captions/whisper";
import { generateAutoCaptionsFromVideo } from "../captions/generate";
import { DEFAULT_WHISPER_MODEL_ID } from "../captions/models";
import {
	deleteCaptionProviderKey,
	getAllCaptionProviderKeyStatuses,
	getCaptionProviderKey,
	getCaptionProviderKeyStatus,
	saveCaptionProviderKey,
} from "../../secretStore";
import { approveUserPath, getRecordingsDir } from "../utils";

export function registerCaptionHandlers() {
  ipcMain.handle('open-video-file-picker', async () => {
    try {
      const recordingsDir = await getRecordingsDir()
      const result = await dialog.showOpenDialog({
        title: 'Select Video File',
        defaultPath: recordingsDir,
        filters: [
          { name: 'Video Files', extensions: ['webm', 'mp4', 'mov', 'avi', 'mkv'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      approveUserPath(result.filePaths[0])
      setCurrentProjectPath(null)
      return {
        success: true,
        path: result.filePaths[0]
      };
    } catch (error) {
      console.error('Failed to open file picker:', error);
      return {
        success: false,
        message: 'Failed to open file picker',
        error: String(error)
      };
    }
  });

  ipcMain.handle('open-audio-file-picker', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Audio File',
        filters: [
          { name: 'Audio Files', extensions: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      approveUserPath(result.filePaths[0])
      return {
        success: true,
        path: result.filePaths[0]
      };
    } catch (error) {
      console.error('Failed to open audio file picker:', error);
      return {
        success: false,
        message: 'Failed to open audio file picker',
        error: String(error)
      };
    }
  });

  ipcMain.handle('open-whisper-executable-picker', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Whisper Executable',
        filters: [
          { name: 'Executables', extensions: process.platform === 'win32' ? ['exe', 'cmd', 'bat'] : ['*'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      approveUserPath(result.filePaths[0])
      return { success: true, path: result.filePaths[0] }
    } catch (error) {
      console.error('Failed to open Whisper executable picker:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('open-whisper-model-picker', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Whisper Model',
        filters: [
          { name: 'Whisper Models', extensions: ['bin'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      approveUserPath(result.filePaths[0])
      return { success: true, path: result.filePaths[0] }
    } catch (error) {
      console.error('Failed to open Whisper model picker:', error)
      return { success: false, error: String(error) }
    }
  })

  // List download status for every model in the registry.
  ipcMain.handle('list-whisper-models', async () => {
    try {
      return await listWhisperModelStatuses()
    } catch (error) {
      return { success: false, models: [], error: String(error) }
    }
  })

  // Per-model status. modelId defaults to the legacy "small" model.
  ipcMain.handle('get-whisper-model-status', async (_, modelId?: string) => {
    try {
      return await getWhisperModelStatus(modelId)
    } catch (error) {
      return { success: false, exists: false, path: null, error: String(error) }
    }
  })

  ipcMain.handle('download-whisper-model', async (event, modelId?: string) => {
    const resolvedModelId = modelId ?? DEFAULT_WHISPER_MODEL_ID
    try {
      const existing = await getWhisperModelStatus(resolvedModelId)
      if (existing.exists) {
        sendCaptionModelDownloadProgress(event.sender, {
          modelId: existing.modelId,
          status: 'downloaded',
          progress: 100,
          path: existing.path,
        })
        return { success: true, modelId: existing.modelId, path: existing.path, alreadyDownloaded: true }
      }

      const modelPath = await downloadWhisperModel(event.sender, resolvedModelId)
      return { success: true, modelId: existing.modelId, path: modelPath }
    } catch (error) {
      console.error('Failed to download Whisper model:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('delete-whisper-model', async (event, modelId?: string) => {
    const resolvedModelId = modelId ?? DEFAULT_WHISPER_MODEL_ID
    try {
      await deleteWhisperModel(resolvedModelId)
      const status = await getWhisperModelStatus(resolvedModelId)
      sendCaptionModelDownloadProgress(event.sender, {
        modelId: status.modelId,
        status: 'idle',
        progress: 0,
        path: null,
      })
      return { success: true, modelId: status.modelId }
    } catch (error) {
      console.error('Failed to delete Whisper model:', error)
      // Verify whether the file was actually removed despite the error
      const status = await getWhisperModelStatus(resolvedModelId)
      if (!status.exists) {
        // File is gone — treat as success
        sendCaptionModelDownloadProgress(event.sender, {
          modelId: status.modelId,
          status: 'idle',
          progress: 0,
          path: null,
        })
        return { success: true, modelId: status.modelId }
      }
      sendCaptionModelDownloadProgress(event.sender, {
        modelId: status.modelId,
        status: 'error',
        progress: 0,
        path: null,
        error: String(error),
      })
      return { success: false, error: String(error) }
    }
  })

  // --- Cloud provider API key management (raw key never returned) ---
  ipcMain.handle('get-caption-key-statuses', async () => {
    try {
      const statuses = await getAllCaptionProviderKeyStatuses()
      return { success: true, statuses }
    } catch (error) {
      return { success: false, statuses: [], error: String(error) }
    }
  })

  ipcMain.handle('get-caption-key-status', async (_, provider: string) => {
    try {
      const status = await getCaptionProviderKeyStatus(provider)
      return { success: true, status }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('save-caption-key', async (_, options: { provider: string; key: string }) => {
    try {
      const status = await saveCaptionProviderKey(options.provider, options.key)
      return { success: true, status }
    } catch (error) {
      console.error('Failed to save caption provider key:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('delete-caption-key', async (_, provider: string) => {
    try {
      const status = await deleteCaptionProviderKey(provider)
      return { success: true, status }
    } catch (error) {
      console.error('Failed to delete caption provider key:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('generate-auto-captions', async (_, options: {
    videoPath: string
    provider?: string
    modelId?: string
    whisperExecutablePath?: string
    whisperModelPath?: string
    language?: string
  }) => {
    try {
      // Cloud providers need an API key, fetched main-side so it never crosses
      // the IPC boundary from the renderer. "glasscast" is the free, login-based
      // path — it authenticates with the user's cloud session inside the provider
      // and needs no saved key here.
      let apiKey: string | undefined
      if (
        options.provider === 'openai' ||
        options.provider === 'groq' ||
        options.provider === 'deepgram'
      ) {
        const key = await getCaptionProviderKey(options.provider)
        if (!key) {
          return {
            success: false,
            error: `No API key saved for ${options.provider}.`,
            message: `Add your ${options.provider} API key in the captions settings first.`,
          }
        }
        apiKey = key
      }

      const result = await generateAutoCaptionsFromVideo({ ...options, apiKey })
      return {
        success: true,
        cues: result.cues,
        message: result.audioSourceLabel === 'recording'
          ? `Generated ${result.cues.length} caption cues.`
          : `Generated ${result.cues.length} caption cues from the ${result.audioSourceLabel}.`,
      }
    } catch (error) {
      console.error('Failed to generate auto captions:', error)
      return {
        success: false,
        error: String(error),
        message: 'Failed to generate auto captions',
      }
    }
  })

}
