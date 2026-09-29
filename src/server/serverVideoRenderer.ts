import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI } from '@google/genai';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { extractArticleFromUrl, generateReportageScript } from './reportageService';
import { generateNarrativeVideoScript, searchRealWebMedia } from './narrativeService';
import { WhatsAppVideoJob, VOICE_CATALOG } from './whatsappService';
import { ExtractedArticle } from '../types';
import { geminiKeyManager } from './geminiKeyManager';

const execFileAsync = promisify(execFile);

const TEMP_BASE_DIR = path.resolve(process.cwd(), 'data', 'whatsapp', 'temp_render');
const VIDEOS_DIR = path.resolve(process.cwd(), 'data', 'whatsapp', 'videos');

for (const dir of [TEMP_BASE_DIR, VIDEOS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Prune any stale render temp directories left from prior server restarts or crashes (>1 hour old)
try {
  if (fs.existsSync(TEMP_BASE_DIR)) {
    const entries = fs.readdirSync(TEMP_BASE_DIR);
    const now = Date.now();
    for (const entry of entries) {
      const fullPath = path.join(TEMP_BASE_DIR, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && now - stat.mtimeMs > 3600000) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
      } catch {}
    }
  }
} catch {}

// FreeSansBold font path verified on Ubuntu container
const DEFAULT_FONT_PATH = '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf';
const HAS_FONT = fs.existsSync(DEFAULT_FONT_PATH);

/**
 * Executes FFmpeg asynchronously using execFile (zero shell injection, non-blocking event loop)
 */
async function runFfmpegAsync(args: string[], timeoutMs = 120000): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('ffmpeg', args, {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (err: any) {
    if (err?.killed) {
      throw new Error(`FFmpeg abortado por timeout após ${timeoutMs / 1000}s`);
    }
    const errMsg = err?.stderr || err?.message || String(err);
    throw new Error(`Erro na execução do FFmpeg: ${errMsg.slice(-400)}`);
  }
}

/**
 * Measures media duration with ffprobe asynchronously
 */
async function runFfprobeDurationAsync(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 15000, maxBuffer: 1024 * 1024 }
    );
    const parsed = parseFloat(stdout.trim());
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  } catch (e) {
    console.warn('[Renderer] Aviso ao verificar duração com ffprobe:', e);
  }
  return 0;
}

/**
 * Sanitizes plain text for Microsoft Edge TTS SSML markup.
 * Crucial fix: Prevents XML parsing crashes and WebSocket drops when encountering &, <, >, ", '
 */
