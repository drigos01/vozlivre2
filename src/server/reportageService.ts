import * as cheerio from 'cheerio';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { ExtractedArticle, ExtractedMediaItem, ReportageScene } from '../types';

/**
 * Cleans caption text: strictly removes any "Cena X:" count, prefixes, and all quotation marks
 */
export function cleanCaptionText(text?: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/^[\s(\[{]*(cena|scene|parte|bloco|take|segmento|capítulo|capitulo)\s*#?\s*\d+\s*(?:de|\/)?\s*\d*[\s)\]:.-]*/gi, '');
  cleaned = cleaned.replace(/^[\s(\[{]*(legenda|caption|subtítulo|subtitulo|narração|narracao|texto)[\s)\]:.-]*/gi, '');
  cleaned = cleaned.replace(/^\s*\d+[\s:.-]+\s*/g, '');
  cleaned = cleaned.replace(/["'“”«»`]/g, '');
  cleaned = cleaned.replace(/^[\s(\[{]*(cena|scene|parte|bloco|take|segmento|capítulo|capitulo)\s*#?\s*\d+\s*(?:de|\/)?\s*\d*[\s)\]:.-]*/gi, '');
  cleaned = cleaned.replace(/^[\s:.-]+/, '').replace(/[\s:.-]+$/, '');
  return cleaned.trim();
}

/**
 * Deterministic fallback generator for journalistic scripts
 */
export function generateDeterministicReportage(article: ExtractedArticle): {
  headline: string;
  tickerText: string;
  leadSummary: string;
  fullNarration: string;
  scenes: ReportageScene[];
} {
  const title = (article.title || '').trim();
  const desc = (article.description || '').trim();
  const site = (article.siteName || 'Notícias').trim();
  const text = (article.text || '').trim();
  const images = Array.isArray(article.images) ? article.images : [];
  const videos = Array.isArray(article.videos) ? article.videos : [];

  const headline = `URGENTE: ${title.toUpperCase()}`;
  const ticker = `${site}: ${desc ? desc.slice(0, 100) : title}`;
  const leadSummary = desc || `Confira os principais fatos apurados sobre ${title}.`;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p: string) => p.trim())
    .filter((p: string) => p.length > 35 && !p.toLowerCase().includes('leia mais') && !p.toLowerCase().includes('assine'));

  const leadPara = paragraphs[0] || desc || title;
  const bodyPara1 = paragraphs[1] || 'As informações apuradas indicam que o assunto gerou grande repercussão e segue sob acompanhamento prioritário.';
  const bodyPara2 = paragraphs[2] || 'Especialistas e testemunhas destacam os impactos diretos do ocorrido e os desdobramentos que estão em andamento.';
  const conclPara = paragraphs[3] || 'Novos detalhes devem ser divulgados nas próximas horas, e a cobertura completa continuará sendo atualizada.';

  // Natural, fluent telejournalistic narration without robotic bracket tags
  const fullNarration = `${leadPara}. As informações foram confirmadas pelo portal ${site} e trazem detalhes importantes sobre a situação. ${bodyPara1}. ${bodyPara2}. ${conclPara}`;

  const scenes: ReportageScene[] = [];
  let sceneIndex = 0;

  // RULE: IF ARTICLE HAS VIDEOS, VIDEO IS STRICTLY PRIORITIZED OVER IMAGES!
  if (videos.length > 0) {
    const mainVid = videos[0];
    const vidThumb = mainVid.thumbnailUrl || mainVid.proxyUrl || mainVid.url;
    const secondVid = videos.length > 1 ? videos[1] : mainVid;
    const secondThumb = secondVid.thumbnailUrl || secondVid.proxyUrl || secondVid.url;
    const thirdVid = videos.length > 2 ? videos[2] : mainVid;
    const thirdThumb = thirdVid.thumbnailUrl || thirdVid.proxyUrl || thirdVid.url;

    // Scene 1: Lead (Headline) -> PRIMARY VIDEO!
    scenes.push({
      id: `scene-${Date.now()}-${++sceneIndex}`,
      index: sceneIndex - 1,
      placement: 'headline_lead',
      narrationSegment: `${leadPara}. As informações foram confirmadas pelo portal ${site}.`,
      mediaType: 'video',
      mediaUrl: mainVid.proxyUrl || mainVid.url,
      originalUrl: mainVid.url,
      thumbnailUrl: vidThumb,
      caption: `Vídeo da matéria: ${title}`,
      isMutedVideo: true,
    });

    // Scene 2: Body Facts -> STRICTLY PRIORITIZE VIDEO!
    scenes.push({
      id: `scene-${Date.now()}-${++sceneIndex}`,
      index: sceneIndex - 1,
      placement: 'body_fact',
      narrationSegment: bodyPara1,
      mediaType: 'video',
      mediaUrl: secondVid.proxyUrl || secondVid.url,
      originalUrl: secondVid.url,
      thumbnailUrl: secondThumb,
      caption: secondVid.caption || 'Registros em vídeo apurados dos acontecimentos',
      isMutedVideo: true,
    });

    // Scene 3: Climax -> HIGHLIGHT VIDEO MOMENT (Always Muted)!
    scenes.push({
      id: `scene-${Date.now()}-${++sceneIndex}`,
      index: sceneIndex - 1,
      placement: 'climax_video',
      narrationSegment: `Registros em vídeo obtidos pela reportagem mostram o momento dos acontecimentos. ${bodyPara2}`,
      mediaType: 'video',
      mediaUrl: mainVid.proxyUrl || mainVid.url,
      originalUrl: mainVid.url,
      thumbnailUrl: vidThumb,
      caption: 'Trecho em vídeo da matéria (Som Original 100% Silenciado)',
      isMutedVideo: true,
    });

    // Scene 4: Conclusion -> Concluding video moment
    scenes.push({
      id: `scene-${Date.now()}-${++sceneIndex}`,
      index: sceneIndex - 1,
      placement: 'conclusion',
      narrationSegment: conclPara,
      mediaType: 'video',
      mediaUrl: thirdVid.proxyUrl || thirdVid.url,
      originalUrl: thirdVid.url,
      thumbnailUrl: thirdThumb,
      caption: `Fonte: ${site}`,
      isMutedVideo: true,
    });
  } else {
    // When no video exists, use verified editorial news photos
    const img0 = images[0];
    const img1 = images[1] || img0;
    const img2 = images[2] || img1;
    const img3 = images[images.length - 1] || img0;

    // Scene 1: Lead Image
    scenes.push({
      id: `scene-${Date.now()}-${++sceneIndex}`,
      index: sceneIndex - 1,
      placement: 'headline_lead',
      narrationSegment: `${leadPara}. As informações foram confirmadas pelo portal ${site}.`,
      mediaType: 'image',
      mediaUrl: img0?.proxyUrl || img0?.url || '',
      originalUrl: img0?.url || '',
      thumbnailUrl: img0?.thumbnailUrl || img0?.proxyUrl || img0?.url || '',
      caption: title,
      isMutedVideo: false,
    });

    // Scene 2: Body Image 1
    scenes.push({
      id: `scene-${Date.now()}-${++sceneIndex}`,
      index: sceneIndex - 1,
      placement: 'body_fact',
      narrationSegment: bodyPara1,
      mediaType: 'image',
      mediaUrl: img1?.proxyUrl || img1?.url || '',
      originalUrl: img1?.url || '',
      thumbnailUrl: img1?.thumbnailUrl || img1?.proxyUrl || img1?.url || '',
      caption: img1?.caption || 'Detalhes apurados',
      isMutedVideo: false,
    });

    // Scene 3: Body Image 2
    scenes.push({
      id: `scene-${Date.now()}-${++sceneIndex}`,
      index: sceneIndex - 1,
      placement: 'climax_video',
      narrationSegment: `Imagens apuradas no local mostram o cenário da ocorrência. ${bodyPara2}`,
      mediaType: 'image',
      mediaUrl: img2?.proxyUrl || img2?.url || '',
      originalUrl: img2?.url || '',
      thumbnailUrl: img2?.thumbnailUrl || img2?.proxyUrl || img2?.url || '',
      caption: img2?.caption || 'Registro documental',
      isMutedVideo: false,
    });

    // Scene 4: Conclusion Image
    scenes.push({
      id: `scene-${Date.now()}-${++sceneIndex}`,
      index: sceneIndex - 1,
      placement: 'conclusion',
      narrationSegment: conclPara,
      mediaType: 'image',
      mediaUrl: img3?.proxyUrl || img3?.url || '',
      originalUrl: img3?.url || '',
      thumbnailUrl: img3?.thumbnailUrl || img3?.proxyUrl || img3?.url || '',
      caption: `Fonte: ${site}`,
      isMutedVideo: false,
    });
  }

  return {
    headline,
    tickerText: ticker,
    leadSummary,
    fullNarration,
    scenes,
  };
}

/**
 * Checks if an image is advertising, sponsor banner, logo, icon, or tracker
 */
function isAdvertisingOrJunkImage(
  rawSrc: string,
  el: any,
  $: cheerio.CheerioAPI,
  articleContainer?: cheerio.Cheerio<any>
): boolean {
  if (!rawSrc) return true;
  const lower = rawSrc.toLowerCase();

  // 1. URL pattern check for ads, banners, logos, widgets, sponsors, and trackers
  const junkPatterns = [
    'hosteg', 'sfdias', 'banner', 'publi', 'patrocin', 'anuncio', 'propaganda',
    'campanha', 'sponsor', 'partner', 'parceiro', 'apoio', 'apoiador', 'anuncie',
    'anuncie-aqui', 'anuncieaqui', 'comercial', 'apoio-cultural', 'parceria',
    'logo', 'logotipo', 'icon', 'icone', 'badge', 'button', 'btn', 'favicon',
    'whatsapp', 'telegram', 'facebook', 'instagram', 'twitter', 'tiktok',
    'pixel', 'analytics', 'tracking', 'gravatar', 'avatar', 'author', 'autor',
    'perfil', 'profile', 'user-avatar', 'wp-user-avatar',
    '1x1', 'spacer', 'blank', 'placeholder', 'transparent', 'trans',
    'taboola', 'outbrain', 'revcontent', 'teads', 'mgid', 'criteo', 'popads',
    'adsterra', 'ezoic', 'adrotate', 'advads', 'adinserter', 'code-block-',
    'ad-container', 'dfp', 'google', 'adsense', 'adsystem', 'doubleclick',
    'googleadservices', 'googlesyndication',
    'sidebar', 'widget', 'footer', 'rodape', 'header', 'cabecalho', 'menu', 'nav',
    'social-share', 'compartilhe', 'redes-sociais'
  ];
  if (junkPatterns.some((pattern) => lower.includes(pattern))) {
    return true;
  }

  // Typical ad dimensions in URL or filename (IAB standard sizes)
  if (/(?:728x90|300x250|320x50|300x600|970x250|160x600|468x60|600x400|120x600|250x250|336x280|180x150|120x240|240x400|970x90|320x100)/.test(lower)) {
    return true;
  }

  // 2. Element and Ancestor DOM check
  if (el) {
    const $el = $(el);

    // Check alt and title attributes for advertisement hints
    const alt = ($el.attr('alt') || '').toLowerCase();
    const titleAttr = ($el.attr('title') || '').toLowerCase();
    const adKeywords = [
      'publicidade', 'anúncio', 'anuncio', 'patrocínio', 'patrocinado', 'propaganda',
      'banner', 'logo', 'logotipo', 'desenvolvido por', 'hospedado por', 'parceiro',
      'apoio cultural', 'anuncie aqui', 'comercial'
    ];
    if (adKeywords.some((kw) => alt.includes(kw) || titleAttr.includes(kw))) {
      return true;
    }

    // Check explicit dimensions
    const width = parseInt($el.attr('width') || '0', 10);
    const height = parseInt($el.attr('height') || '0', 10);
    if ((width > 0 && width < 160) || (height > 0 && height < 120)) {
      return true; // Too small to be an editorial news photo
    }
    if (width > 0 && height > 0) {
      if (width / height > 2.2 || height / width > 1.6) {
        return true; // Banner ribbon or tall skyscraper ad
      }
    }

    // Check parent anchor <a>: if it links to WhatsApp, external sponsor, or ad campaign
    const parentAnchor = $el.closest('a');
    if (parentAnchor.length > 0) {
      const href = (parentAnchor.attr('href') || '').toLowerCase();
      const rel = (parentAnchor.attr('rel') || '').toLowerCase();
      if (
        href.includes('wa.me') ||
        href.includes('api.whatsapp.com') ||
        href.includes('whatsapp.com/send') ||
        href.includes('utm_medium=banner') ||
        href.includes('utm_campaign=anuncio') ||
        href.includes('anuncie') ||
        rel.includes('sponsored') ||
        rel.includes('nofollow')
      ) {
        return true;
      }
    }

    // Check ancestors up to 8 levels for advertising or widget classes/IDs
    const parentText = $el
      .parents()
      .slice(0, 8)
      .map((_, p) => ($(p).attr('class') || '') + ' ' + ($(p).attr('id') || ''))
      .get()
      .join(' ')
      .toLowerCase();

    const badParentWords = [
      'ad-', '-ad', ' ads ', 'ads-', '-ads', 'advert', 'banner', 'publi', 'patrocin',
      'anuncio', 'propaganda', 'sponsor', 'parceir', 'widget', 'sidebar', 'footer',
      'header', 'nav', 'menu', 'author', 'avatar', 'gravatar', 'hosteg', 'sfdias',
      'taboola', 'outbrain', 'revcontent', 'teads', 'social-share', 'compartilhe',
      'redes-sociais', 'anuncie', 'comercial', 'apoio-cultural'
    ];
    if (badParentWords.some((w) => parentText.includes(w))) {
      return true;
    }

    // If an article container was identified, require the image to be inside it
    if (articleContainer && articleContainer.length > 0) {
      if (articleContainer.find(el).length === 0) {
        return true; // Image belongs to sidebar, footer, or outer wrapper
      }
    }
  }

  return false;
}

/**
 * Extracts news/article content, photos, and videos from ANY webpage URL
 */
export async function extractArticleFromUrl(url: string): Promise<ExtractedArticle> {
  const parsedUrl = new URL(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  const response = await fetch(url, {
    signal: controller.signal,
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
    },
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Não foi possível carregar a página (Status ${response.status}). Verifique o link.`);
  }

  // Handle Charset Decoding (supports UTF-8 and ISO-8859-1 / Windows-1252 on regional sites)
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type') || '';
  let charset = 'utf-8';
  const matchCharset = contentType.match(/charset=([a-zA-Z0-9_-]+)/i);
  if (matchCharset && matchCharset[1]) {
    charset = matchCharset[1].toLowerCase();
  } else {
    const peek = buffer.subarray(0, 2000).toString('latin1');
    const metaMatch = peek.match(/<meta[^>]+charset=["']?([a-zA-Z0-9_-]+)/i) ||
                      peek.match(/content=["'][^"']*charset=([a-zA-Z0-9_-]+)/i);
    if (metaMatch && metaMatch[1]) {
      charset = metaMatch[1].toLowerCase();
    }
  }

  let html = '';
  try {
    const decoder = new TextDecoder(charset);
    html = decoder.decode(buffer);
  } catch {
    html = buffer.toString('utf-8');
  }

  const $ = cheerio.load(html);

  // Helper to resolve URLs
  const resolveUrl = (rawUrl?: string): string | null => {
    if (!rawUrl) return null;
    try {
      let u = rawUrl.trim();
      // Remove escaped slashes if present
      u = u.replace(/\\\//g, '/');
      if (u.startsWith('data:') || u.startsWith('blob:')) return null;
      if (u.startsWith('//')) {
        u = parsedUrl.protocol + u;
      }
      return new URL(u, url).href;
    } catch {
      return null;
    }
  };

  const extractedVideos: ExtractedMediaItem[] = [];
  const seenVideoUrls = new Set<string>();
  const extractedImages: ExtractedMediaItem[] = [];
  const seenImageUrls = new Set<string>();

  // Helper to add YouTube video with real video stream proxyUrl and separate thumbnailUrl
  const addYouTubeVideo = (ytId: string, caption?: string) => {
    if (!ytId || ytId.length !== 11) return;
    const ytWatchUrl = `https://www.youtube.com/watch?v=${ytId}`;
    if (seenVideoUrls.has(ytWatchUrl)) return;
    seenVideoUrls.add(ytWatchUrl);

    const maxresImg = `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;

    extractedVideos.push({
      id: `vid-yt-${Date.now()}-${extractedVideos.length}`,
      type: 'video',
      url: ytWatchUrl,
      proxyUrl: `/api/proxy-media?video=1&url=${encodeURIComponent(ytWatchUrl)}`,
      thumbnailUrl: maxresImg,
      caption: caption || 'Vídeo da reportagem (Áudio 100% Silenciado)',
    });

    // Keep only the cover thumbnail in images as a secondary fallback if needed
    if (!seenImageUrls.has(maxresImg)) {
      seenImageUrls.add(maxresImg);
      extractedImages.push({
        id: `img-yt-${Date.now()}-${extractedImages.length}`,
        type: 'image',
        url: maxresImg,
        proxyUrl: `/api/proxy-media?url=${encodeURIComponent(maxresImg)}`,
        caption: caption || 'Registro em vídeo da reportagem',
      });
    }
  };

  // 0. EXTRACT DIRECT MP4 / WEBM VIDEO STREAMS ACROSS ENTIRE HTML & INLINE SCRIPTS (HIGHEST PRIORITY)
  const directVideoRegex = /https?:\\?\/\\?\/[^"'\s<>\\]+\.(?:mp4|webm)(?:\?[^"'\s<>\\]*)?/gi;
  let directVidMatch: RegExpExecArray | null;
  while ((directVidMatch = directVideoRegex.exec(html)) !== null) {
    if (extractedVideos.length >= 12) break;
    const rawVidUrl = directVidMatch[0].replace(/\\\//g, '/').replace(/&amp;/gi, '&');
    const lowerVid = rawVidUrl.toLowerCase();
    if (
      lowerVid.includes('doubleclick') ||
      lowerVid.includes('googlesyndication') ||
      lowerVid.includes('adsystem') ||
      lowerVid.includes('taboola') ||
      lowerVid.includes('teads')
    ) {
      continue;
    }
    const resolvedVid = resolveUrl(rawVidUrl);
    if (resolvedVid && !seenVideoUrls.has(resolvedVid)) {
      seenVideoUrls.add(resolvedVid);
      extractedVideos.unshift({
        id: `vid-mp4-${Date.now()}-${extractedVideos.length}`,
        type: 'video',
        url: resolvedVid,
        proxyUrl: `/api/proxy-media?video=1&url=${encodeURIComponent(resolvedVid)}`,
        caption: 'Vídeo original da matéria (Áudio Silenciado)',
      });
    }
  }

  // 1. EXTRACT VIDEOS FROM JSON-LD SCHEMA.ORG
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const rawText = $(el).html() || '';
      const data = JSON.parse(rawText);
      const items = Array.isArray(data) ? data : [data];

      const processLdItem = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        const type = String(obj['@type'] || '');

        if (type.includes('Video') || obj.embedUrl || obj.contentUrl) {
          const vUrl = resolveUrl(obj.contentUrl || obj.embedUrl || obj.url);
          const vThumb = resolveUrl(obj.thumbnailUrl || (Array.isArray(obj.thumbnailUrl) ? obj.thumbnailUrl[0] : ''));
          const vName = obj.name || obj.headline || '';

          if (vUrl) {
            const ytM = vUrl.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^\s"'<>]*&)?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
            if (ytM && ytM[1]) {
              addYouTubeVideo(ytM[1], vName);
            } else if (!seenVideoUrls.has(vUrl)) {
              seenVideoUrls.add(vUrl);
              const isDirectStream = vUrl.toLowerCase().includes('.mp4') || vUrl.toLowerCase().includes('.webm');
              const newItem: ExtractedMediaItem = {
                id: `vid-ld-${Date.now()}-${extractedVideos.length}`,
                type: 'video',
                url: vUrl,
                proxyUrl: `/api/proxy-media?video=1&url=${encodeURIComponent(vUrl)}`,
                thumbnailUrl: vThumb || undefined,
                caption: vName || 'Vídeo da reportagem',
              };
              if (isDirectStream) {
                extractedVideos.unshift(newItem);
              } else {
                extractedVideos.push(newItem);
              }
              if (vThumb && !seenImageUrls.has(vThumb)) {
                seenImageUrls.add(vThumb);
                extractedImages.push({
                  id: `img-ld-thumb-${Date.now()}`,
                  type: 'image',
                  url: vThumb,
                  proxyUrl: `/api/proxy-media?url=${encodeURIComponent(vThumb)}`,
                  caption: vName || 'Quadro do vídeo da reportagem',
                });
              }
            }
          }
        }

        if (obj.video) {
          const vList = Array.isArray(obj.video) ? obj.video : [obj.video];
          vList.forEach(processLdItem);
        }
        if (Array.isArray(obj['@graph'])) {
          obj['@graph'].forEach(processLdItem);
        }
      };

      items.forEach(processLdItem);
    } catch {}
  });

  // 2. EXTRACT YOUTUBE VIDEOS VIA COMPREHENSIVE REGEX (ACROSS ENTIRE HTML AND ESCAPED JSON/SCRIPTS)
  const ytRegex = /(?:youtube(?:-nocookie)?\.com\\?\/(?:watch\?(?:[^\s"'<>]*(?:&|&amp;))?v=|embed\\?\/|v\\?\/|shorts\\?\/|live\\?\/)|youtu\.be\\?\/)([a-zA-Z0-9_-]{11})/gi;
  let ytMatch: RegExpExecArray | null;
  while ((ytMatch = ytRegex.exec(html)) !== null) {
    if (extractedVideos.length >= 12) break;
    addYouTubeVideo(ytMatch[1]);
  }

  // 3. EXTRACT VIMEO VIDEOS VIA REGEX
  const vimeoRegex = /(?:vimeo\.com\\?\/(?:video\\?\/)?|player\.vimeo\.com\\?\/video\\?\/)(\d+)/gi;
  let vimeoMatch: RegExpExecArray | null;
  while ((vimeoMatch = vimeoRegex.exec(html)) !== null) {
    if (extractedVideos.length >= 12) break;
    const vimeoId = vimeoMatch[1];
    const vimeoUrl = `https://vimeo.com/${vimeoId}`;
    if (!seenVideoUrls.has(vimeoUrl)) {
      seenVideoUrls.add(vimeoUrl);
      extractedVideos.push({
        id: `vid-vimeo-${Date.now()}-${extractedVideos.length}`,
        type: 'video',
        url: vimeoUrl,
        proxyUrl: `/api/proxy-media?url=${encodeURIComponent(vimeoUrl)}`,
        caption: 'Vídeo da reportagem (Vimeo)',
      });
    }
  }

  // 4. EXTRACT VIDEOS FROM OPENGRAPH / TWITTER META TAGS
  $('meta[property^="og:video"], meta[name^="twitter:player"]').each((_, el) => {
    const rawContent = $(el).attr('content') || $(el).attr('value');
    const resolved = resolveUrl(rawContent);
    if (!resolved || seenVideoUrls.has(resolved)) return;

    const ytM = resolved.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^\s"'<>]*&)?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
    if (ytM && ytM[1]) {
      addYouTubeVideo(ytM[1]);
    } else if (resolved.endsWith('.mp4') || resolved.endsWith('.webm') || resolved.includes('/video')) {
      seenVideoUrls.add(resolved);
      extractedVideos.push({
        id: `vid-og-${Date.now()}`,
        type: 'video',
        url: resolved,
        proxyUrl: `/api/proxy-media?url=${encodeURIComponent(resolved)}`,
        caption: 'Vídeo da reportagem',
      });
    }
  });

  // 5. EXTRACT VIDEOS FROM IFRAMES, <video>, LITE-YOUTUBE, DATA ATTRIBUTES AND EMBEDS
  $('iframe, video, [data-video-id], [data-youtube-id], [data-videoid], [videoid], lite-youtube, .wp-block-embed-youtube, .wp-block-video, a[href*="youtube.com"], a[href*="youtu.be"], a[href*="vimeo.com"]').each((idx, el) => {
    if (extractedVideos.length >= 12) return;
    const tagName = el.tagName?.toLowerCase();

    // Check data attributes for video IDs
    const directVideoId = $(el).attr('data-youtube-id') ||
                          $(el).attr('data-video-id') ||
                          $(el).attr('data-videoid') ||
                          $(el).attr('videoid') ||
                          $(el).attr('data-id');
    if (directVideoId) {
      if (directVideoId.length === 11) {
        addYouTubeVideo(directVideoId);
      } else if (/^\d+$/.test(directVideoId)) {
        // Numeric video ID (Globo, Globoplay, Vimeo)
        if (parsedUrl.hostname.includes('globo.com') || $(el).hasClass('cxm-block-video__placeholder')) {
          const globoVidUrl = `https://globoplay.globo.com/v/${directVideoId}/`;
          if (!seenVideoUrls.has(globoVidUrl)) {
            seenVideoUrls.add(globoVidUrl);
            const childImg = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || $(el).attr('data-thumbnail');
            const thumb = resolveUrl(childImg) || `https://s04.video.glbimg.com/deo/vi/00/00/${directVideoId}`;
            extractedVideos.push({
              id: `vid-globo-${directVideoId}`,
              type: 'video',
              url: globoVidUrl,
              proxyUrl: `/api/proxy-media?video=1&url=${encodeURIComponent(globoVidUrl)}`,
              thumbnailUrl: thumb,
              caption: 'Vídeo da reportagem (G1 / Globo)',
            });
            if (thumb && !seenImageUrls.has(thumb)) {
              seenImageUrls.add(thumb);
              extractedImages.unshift({
                id: `img-globo-thumb-${Date.now()}`,
                type: 'image',
                url: thumb,
                proxyUrl: `/api/proxy-media?url=${encodeURIComponent(thumb)}`,
                caption: 'Quadro em vídeo da reportagem',
              });
            }
          }
        } else {
          const vUrl = `https://vimeo.com/${directVideoId}`;
          if (!seenVideoUrls.has(vUrl)) {
            seenVideoUrls.add(vUrl);
            extractedVideos.push({
              id: `vid-vimeo-${directVideoId}`,
              type: 'video',
              url: vUrl,
              proxyUrl: `/api/proxy-media?url=${encodeURIComponent(vUrl)}`,
              caption: 'Vídeo da reportagem',
            });
          }
        }
      }
    }

    if (tagName === 'video') {
      const poster = resolveUrl($(el).attr('poster') || $(el).attr('data-poster'));
      let vSrc = $(el).attr('src') || $(el).attr('data-src');
      if (!vSrc) {
        vSrc = $(el).find('source').first().attr('src') || $(el).find('source').first().attr('data-src');
      }
      const resolved = resolveUrl(vSrc);
      if (!resolved || seenVideoUrls.has(resolved)) return;

      seenVideoUrls.add(resolved);
      extractedVideos.unshift({
        id: `vid-tag-${Date.now()}-${idx}`,
        type: 'video',
        url: resolved,
        proxyUrl: `/api/proxy-media?video=1&url=${encodeURIComponent(resolved)}`,
        thumbnailUrl: poster || undefined,
        caption: 'Trecho em vídeo da matéria (Áudio Silenciado)',
      });
      if (poster && !seenImageUrls.has(poster)) {
        seenImageUrls.add(poster);
        extractedImages.unshift({
          id: `img-poster-${Date.now()}`,
          type: 'image',
          url: poster,
          proxyUrl: `/api/proxy-media?url=${encodeURIComponent(poster)}`,
          caption: 'Quadro em vídeo da reportagem',
        });
      }
      return;
    }

    // Check src or href attributes
    const rawSrc = $(el).attr('src') ||
                   $(el).attr('data-src') ||
                   $(el).attr('data-lazy-src') ||
                   $(el).attr('href');

    if (!rawSrc) return;
    const resolved = resolveUrl(rawSrc) || rawSrc;

    // Check if it's YouTube in the iframe or link
    const ytM = resolved.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^\s"'<>]*&)?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
    if (ytM && ytM[1]) {
      addYouTubeVideo(ytM[1]);
      return;
    }

    // Vimeo
    const vimeoM = resolved.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (vimeoM && vimeoM[1]) {
      const vimeoUrl = `https://vimeo.com/${vimeoM[1]}`;
      if (!seenVideoUrls.has(vimeoUrl)) {
        seenVideoUrls.add(vimeoUrl);
        extractedVideos.push({
          id: `vid-vimeo-${Date.now()}-${idx}`,
          type: 'video',
          url: vimeoUrl,
          proxyUrl: `/api/proxy-media?url=${encodeURIComponent(resolved)}`,
          caption: 'Vídeo da reportagem',
        });
      }
      return;
    }

    // Direct MP4 / WebM
    if (resolved.endsWith('.mp4') || resolved.endsWith('.webm')) {
      if (!seenVideoUrls.has(resolved)) {
        seenVideoUrls.add(resolved);
        extractedVideos.push({
          id: `vid-direct-${Date.now()}-${idx}`,
          type: 'video',
          url: resolved,
          proxyUrl: `/api/proxy-media?url=${encodeURIComponent(resolved)}`,
          caption: 'Vídeo documental da matéria',
        });
      }
    }
  });

  // Extract Site Name
  const rawSiteName = $('meta[property="og:site_name"]').attr('content') ||
                      parsedUrl.hostname.replace(/^www\./, '') ||
                      'Notícias';
  const siteName = rawSiteName.replace(/\s*[-–|].*?$/, '').trim();

  // Extract Title (DO NOT destroy headline if it has an internal hyphen or colon!)
  let rawTitle = $('meta[property="og:title"]').attr('content') ||
                 $('meta[name="twitter:title"]').attr('content') ||
                 $('h1').first().text() ||
                 $('[itemprop="headline"]').first().text() ||
                 $('title').text() ||
                 '';
  rawTitle = rawTitle.replace(/\s+/g, ' ').trim();

  // Strip only trailing site brand at the very end of the title if present
  let title = rawTitle;
  const trailingSiteMatch = title.match(/\s*(?:[-–—|•]\s*)([^-–—|•]{2,45})$/);
  if (trailingSiteMatch) {
    const trailingPart = trailingSiteMatch[1].trim().toLowerCase();
    const cleanHost = parsedUrl.hostname.replace(/^www\./, '').split('.')[0].toLowerCase();
    const cleanSite = siteName.split('.')[0].toLowerCase();
    if (
      trailingPart.includes(cleanSite) ||
      trailingPart.includes(cleanHost) ||
      trailingPart.includes('blog') ||
      trailingPart.includes('notícia') ||
      trailingPart.includes('noticia') ||
      trailingPart.includes('portal') ||
      trailingPart.includes('jornal') ||
      trailingPart.includes('g1') ||
      trailingPart.includes('uol') ||
      trailingPart.includes('cnn') ||
      trailingPart.includes('r7')
    ) {
      title = title.slice(0, trailingSiteMatch.index).trim();
    }
  }

  // Extract Description / Lead
  let description = $('meta[property="og:description"]').attr('content') ||
                    $('meta[name="twitter:description"]').attr('content') ||
                    $('meta[name="description"]').attr('content') ||
                    $('.lead, .sub-title, .subtitle, .entry-summary, .post-excerpt, .article-subtitle, .materia-subtitulo').first().text() ||
                    '';
  description = description.replace(/\s+/g, ' ').trim();

  // Extract Author
  const author = $('meta[name="author"]').attr('content') ||
                 $('[rel="author"]').text() ||
                 $('.author, .byline, [itemprop="author"]').text() ||
                 '';

  // Extract Published Date
  const publishedDate = $('meta[property="article:published_time"]').attr('content') ||
                        $('time').attr('datetime') ||
                        $('time').text() ||
                        $('[itemprop="datePublished"]').attr('content') ||
                        '';

  // Find Main Article Content Container (Universal support for ANY website CMS)
  let articleContainer = $('article, [role="article"], [itemprop="articleBody"], .post-content, .entry-content, .article__content, .article-body, .article-content, .news-content, .materia-conteudo, .noticia-texto, .content-text, #content, .content, main');
  if (articleContainer.length === 0 || articleContainer.find('p').length < 2) {
    // Dynamically find container with most paragraph characters
    let bestEl: any = null;
    let maxChars = 0;
    $('div, section').each((_, el) => {
      const pText = $(el).children('p').text().trim();
      if (pText.length > maxChars) {
        maxChars = pText.length;
        bestEl = el;
      }
    });
    if (bestEl && maxChars > 150) {
      articleContainer = $(bestEl);
    } else {
      articleContainer = $('body');
    }
  }

  // Extract Main Text Paragraphs
  const paragraphs: string[] = [];
  articleContainer.find('p').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    if (
      text.length > 35 &&
      !lower.includes('todos os direitos reservados') &&
      !lower.includes('leia mais:') &&
      !lower.includes('leia também:') &&
      !lower.includes('clique aqui') &&
      !lower.includes('compartilhe no whatsapp') &&
      !lower.includes('inscreva-se no canal') &&
      !lower.includes('fale com a redação') &&
      !lower.includes('política de privacidade') &&
      !lower.includes('termos de uso')
    ) {
      paragraphs.push(text);
    }
  });

  let fullText = paragraphs.join('\n\n').slice(0, 15000);

  // 5. EXTRACT EDITORIAL IMAGES WITH STRICT AD & JUNK FILTERING
  // A. Verified og:image / twitter:image
  const ogImg = resolveUrl(
    $('meta[property="og:image"]').attr('content') ||
    $('meta[property="og:image:url"]').attr('content') ||
    $('meta[property="og:image:secure_url"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    $('meta[name="twitter:image:src"]').attr('content')
  );
  if (ogImg && !seenImageUrls.has(ogImg) && !isAdvertisingOrJunkImage(ogImg, null, $)) {
    seenImageUrls.add(ogImg);
    extractedImages.push({
      id: `img-og-${Date.now()}`,
      type: 'image',
      url: ogImg,
      proxyUrl: `/api/proxy-media?url=${encodeURIComponent(ogImg)}`,
      caption: title,
      alt: title,
    });
  }

  // B. Images inside the article container (strictly filtering out ads and sponsor banners)
  articleContainer.find('img, picture source').each((idx, el) => {
    if (extractedImages.length >= 20) return false;

    let src = $(el).attr('data-src') ||
              $(el).attr('data-original') ||
              $(el).attr('data-large-file') ||
              $(el).attr('data-orig-file') ||
              $(el).attr('data-lazy-src') ||
              $(el).attr('data-img') ||
              $(el).attr('src');

    // If srcset exists, pick highest resolution candidate
    const srcset = $(el).attr('srcset') || $(el).attr('data-srcset');
    if (srcset) {
      const candidates = srcset.split(',').map((s) => s.trim().split(/\s+/));
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          const wA = parseInt(a[1] || '0', 10);
          const wB = parseInt(b[1] || '0', 10);
          return wB - wA;
        });
        if (candidates[0][0]) {
          src = candidates[0][0];
        }
      }
    }

    const resolved = resolveUrl(src);
    if (!resolved || seenImageUrls.has(resolved)) return;

    // STRICT AD FILTER: Eliminate advertising, sponsor cards, hosteg, sfdias, avatars, logos
    if (isAdvertisingOrJunkImage(resolved, el, $, articleContainer)) {
      return;
    }

    seenImageUrls.add(resolved);

    const alt = $(el).attr('alt') || '';
    const figcaption = $(el).closest('figure').find('figcaption').text().trim() ||
                       $(el).siblings('.caption, figcaption, .legenda').text().trim() ||
                       alt;

    extractedImages.push({
      id: `img-content-${Date.now()}-${idx + 1}`,
      type: 'image',
      url: resolved,
      proxyUrl: `/api/proxy-media?url=${encodeURIComponent(resolved)}`,
      caption: figcaption || alt || title || undefined,
      alt: alt || undefined,
    });
  });

  // 6. Try YouTube oEmbed if video was found and text/title is sparse
  const primaryYtVideo = extractedVideos.find((v) => v.url.includes('youtube.com') || v.url.includes('youtu.be'));
  if (primaryYtVideo) {
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(primaryYtVideo.url)}&format=json`,
        { signal: AbortSignal.timeout(3500) }
      );
      if (oembedRes.ok) {
        const oembedData: any = await oembedRes.json();
        if (oembedData?.title) {
          if (!title || title.length < 15 || title.toUpperCase() === 'PROGRAMA ADILSON RIBEIRO') {
            title = oembedData.title.replace(/\s*[-–|].*?$/, '').trim() || oembedData.title;
          }
          if (!description) {
            description = `Cobertura em vídeo sobre: ${oembedData.title}`;
          }
          if (!fullText || fullText.length < 50) {
            fullText = `${oembedData.title}. Imagens e informações apuradas e documentadas em vídeo pela reportagem de ${oembedData.author_name || siteName}.`;
          }
        }
      }
    } catch {
      // Ignore oembed timeout; thumbnails already added
    }
  }

  // 7. Guarantee at least 1 editorial journalism image if page has absolutely no media
  if (extractedImages.length === 0 && extractedVideos.length === 0) {
    const fallbackEditorialImgs = [
      'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=1080&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=1080&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=1080&auto=format&fit=crop&q=80',
    ];
    fallbackEditorialImgs.forEach((fUrl, fIdx) => {
      extractedImages.push({
        id: `img-editorial-${Date.now()}-${fIdx}`,
        type: 'image',
        url: fUrl,
        proxyUrl: `/api/proxy-media?url=${encodeURIComponent(fUrl)}`,
        caption: title || 'Reportagem Especial',
        alt: title,
      });
    });
  }

  return {
    url,
    title: title || 'Reportagem Sem Título',
    description,
    siteName,
    author: author.trim(),
    publishedDate: publishedDate.trim(),
    text: fullText || description || title,
    images: extractedImages,
    videos: extractedVideos,
  };
}

/**
 * Generates a journalistic narration script and synchronized scenes with Gemini
 */
export async function generateReportageScript(
  ai: GoogleGenAI,
  article: ExtractedArticle,
  targetDurationSeconds?: number
): Promise<{
  headline: string;
  tickerText: string;
  leadSummary: string;
  fullNarration: string;
  scenes: ReportageScene[];
}> {
  const title = article.title || '';
  const description = article.description || '';
  const siteName = article.siteName || 'Notícias';
  const author = article.author || '';
  const articleText = article.text || '';
  const images = Array.isArray(article.images) ? article.images : [];
  const videos = Array.isArray(article.videos) ? article.videos : [];

  const duration = targetDurationSeconds && targetDurationSeconds >= 15 ? targetDurationSeconds : 60;
  const targetWords = Math.round((duration / 60) * 140);
  const minWords = Math.max(35, Math.round(targetWords * 0.85));
  const maxWords = Math.round(targetWords * 1.15);
  const targetScenes = Math.max(2, Math.min(8, Math.round(duration / 15)));

  const promptText = `
Você é um experiente roteirista e repórter sênior de telejornalismo (estilo Jornal Nacional, Fantástico, CNN, G1).
Sua missão é transformar a matéria jornalística a seguir em um ROTEIRO DE REPORTAGEM EM VÍDEO com narração extremamente natural, fluida, humana e cativante.

DADOS DA MATÉRIA:
Título: "${title}"
Portal / Fonte: ${siteName} ${author ? `(Por ${author})` : ''}
Subtítulo / Resumo: "${description}"
DURAÇÃO ALVO DO VÍDEO: ${duration} segundos.
Texto Principal:
"""
${articleText.slice(0, 6000)}
"""

FOTOS DISPONÍVEIS NA MATÉRIA (${images.length}):
${images.map((img, i) => `[FOTO ${i + 1}] ID: "${img.id}", Legenda: "${img.caption || img.alt || 'Imagem da matéria'}"`).join('\n')}

VÍDEOS DISPONÍVEIS NA MATÉRIA (${videos.length}):
${videos.map((vid, i) => `[VÍDEO ${i + 1}] ID: "${vid.id}", Legenda: "${vid.caption || 'Trecho em vídeo da matéria'}"`).join('\n')}

DIRETRIZES FUNDAMENTAIS PARA A NARRAÇÃO:
1. REGRA CRÍTICA DE PRIORIDADE ABSOLUTA DE VÍDEO:
   - SE HOUVER VÍDEOS DISPONÍVEIS NA MATÉRIA (${videos.length}): VOCÊ DEVE PRIORIZAR O VÍDEO EM VEZ DAS FOTOS EM TODAS AS CENAS!
   - O vídeo da matéria é o protagonista visual absoluto. Todas as cenas devem usar mediaType: "video" e referenciar prioritariamente os vídeos disponíveis.
   - As fotos só entram como recurso de apoio secundário se a matéria NÃO contiver vídeos suficientes.
   - O áudio original do vídeo da matéria é automaticamente 100% silenciado para que a voz neural da locução reine soberana com máxima clareza.
2. NARRAÇÃO 100% NATURAL, FLUIDA E ORAL:
   - Escreva exatamente como um repórter ou apresentador profissional fala ao vivo para a audiência em TV ou redes sociais (YouTube/TikTok/Reels).
   - Linguagem clara, direta, ágil e envolvente, sem jargões rebuscados nem clichês mecânicos.
   - NUNCA inclua comandos entre colchetes como "[pausa]", "[locutor]", "[efeito]" ou direções de estúdio no texto de narração. A locução deve conter apenas texto limpo.
   - Use pontuação natural (vírgulas, reticências, pontos finais) para ditar a cadência e respiração orgânica da voz neural.
   - Extensão obrigatória: entre ${minWords} e ${maxWords} palavras (ritmo perfeito para bater exatamente ${duration} segundos de vídeo).
3. MANCHETE E LETREIRO:
   - Manchete: Frase de impacto concisa para a tarja superior (máximo 7 a 9 palavras).
   - Letreiro ticker: Frase corrida objetiva para a barra de notícias na base da tela.
4. ESTRUTURAÇÃO DE CENAS:
   - Divida a narração em exatamente ${targetScenes} cenas curtas e fluidas.

Responda OBRIGATORIAMENTE em JSON válido:
{
  "headline": "MANCHETE DE IMPACTO",
  "tickerText": "Frase resumida dos acontecimentos para a barra de notícias",
  "leadSummary": "Resumo em uma frase dos principais fatos",
  "fullNarration": "Texto completo da narração natural para ser falado pela voz neural...",
  "scenes": [
    {
      "sceneNumber": 1,
      "placement": "headline_lead",
      "narrationSegment": "Trecho da narração falado nesta cena...",
      "mediaId": "ID da foto ou do vídeo",
      "mediaType": "image ou video",
      "caption": "Legenda descritiva curta da imagem/vídeo",
      "isMutedVideo": true
    }
  ]
}
`;

  let generatedJson: any = null;

  if (process.env.GEMINI_API_KEY) {
    const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
    for (const modelName of modelsToTry) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout na chamada Gemini')), 16000)
        );

        const geminiCall = ai.models.generateContent({
          model: modelName,
          contents: promptText,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.7,
            ...(modelName === 'gemini-3.8-flash' ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          },
        });

        const response: any = await Promise.race([geminiCall, timeoutPromise]);
        const raw = response.text?.trim() || '';
        if (raw) {
          try {
            generatedJson = JSON.parse(raw);
          } catch {
            const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            generatedJson = JSON.parse(clean);
          }
          if (generatedJson && generatedJson.fullNarration) {
            break;
          }
        }
      } catch {
        // Silently try next available model or fall through to deterministic script generator
      }
    }
  }

  if (!generatedJson || !generatedJson.fullNarration) {
    generatedJson = generateDeterministicReportage(article);
  }

  // Attach full media objects to scenes
  const enrichedScenes: ReportageScene[] = (generatedJson.scenes || []).map((sc: any, idx: number) => {
    let matchedMedia = images.find((img) => img.id === sc.mediaId) ||
                       videos.find((vid) => vid.id === sc.mediaId);

    if (videos.length > 0) {
      // STRICT VIDEO PRIORITIZATION: Every scene is backed by the extracted video
      if (idx === 0) {
        matchedMedia = videos[0];
      } else if (idx === 1) {
        matchedMedia = videos.length > 1 ? videos[1] : videos[0];
      } else if (idx === 2 || sc.placement === 'climax_video') {
        matchedMedia = videos.length > 2 ? videos[2] : videos[0];
      } else {
        matchedMedia = videos[idx % videos.length];
      }
    } else if (!matchedMedia && images.length > 0) {
      matchedMedia = images[idx % images.length];
    }

    // Default to the first available image or video if still unmatched
    const primaryMedia = matchedMedia || videos[0] || images[0];
    let finalMediaUrl = primaryMedia?.proxyUrl || primaryMedia?.url || '';
    let finalOriginalUrl = primaryMedia?.url || '';
    let finalThumbnailUrl = primaryMedia?.thumbnailUrl || '';

    // If it is a video, preserve the playable video proxyUrl as finalMediaUrl and keep thumbnailUrl strictly as fallback poster!
    if (primaryMedia?.type === 'video') {
      finalMediaUrl =
        primaryMedia.proxyUrl ||
        `/api/proxy-media?video=1&url=${encodeURIComponent(primaryMedia.url)}`;
      const ytMatch = (primaryMedia.url || '').match(/(?:embed\/|v\/|watch\?v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/i);
      if (ytMatch && ytMatch[1]) {
        const ytId = ytMatch[1];
        finalThumbnailUrl = primaryMedia.thumbnailUrl || `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;
      } else if (primaryMedia.thumbnailUrl) {
        finalThumbnailUrl = primaryMedia.thumbnailUrl;
      }
    } else if (!finalThumbnailUrl) {
      finalThumbnailUrl = finalMediaUrl;
    }

    return {
      id: `scene-${Date.now()}-${idx}`,
      index: idx,
      narrationSegment: sc.narrationSegment || '',
      mediaType: primaryMedia?.type || (sc.mediaType === 'video' ? 'video' : 'image'),
      mediaUrl: finalMediaUrl,
      originalUrl: finalOriginalUrl,
      thumbnailUrl: finalThumbnailUrl || undefined,
      caption: cleanCaptionText(sc.caption || primaryMedia?.caption || article.title),
      isMutedVideo: true, // Always muted as requested!
      placement: sc.placement || (idx === 0 ? 'headline_lead' : idx === (generatedJson.scenes.length - 1) ? 'conclusion' : 'body_fact'),
    };
  });

  return {
    headline: generatedJson.headline || `REPORTAGEM: ${title}`,
    tickerText: generatedJson.tickerText || `${siteName}: ${title}`,
    leadSummary: generatedJson.leadSummary || description || title,
    fullNarration: generatedJson.fullNarration,
    scenes: enrichedScenes,
  };
}
