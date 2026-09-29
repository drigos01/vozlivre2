import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { extractArticleFromUrl, generateReportageScript } from './reportageService';
import { generateNarrativeVideoScript, searchRealWebMedia } from './narrativeService';
import { WhatsAppVideoJob, VOICE_CATALOG } from './whatsappService';
import { ExtractedArticle } from '../types';
import { geminiKeyManager } from './geminiKeyManager';

const TEMP_BASE_DIR = path.resolve(process.cwd(), 'data', 'whatsapp', 'temp_render');
const VIDEOS_DIR = path.resolve(process.cwd(), 'data', 'whatsapp', 'videos');

for (const dir of [TEMP_BASE_DIR, VIDEOS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// FreeSansBold font path verified on Ubuntu container
const DEFAULT_FONT_PATH = '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf';
const HAS_FONT = fs.existsSync(DEFAULT_FONT_PATH);

/**
 * Escapes text for FFmpeg drawtext filter
 */
function escapeDrawText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\u2019') // Replace single quote with typographic apostrophe to avoid shell breaks
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
 * Synthesizes a chunk with MsEdgeTTS with timeout safety
 */
async function synthesizeChunkBuffer(text: string, voiceId: string): Promise<Buffer> {
  const safeVoice = voiceId || 'pt-BR-FranciscaNeural';
  const tts = new MsEdgeTTS();
  await tts.setMetadata(safeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

  return new Promise<Buffer>((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try { tts.close(); } catch {}
        reject(new Error('Timeout na síntese de voz neural (30s)'));
      }
    }, 30000);

    try {
      const { audioStream } = tts.toStream(text);
      const parts: Buffer[] = [];
      audioStream.on('data', (c: Buffer) => parts.push(c));
      audioStream.on('end', () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          try { tts.close(); } catch {}
          resolve(Buffer.concat(parts));
        }
      });
      audioStream.on('error', (err: any) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          try { tts.close(); } catch {}
          reject(err);
        }
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

/**
 * Synthesizes complete speech narration and saves to an MP3 file
 */
async function synthesizeFullAudioToFile(text: string, voiceId: string, destFilePath: string): Promise<number> {
  const chunks = chunkTextForSynthesis(text);
  const audioBuffers: Buffer[] = [];

  for (const c of chunks) {
    if (!c.trim()) continue;
    try {
      const buf = await synthesizeChunkBuffer(c, voiceId);
      if (buf && buf.length > 0) {
        audioBuffers.push(buf);
      }
    } catch (e: any) {
      console.warn('Falha em chunk TTS, tentando fallback com Francisca:', e?.message);
      try {
        const fallbackBuf = await synthesizeChunkBuffer(c, 'pt-BR-FranciscaNeural');
        if (fallbackBuf && fallbackBuf.length > 0) {
          audioBuffers.push(fallbackBuf);
        }
      } catch {}
    }
  }

  if (audioBuffers.length === 0) {
    throw new Error('Falha ao sintetizar o áudio da narração.');
  }

  const combinedAudio = Buffer.concat(audioBuffers);
  fs.writeFileSync(destFilePath, combinedAudio);

  // Measure audio duration using ffprobe
  try {
    const rawDur = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${destFilePath}"`,
      { stdio: 'pipe' }
    )
      .toString()
      .trim();
    const parsedDur = parseFloat(rawDur);
    if (!isNaN(parsedDur) && parsedDur > 0) {
      return parsedDur;
    }
  } catch (probeErr) {
    console.warn('ffprobe error measuring audio duration, using estimation:', probeErr);
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
function generateFallbackCard(destPath: string, width: number, height: number, colorHex = '0x0f172a') {
  execSync(
    `ffmpeg -y -f lavfi -i "color=c=${colorHex}:s=${width}x${height}:d=1" -vframes 1 "${destPath}"`,
    { stdio: 'pipe' }
  );
}

export interface RenderResult {
  videoBuffer: Buffer;
  videoFilePath: string;
  title: string;
  filename: string;
}

/**
 * 100% Autonomous Server-Side Video Production Engine:
 * - Extracts story/reportage
 * - Synthesizes neural voice with MsEdgeTTS
 * - Gathers scene images/videos
 * - Uses FFmpeg to render pristine MP4 video matching aspect ratio (9:16, 16:9, 1:1)
 * - Runs completely in Node.js background without requiring browser to stay open
 */
export async function renderVideoForJob(
  job: WhatsAppVideoJob,
  onProgress?: (progress: number, statusText: string) => void
): Promise<RenderResult> {
  const jobId = job.id;
  const jobDir = path.join(TEMP_BASE_DIR, jobId);
  if (!fs.existsSync(jobDir)) {
    fs.mkdirSync(jobDir, { recursive: true });
  }

  const notify = (p: number, text: string) => {
    if (onProgress) onProgress(p, text);
  };

  try {
    notify(10, 'Iniciando produção autônoma do vídeo no servidor...');

    // 1. Script Generation & Scene Breakdown
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
    } else {
      // Roteiro Criativo / História
      notify(20, 'IA estruturando roteiro cinematográfico e narrativa...');
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

    // 2. Synthesize TTS Audio
    notify(35, `Sintetizando locução neural com voz ${job.parsed.voiceName || 'Francisca'}...`);
    const tempAudioPath = path.join(jobDir, 'narration.mp3');
    const totalDurationSec = await synthesizeFullAudioToFile(
      fullNarration,
      job.parsed.voiceId || 'pt-BR-FranciscaNeural',
      tempAudioPath
    );

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

      // If still not ready, search web media (Wikimedia/Wikipedia)
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
        generateFallbackCard(sceneImgPath, targetWidth, targetHeight, col);
        mediaReady = true;
      }

      // Build individual scene video clip with FFmpeg
      const sceneClipPath = path.join(jobDir, `clip_${idx}.mp4`);

      // Subtitle filter
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
        execSync(
          `ffmpeg -y -i "${rawVid}" -t ${sceneDuration.toFixed(2)} -vf "${vidFilter}" -c:v libx264 -pix_fmt yuv420p -r 25 -an "${sceneClipPath}"`,
          { stdio: 'pipe' }
        );
      } else {
        // Image scene clip with scale & pad
        const imgFilter = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black,setsar=1${subtitleFilter}`;
        execSync(
          `ffmpeg -y -loop 1 -i "${sceneImgPath}" -t ${sceneDuration.toFixed(2)} -vf "${imgFilter}" -c:v libx264 -pix_fmt yuv420p -r 25 "${sceneClipPath}"`,
          { stdio: 'pipe' }
        );
      }

      sceneClipPaths.push(sceneClipPath);
    }

    // 4. Concatenate all scene clips
    notify(80, 'Renderizando e unificando trilha de vídeo MP4...');
    const concatListPath = path.join(jobDir, 'concat_list.txt');
    const concatContent = sceneClipPaths.map((p) => `file '${p}'`).join('\n');
    fs.writeFileSync(concatListPath, concatContent);

    const videoOnlyPath = path.join(jobDir, 'all_scenes.mp4');
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${videoOnlyPath}"`, {
      stdio: 'pipe',
    });

    // 5. Final Mux: Video + Speech Audio (+ Background Music if enabled)
    notify(88, 'Mixando locução neural e masterizando áudio...');
    const finalOutputPath = path.join(VIDEOS_DIR, `${jobId}.mp4`);

    if (job.parsed.enableBgMusic) {
      // Generate subtle atmospheric background bed (lavfi harmonic audio) and mix with speech
      const bgAudioPath = path.join(jobDir, 'bg_bed.mp3');
      try {
        execSync(
          `ffmpeg -y -f lavfi -i "sine=frequency=130:duration=${Math.ceil(totalDurationSec + 2)}" -af "volume=0.06,lowpass=f=400" -c:a mp3 "${bgAudioPath}"`,
          { stdio: 'pipe' }
        );
        execSync(
          `ffmpeg -y -i "${videoOnlyPath}" -i "${tempAudioPath}" -i "${bgAudioPath}" -filter_complex "[1:a]volume=1.0[v1]; [2:a]volume=0.08[v2]; [v1][v2]amix=inputs=2:duration=first[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "${finalOutputPath}"`,
          { stdio: 'pipe' }
        );
      } catch {
        // Fallback to pure speech muxing if complex filter fails
        execSync(
          `ffmpeg -y -i "${videoOnlyPath}" -i "${tempAudioPath}" -c:v copy -c:a aac -b:a 192k -shortest "${finalOutputPath}"`,
          { stdio: 'pipe' }
        );
      }
    } else {
      execSync(
        `ffmpeg -y -i "${videoOnlyPath}" -i "${tempAudioPath}" -c:v copy -c:a aac -b:a 192k -shortest "${finalOutputPath}"`,
        { stdio: 'pipe' }
      );
    }

    if (!fs.existsSync(finalOutputPath)) {
      throw new Error('Falha ao compor o arquivo MP4 final.');
    }

    const videoBuffer = fs.readFileSync(finalOutputPath);
    const safeTitle = title.slice(0, 45).replace(/[^a-zA-Z0-9_\-\s]/g, '');
    const filename = `${safeTitle.replace(/\s+/g, '_')}.mp4`;

    // Clean up temporary files in jobDir
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
    } catch {}

    notify(95, 'Vídeo MP4 renderizado com sucesso!');

    return {
      videoBuffer,
      videoFilePath: finalOutputPath,
      title,
      filename,
    };
  } catch (err: any) {
    // Clean up temp dir on error
    try {
      if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true });
    } catch {}
    throw err;
  }
}