function escapeXmlForSSML(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Sanitizes text specifically for FFmpeg drawtext filter
 * Cleans newlines, control characters, single/double quotes, and escapes FFmpeg filter syntax
 */
function escapeDrawText(text: string): string {
  if (!text) return '';
  // 1. Remove newlines and excess whitespace
  let clean = text.replace(/[\r\n\t]+/g, ' ').trim();
  // 2. Remove emojis and unusual symbols that have no font glyphs and cause stderr spam
  clean = clean.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
    ''
  );
  // 3. Escape special FFmpeg drawtext characters
  return clean
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\u2019') // Typographic apostrophe prevents shell/filter breaks
    .replace(/"/g, '”') // Typographic double quote prevents breaking
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .trim();
}

/**
 * Splits text into natural sentence chunks under 300 chars for reliable MsEdgeTTS synthesis
 */
function chunkTextForSynthesis(raw: string, maxLen = 300): string[] {
  if (!raw) return [];
  const clean = raw.replace(/\r\n/g, '\n').replace(/\t/g, ' ').trim();
  const sentences = clean.split(/(?<=[.!?…\n])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const s of sentences) {
    if (!s) continue;
    if ((current + ' ' + s).trim().length > maxLen) {
      if (current.trim()) chunks.push(current.trim());
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks.length > 0 ? chunks : [raw.slice(0, maxLen)];
}

/**
 * Synthesizes a chunk with an active MsEdgeTTS instance with XML sanitization, stream drain and timeout safety
 */
async function synthesizeChunkWithInstance(tts: MsEdgeTTS, text: string): Promise<Buffer> {
  const sanitizedText = escapeXmlForSSML(text);

  return new Promise<Buffer>((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        reject(new Error('Timeout no chunk de voz neural (30s)'));
      }
    }, 30000);

    try {
      const { audioStream, metadataStream } = tts.toStream(sanitizedText);

      // Drain metadata stream safely to avoid unhandled errors and memory accumulation
      if (metadataStream) {
        metadataStream.resume();
        metadataStream.on('error', () => {});
      }

      const parts: Buffer[] = [];
      audioStream.on('data', (c: Buffer) => parts.push(c));
      audioStream.on('end', () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve(Buffer.concat(parts));
        }
      });
      audioStream.on('error', (err: any) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          reject(err);
        }
      });
      audioStream.on('close', () => {
        if (!finished && parts.length > 0) {
          finished = true;
          clearTimeout(timer);
          resolve(Buffer.concat(parts));
        }
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

/**
 * Synthesizes complete speech narration and streams directly to an MP3 file on disk.
 * Optimized for long videos:
 * - Reuses WebSocket connection across chunks (eliminates 20+ redundant TLS handshakes)
 * - Streams directly to disk via appendFileSync (O(1) memory instead of holding entire audio buffer in RAM)
 * - Auto-reconnects and falls back if connection drops
 * - Non-blocking event loop with setImmediate yielding
 */
async function synthesizeFullAudioToFile(text: string, voiceId: string, destFilePath: string): Promise<number> {
  const chunks = chunkTextForSynthesis(text);
  if (fs.existsSync(destFilePath)) {
    try {
      fs.unlinkSync(destFilePath);
    } catch {}
  }

  const primaryVoice = voiceId || 'pt-BR-FranciscaNeural';
  const fallbackVoice = 'pt-BR-FranciscaNeural';

  let currentTTS: MsEdgeTTS | null = null;
  let currentVoiceUsed = '';

  const getOrCreateTTS = async (voice: string): Promise<MsEdgeTTS> => {
    if (currentTTS && currentVoiceUsed === voice) {
      return currentTTS;
    }
    if (currentTTS) {
      try {
        currentTTS.close();
      } catch {}
      currentTTS = null;
    }
    const t = new MsEdgeTTS();
    await t.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    currentTTS = t;
    currentVoiceUsed = voice;
    return t;
  };

  let totalChunksWritten = 0;

  try {
    for (let idx = 0; idx < chunks.length; idx++) {
      const c = chunks[idx];
      if (!c.trim()) continue;

      let chunkBuffer: Buffer | null = null;

      try {
        const tts = await getOrCreateTTS(primaryVoice);
        chunkBuffer = await synthesizeChunkWithInstance(tts, c);
      } catch (e: any) {
        console.warn(`[Renderer] [TTS] Falha no chunk ${idx + 1}/${chunks.length} com voz primária (${e?.message}). Tentando reconexão/fallback...`);
        if (currentTTS) {
          try {
            currentTTS.close();
          } catch {}
          currentTTS = null;
        }

        try {
          const targetVoice = primaryVoice !== fallbackVoice ? fallbackVoice : primaryVoice;
          const ttsFallback = await getOrCreateTTS(targetVoice);
          chunkBuffer = await synthesizeChunkWithInstance(ttsFallback, c);
        } catch (fallbackErr: any) {
          console.warn(`[Renderer] [TTS] Erro repetido no chunk ${idx + 1}/${chunks.length}:`, fallbackErr?.message);
        }
      }

      if (chunkBuffer && chunkBuffer.length > 0) {
        fs.appendFileSync(destFilePath, chunkBuffer);
        totalChunksWritten++;
        chunkBuffer = null; // Free chunk memory immediately
      }

      // Yield event loop between chunks so network keepalives and server routes remain responsive
      await new Promise((r) => setImmediate(r));
    }
  } finally {
    if (currentTTS) {
      try {
        currentTTS.close();
      } catch {}
      currentTTS = null;
    }
  }

  if (totalChunksWritten === 0 || !fs.existsSync(destFilePath) || fs.statSync(destFilePath).size === 0) {
    throw new Error('Falha ao sintetizar o áudio da narração (nenhum chunk de áudio gerado com sucesso).');
  }

  // Measure audio duration using async ffprobe
  const measuredDur = await runFfprobeDurationAsync(destFilePath);
  if (measuredDur > 0) {
    return measuredDur;
  }

  // Fallback duration estimation: ~14 characters per second of speech
  return Math.max(3, Math.round(text.length / 14));
}

/**
 * Downloads a media file with timeout, returns local path if successful
 */
async function downloadMediaToLocalFile(url: string, destPath: string): Promise<boolean> {
  if (!url) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timer);

    if (!res.ok) return false;
    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    if (buf.length < 512) return false;

    fs.writeFileSync(destPath, buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates a clean fallback card for a scene if an image fails to download
 */
async function generateFallbackCard(destPath: string, width: number, height: number, colorHex = '0x0f172a') {
  await runFfmpegAsync([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${colorHex}:s=${width}x${height}:d=1`,
    '-vframes',
    '1',
    destPath,
  ]);
}

export interface RenderResult {
  videoFilePath: string;
  videoSizeBytes: number;
  videoBuffer?: Buffer;
  title: string;
  filename: string;
}

/**
 * 100% Autonomous Server-Side Video Production Engine:
 * - Extracts story/reportage
 * - Synthesizes neural voice with MsEdgeTTS (sanitized SSML)
 * - Gathers scene images/videos
 * - Uses FFmpeg asynchronously with `-preset veryfast -tune stillimage -threads 2`
 * - Non-blocking event loop, bounded RAM and zero unhandled rejections
 */
export async function renderVideoForJob(
  job: WhatsAppVideoJob,
  onProgress?: (progress: number, statusText: string) => void
): Promise<RenderResult> {
  const jobId = job.id;
  const jobStartTime = Date.now();
  const jobDir = path.join(TEMP_BASE_DIR, jobId);
  if (!fs.existsSync(jobDir)) {
    fs.mkdirSync(jobDir, { recursive: true });
  }

  const notify = (p: number, text: string) => {
    if (onProgress) onProgress(p, text);
  };

  try {
    notify(10, 'Iniciando produção autônoma do vídeo no servidor...');
    console.log(`[Renderer] [Job ${jobId}] Iniciando renderização para comando: ${job.parsed.commandUsed}`);

    // 1. Script Generation & Scene Breakdown
    const scriptStartTime = Date.now();
    let title = 'Vídeo IA Narrada';
    let fullNarration = '';
    interface SceneItem {
      caption: string;
      narrationSegment: string;
      mediaUrl?: string;
      searchTag?: string;
      mediaType?: 'image' | 'video';
    }
    let scenes: SceneItem[] = [];

    if (job.parsed.studioMode === 'reportagem') {
      notify(18, 'Extraindo matéria e fatos jornalísticos...');
      let articleData: ExtractedArticle;
      if (job.parsed.url) {
        articleData = await extractArticleFromUrl(job.parsed.url);
      } else {
        articleData = {
          title: job.parsed.content.slice(0, 100),
          description: job.parsed.content.slice(0, 250),
          text: job.parsed.content,
          siteName: 'Notícias',
          url: job.parsed.url || '',
          images: [],
          videos: [],
        };
      }

      notify(26, 'IA gerando roteiro telejornalístico e cortes de cena...');
      try {
        const scriptData = await geminiKeyManager.executeWithRotation(
          async (aiClient) => generateReportageScript(aiClient, articleData, job.parsed.durationSeconds),
          { taskName: 'Reportage Script Generation' }
        );
        title = scriptData.headline || articleData.title || 'Reportagem Especial';
        fullNarration = scriptData.fullNarration || articleData.description || job.parsed.content;

        if (Array.isArray(scriptData.scenes) && scriptData.scenes.length > 0) {
          scenes = scriptData.scenes.map((sc: any) => ({
            caption: sc.caption || sc.leadSummary || '',
            narrationSegment: sc.leadSummary || sc.caption || '',
            mediaUrl: sc.exactMediaUrl || sc.mediaUrl,
            searchTag: sc.searchTag,
            mediaType: sc.mediaType === 'video' ? 'video' : 'image',
          }));
        }
      } catch (reportageErr: any) {
        console.warn('[Renderer] Fallback local para matéria jornalística:', reportageErr?.message);
        title = articleData.title || 'Reportagem Especial';
        fullNarration = articleData.description || articleData.text || job.parsed.content;
      }
    } else {
      // Roteiro Criativo / História
      notify(20, 'IA estruturando roteiro cinematográfico e narrativa...');
      try {
        const narrativeResult = await geminiKeyManager.executeWithRotation(
          async (aiClient) =>
            generateNarrativeVideoScript(aiClient, {
              mode: job.parsed.inputMode === 'full_prompt' ? 'full_prompt' : 'idea_theme',
              storyText: job.parsed.content,
              premise: job.parsed.content,
              targetDurationSeconds: job.parsed.durationSeconds || 60,
              aspectRatio: job.parsed.aspectRatio === '16:9' ? '16:9' : '9:16',
            }),
          { taskName: 'Narrative Script Generation' }
        );

        title = narrativeResult.title || 'História Narrada';
        fullNarration = narrativeResult.fullNarration;

        if (Array.isArray(narrativeResult.scenes) && narrativeResult.scenes.length > 0) {
          scenes = narrativeResult.scenes.map((sc) => ({
            caption: sc.caption || sc.narrationSegment || '',
            narrationSegment: sc.narrationSegment || sc.caption || '',
            mediaUrl: sc.exactMediaUrl || sc.mediaUrl,
            searchTag: sc.searchTag || sc.caption,
            mediaType: sc.mediaType === 'video' ? 'video' : 'image',
          }));
        }
      } catch (narrativeErr: any) {
        console.warn('[Renderer] Fallback local para divisão de roteiro criativo:', narrativeErr?.message);
        title = 'História Narrada';
        fullNarration = job.parsed.content;
      }
    }

    if (!fullNarration || fullNarration.trim().length === 0) {
      fullNarration = job.parsed.content;
    }

    // If no scenes returned, split narration into 3-5 balanced scenes
    if (scenes.length === 0) {
      const parts = fullNarration.split(/(?<=[.!?])\s+/).filter((s) => s.length > 15);
      const sceneCount = Math.max(2, Math.min(6, Math.ceil(parts.length / 2)));
      const perScene = Math.ceil(parts.length / sceneCount);
      for (let i = 0; i < sceneCount; i++) {
        const seg = parts.slice(i * perScene, (i + 1) * perScene).join(' ');
        if (seg.trim()) {
          scenes.push({
            caption: seg.slice(0, 100),
            narrationSegment: seg,
            searchTag: title,
            mediaType: 'image',
          });
        }
      }
    }

    if (scenes.length === 0) {
      scenes = [
        {
          caption: title,
          narrationSegment: fullNarration,
          searchTag: title,
          mediaType: 'image',
        },
      ];
    }
    console.log(`[Renderer] [Job ${jobId}] [Perf] Roteiro estruturado em ${Date.now() - scriptStartTime}ms (${scenes.length} cenas)`);

    // 2. Synthesize TTS Audio
    const ttsStartTime = Date.now();
    notify(35, `Sintetizando locução neural com voz ${job.parsed.voiceName || 'Francisca'}...`);
    const tempAudioPath = path.join(jobDir, 'narration.mp3');
    const totalDurationSec = await synthesizeFullAudioToFile(
      fullNarration,
      job.parsed.voiceId || 'pt-BR-FranciscaNeural',
      tempAudioPath
    );
    console.log(`[Renderer] [Job ${jobId}] [Perf] TTS concluído em ${Date.now() - ttsStartTime}ms (Duração do áudio: ${totalDurationSec.toFixed(1)}s)`);

    // 3. Resolve Media for each scene
    notify(52, 'Obtendo imagens e vídeos para as cenas...');
    const targetWidth = job.parsed.aspectRatio === '16:9' ? 1280 : 720;
    const targetHeight = job.parsed.aspectRatio === '9:16' ? 1280 : job.parsed.aspectRatio === '1:1' ? 720 : 720;

    const sceneDuration = Math.max(2.5, totalDurationSec / scenes.length);

    // If customMedia was supplied by the user via WhatsApp
    const customMedia = job.customMedia || job.parsed.customMedia;

    const sceneClipPaths: string[] = [];
    const colors = ['0x0f172a', '0x1e1b4b', '0x172554', '0x134e4a', '0x312e81', '0x18181b'];

    for (let idx = 0; idx < scenes.length; idx++) {
      const sceneStartTime = Date.now();
      const sc = scenes[idx];
      notify(55 + Math.round((idx / scenes.length) * 20), `Preparando mídia da cena ${idx + 1}/${scenes.length}...`);

      const sceneImgPath = path.join(jobDir, `scene_${idx}_raw.jpg`);
      let mediaReady = false;
      let isVideoClip = false;

      // Check if custom media applies to first scene(s)
      if (idx === 0 && customMedia && fs.existsSync(customMedia.localPath)) {
        if (customMedia.mediaType === 'video') {
          isVideoClip = true;
          fs.copyFileSync(customMedia.localPath, path.join(jobDir, `scene_${idx}_video.mp4`));
          mediaReady = true;
        } else {
          fs.copyFileSync(customMedia.localPath, sceneImgPath);
          mediaReady = true;
        }
      }

      // If not custom media, attempt downloading scene mediaUrl
      if (!mediaReady && sc.mediaUrl && (sc.mediaUrl.startsWith('http://') || sc.mediaUrl.startsWith('https://'))) {
        mediaReady = await downloadMediaToLocalFile(sc.mediaUrl, sceneImgPath);
      }

      // If still not ready, search web media (Wikimedia/Wikipedia direct URLs)
      if (!mediaReady) {
        try {
          const searchTerms = [sc.searchTag, sc.caption, title].filter(Boolean) as string[];
          const webItems = await searchRealWebMedia(searchTerms, 3);
          for (const item of webItems) {
            if (item.url && (item.url.startsWith('http://') || item.url.startsWith('https://'))) {
              mediaReady = await downloadMediaToLocalFile(item.url, sceneImgPath);
              if (mediaReady) break;
            }
          }
        } catch {}
      }

      // Fallback if no image could be downloaded: render a pristine gradient color slide
      if (!mediaReady && !isVideoClip) {
        const col = colors[idx % colors.length];
        await generateFallbackCard(sceneImgPath, targetWidth, targetHeight, col);
        mediaReady = true;
      }

      // Build individual scene video clip with FFmpeg
      const sceneClipPath = path.join(jobDir, `clip_${idx}.mp4`);

      // Subtitle filter (sanitized against quotes, newlines and emojis)
      let subtitleFilter = '';
      if (job.parsed.showSubtitles) {
        const textForSub = escapeDrawText(sc.caption || sc.narrationSegment || '');
        if (textForSub.length > 0) {
          const fontSize = job.parsed.aspectRatio === '9:16' ? 26 : 22;
          const fontArg = HAS_FONT ? `fontfile='${DEFAULT_FONT_PATH}':` : '';
          subtitleFilter = `,drawtext=${fontArg}text='${textForSub}':fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=h-140:box=1:boxcolor=black@0.65:boxborderw=8`;
        }
      }

      if (isVideoClip) {
        const rawVid = path.join(jobDir, `scene_${idx}_video.mp4`);
        const vidFilter = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black,setsar=1${subtitleFilter}`;
        const clipTimeoutMs = Math.max(90000, Math.ceil(sceneDuration * 5000));
        await runFfmpegAsync([
          '-y',
          '-i',
          rawVid,
          '-t',
          sceneDuration.toFixed(2),
          '-vf',
          vidFilter,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-threads',
          '2',
          '-pix_fmt',
          'yuv420p',
          '-r',
          '25',
          '-an',
          sceneClipPath,
        ], clipTimeoutMs);
      } else {
        // Image scene clip with scale & pad, using veryfast + stillimage for 5x speedup and bounded RAM
        const imgFilter = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black,setsar=1${subtitleFilter}`;
        const clipTimeoutMs = Math.max(90000, Math.ceil(sceneDuration * 5000));
        await runFfmpegAsync([
          '-y',
          '-loop',
          '1',
          '-i',
          sceneImgPath,
          '-t',
          sceneDuration.toFixed(2),
          '-vf',
          imgFilter,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-tune',
          'stillimage',
          '-threads',
          '2',
          '-pix_fmt',
          'yuv420p',
          '-r',
          '25',
          sceneClipPath,
        ], clipTimeoutMs);
      }

      sceneClipPaths.push(sceneClipPath);

      // Progressive cleanup: delete raw media file immediately to reclaim disk & buffer cache
      try {
        if (fs.existsSync(sceneImgPath)) fs.unlinkSync(sceneImgPath);
        const rawVid = path.join(jobDir, `scene_${idx}_video.mp4`);
        if (fs.existsSync(rawVid)) fs.unlinkSync(rawVid);
      } catch {}

      // Yield event loop between scenes so node process handles timers & keepalives cleanly
      await new Promise((r) => setImmediate(r));

      console.log(`[Renderer] [Job ${jobId}] [Perf] Cena ${idx + 1}/${scenes.length} renderizada em ${Date.now() - sceneStartTime}ms`);
    }

    // 4. Single-Pass Unification: Concat Clips + Audio Mux (speech + optional bg bed) directly to final MP4
    // Eliminates redundant intermediate all_scenes.mp4, cutting disk I/O and render time in half for long videos
    const muxStartTime = Date.now();
    notify(82, 'Masterizando áudio e unificando cenas em etapa única...');
    const concatListPath = path.join(jobDir, 'concat_list.txt');
    const concatContent = sceneClipPaths.map((p) => `file '${p}'`).join('\n');
    fs.writeFileSync(concatListPath, concatContent);

    const finalOutputPath = path.join(VIDEOS_DIR, `${jobId}.mp4`);
    const muxTimeoutMs = Math.max(180000, Math.ceil(totalDurationSec * 3000));

    if (job.parsed.enableBgMusic) {
      // Generate subtle atmospheric background bed (lavfi harmonic audio) and mix with speech in ONE pass
      const bgAudioPath = path.join(jobDir, 'bg_bed.mp3');
      try {
        await runFfmpegAsync([
          '-y',
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=130:duration=${Math.ceil(totalDurationSec + 3)}`,
          '-af',
          'volume=0.06,lowpass=f=400',
          '-c:a',
          'mp3',
          bgAudioPath,
        ], 60000);

        // Single-pass Concat + Dual Audio Mix (speech + bg music) directly to finalOutputPath
        await runFfmpegAsync([
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatListPath,
          '-i',
          tempAudioPath,
          '-i',
          bgAudioPath,
          '-filter_complex',
          '[1:a]volume=1.0[v1]; [2:a]volume=0.08[v2]; [v1][v2]amix=inputs=2:duration=first[aout]',
          '-map',
          '0:v',
          '-map',
          '[aout]',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          finalOutputPath,
        ], muxTimeoutMs);
      } catch (muxBgErr) {
        console.warn('[Renderer] Fallback para mixagem direta sem trilha de fundo:', muxBgErr);
        await runFfmpegAsync([
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatListPath,
          '-i',
          tempAudioPath,
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          finalOutputPath,
        ], muxTimeoutMs);
      }
    } else {
      // Single-pass Concat + Speech Audio Mux directly to finalOutputPath
      await runFfmpegAsync([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListPath,
        '-i',
        tempAudioPath,
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        finalOutputPath,
      ], muxTimeoutMs);
    }
    console.log(`[Renderer] [Job ${jobId}] [Perf] Concatenação e mixagem final em etapa única concluída em ${Date.now() - muxStartTime}ms`);

    if (!fs.existsSync(finalOutputPath)) {
      throw new Error('Falha ao compor o arquivo MP4 final.');
    }

    const stat = fs.statSync(finalOutputPath);
    const videoSizeBytes = stat.size;
    const safeTitle = title.slice(0, 45).replace(/[^a-zA-Z0-9_\-\s]/g, '');
    const filename = `${safeTitle.replace(/\s+/g, '_')}.mp4`;

    const totalElapsedSec = ((Date.now() - jobStartTime) / 1000).toFixed(2);
    const sizeMb = (videoSizeBytes / (1024 * 1024)).toFixed(2);
    console.log(
      `[Renderer] [Job ${jobId}] [Perf] ✅ TEMPO TOTAL DE RENDERIZAÇÃO: ${totalElapsedSec}s | Tamanho: ${sizeMb} MB | Formato: ${job.parsed.aspectRatio || '9:16'}`
    );

    notify(95, 'Vídeo MP4 renderizado com sucesso!');

    return {
      videoFilePath: finalOutputPath,
      videoSizeBytes,
      title,
      filename,
    };
  } finally {
    // Guaranteed cleanup of temporary files in jobDir even if cancelled or on error
    try {
      if (fs.existsSync(jobDir)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
      }
    } catch (cleanErr) {
      console.warn(`[Renderer] [Job ${jobId}] Aviso na limpeza de diretório temporário:`, cleanErr);
    }
  }
}
