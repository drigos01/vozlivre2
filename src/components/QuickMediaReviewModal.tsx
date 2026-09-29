import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Link as LinkIcon,
  Search,
  Upload,
  RefreshCw,
  Film,
  Image as ImageIcon,
  X,
  Check,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

export interface ReviewableSceneMedia {
  id: string;
  index: number;
  narrationSegment?: string;
  narrationText?: string;
  caption?: string;
  searchQuery?: string;
  mediaType: 'image' | 'video';
  mediaUrl: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  candidateUrls?: string[];
  visualSource?: string;
  sourceTitle?: string;
}

interface WebSearchCandidate {
  id: string;
  url: string;
  thumbUrl: string;
  title: string;
  source: string;
  type: 'image' | 'video';
}

interface QuickMediaReviewModalProps {
  isOpen: boolean;
  studioTitle: string;
  studioType?: 'roteiro' | 'reportagem';
  studioBadge?: string;
  initialScenes?: ReviewableSceneMedia[];
  scenes?: ReviewableSceneMedia[];
  extraCandidateUrls?: string[];
  extraAlternatives?: Array<{ url: string; thumbnailUrl?: string; mediaType?: 'image' | 'video'; title?: string }>;
  audioStatusText?: string;
  isAudioReady?: boolean;
  onConfirm: (updatedScenes: ReviewableSceneMedia[]) => void;
  onCancel?: () => void;
}

function toSafePreviewUrl(rawUrl: string, mediaType: 'image' | 'video'): string {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  if (
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('/api/')
  ) {
    return trimmed;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    if (mediaType === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(trimmed)) {
      return `/api/proxy-media?video=1&url=${encodeURIComponent(trimmed)}`;
    }
    return `/api/proxy-media?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

function normalizeUserLink(rawInput: string): { url: string; type: 'image' | 'video' } {
  let clean = (rawInput || '')
    .trim()
    .replace(/^[\s[\]"'<>]+|[\s[\]"'<>]+$/g, '')
    .trim();
  if (clean.toLowerCase().startsWith('www.')) {
    clean = 'https://' + clean;
  }
  try {
    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      const parsed = new URL(clean);
      const unwrapped = parsed.searchParams.get('imgurl') || parsed.searchParams.get('mediaurl');
      if (unwrapped && (unwrapped.startsWith('http://') || unwrapped.startsWith('https://'))) {
        clean = unwrapped.trim();
      }
    }
  } catch {}

  const isVideo = /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(clean);
  return { url: clean, type: isVideo ? 'video' : 'image' };
}

export const QuickMediaReviewModal: React.FC<QuickMediaReviewModalProps> = ({
  isOpen,
  studioTitle,
  studioType = 'roteiro',
  initialScenes,
  scenes: scenesProp,
  extraCandidateUrls = [],
  extraAlternatives = [],
  audioStatusText,
  isAudioReady,
  onConfirm,
  onCancel,
}) => {
  const incomingScenes = Array.isArray(initialScenes)
    ? initialScenes
    : Array.isArray(scenesProp)
    ? scenesProp
    : [];
  const mergedExtraUrls = [
    ...(Array.isArray(extraCandidateUrls) ? extraCandidateUrls : []),
    ...(Array.isArray(extraAlternatives) ? extraAlternatives.map((a) => a?.url).filter(Boolean) as string[] : []),
  ];

  const [scenes, setScenes] = useState<ReviewableSceneMedia[]>(incomingScenes);
  const [mediaStatusMap, setMediaStatusMap] = useState<Record<string, 'loading' | 'ok' | 'broken'>>({});
  const [linkInputMap, setLinkInputMap] = useState<Record<string, string>>({});
  const [activeSearchSceneId, setActiveSearchSceneId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<WebSearchCandidate[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isAutoFixing, setIsAutoFixing] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetSceneId, setUploadTargetSceneId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const safeScenes = Array.isArray(initialScenes)
        ? initialScenes
        : Array.isArray(scenesProp)
        ? scenesProp
        : [];
      setScenes(safeScenes);
      const initialStatus: Record<string, 'loading' | 'ok' | 'broken'> = {};
      safeScenes.forEach((s) => {
        if (s && s.id) {
          initialStatus[s.id] = s.mediaUrl ? 'loading' : 'broken';
        }
      });
      setMediaStatusMap(initialStatus);
      setActiveSearchSceneId(null);
      setSearchResults([]);
    }
  }, [isOpen, initialScenes, scenesProp]);

  if (!isOpen) return null;

  const safeScenesList = Array.isArray(scenes) ? scenes : [];
  const brokenCount = safeScenesList.filter((s) => mediaStatusMap[s.id] === 'broken' || !s.mediaUrl).length;

  const updateSceneMedia = (
    sceneId: string,
    newUrl: string,
    newType: 'image' | 'video',
    sourceLabel = 'Link Direto'
  ) => {
    const proxied = toSafePreviewUrl(newUrl, newType);
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              mediaUrl: proxied,
              originalUrl: newUrl,
              thumbnailUrl: newType === 'image' ? proxied : s.thumbnailUrl,
              mediaType: newType,
              visualSource: sourceLabel,
            }
          : s
      )
    );
    setMediaStatusMap((prev) => ({ ...prev, [sceneId]: 'loading' }));
  };

  const handleApplyDirectLink = (sceneId: string) => {
    const raw = (linkInputMap[sceneId] || '').trim();
    if (!raw) return;
    const { url, type } = normalizeUserLink(raw);
    if (!url) return;
    updateSceneMedia(sceneId, url, type, 'Link Personalizado');
    setLinkInputMap((prev) => ({ ...prev, [sceneId]: '' }));
  };

  const handleTryFallbackCandidate = async (scene: ReviewableSceneMedia) => {
    const allCandidates = [
      ...(Array.isArray(scene.candidateUrls) ? scene.candidateUrls : []),
      ...mergedExtraUrls,
    ].filter((u) => u && u !== scene.mediaUrl && u !== scene.originalUrl);

    if (allCandidates.length > 0) {
      const nextUrl = allCandidates[0];
      const remaining = allCandidates.slice(1);
      const { url, type } = normalizeUserLink(nextUrl);
      const proxied = toSafePreviewUrl(url, type);
      setScenes((prev) =>
        (Array.isArray(prev) ? prev : []).map((s) =>
          s.id === scene.id
            ? {
                ...s,
                mediaUrl: proxied,
                originalUrl: url,
                mediaType: type,
                candidateUrls: remaining,
                visualSource: 'Alternativa Automática',
              }
            : s
        )
      );
      setMediaStatusMap((prev) => ({ ...prev, [scene.id]: 'loading' }));
      return;
    }

    // If no local candidate left, query /api/narrative/search-media
    const spokenText = scene.narrationSegment || scene.narrationText || '';
    const query =
      scene.searchQuery ||
      scene.caption ||
      spokenText.split(/[.,!?]/)[0]?.slice(0, 50) ||
      studioTitle;
    try {
      const res = await fetch('/api/narrative/search-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (res.ok) {
        const data = await res.json();
        const items: WebSearchCandidate[] = Array.isArray(data.results) ? data.results : [];
        const valid = items.find((it) => it.url !== scene.originalUrl && it.url !== scene.mediaUrl);
        if (valid) {
          updateSceneMedia(scene.id, valid.url, valid.type || 'image', valid.source || 'Busca Web');
        }
      }
    } catch {}
  };

  const handleAutoFixAllBroken = async () => {
    setIsAutoFixing(true);
    try {
      const brokenScenes = safeScenesList.filter((s) => mediaStatusMap[s.id] === 'broken' || !s.mediaUrl);
      for (const sc of brokenScenes) {
        await handleTryFallbackCandidate(sc);
      }
    } finally {
      setIsAutoFixing(false);
    }
  };

  const handleOpenSearchForScene = (scene: ReviewableSceneMedia) => {
    setActiveSearchSceneId(scene.id);
    const spokenText = scene.narrationSegment || scene.narrationText || '';
    const defaultQ =
      scene.searchQuery ||
      scene.caption ||
      spokenText.split(/[.,!?]/)[0]?.slice(0, 45) ||
      studioTitle;
    setSearchQuery(defaultQ);
    triggerWebSearch(defaultQ);
  };

  const triggerWebSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setIsSearching(true);
    try {
      // If user pasted a direct URL in search box, show it directly as option #1
      if (/^(https?:\/\/|www\.|\[https?:\/\/)/i.test(trimmed)) {
        const { url, type } = normalizeUserLink(trimmed);
        setSearchResults([
          {
            id: `direct-${Date.now()}`,
            url,
            thumbUrl: toSafePreviewUrl(url, type),
            title: 'Link Direto Informado',
            source: 'URL Direta',
            type,
          },
        ]);
        setIsSearching(false);
        return;
      }

      const res = await fetch('/api/narrative/search-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetSceneId) return;
    const blobUrl = URL.createObjectURL(file);
    const isVid = file.type.startsWith('video/');
    updateSceneMedia(uploadTargetSceneId, blobUrl, isVid ? 'video' : 'image', 'Arquivo Local');
    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5 animate-in fade-in">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl border border-neutral-700/80 bg-neutral-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-800 bg-gradient-to-r from-neutral-900 via-neutral-900 to-amber-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-amber-500/20 text-amber-300 border border-amber-500/40">
                <Sparkles className="h-3 w-3" />
                <span>Averiguação Rápida de Imagens e Vídeos</span>
              </span>
              {brokenCount > 0 ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-950 text-rose-300 border border-rose-700">
                  <AlertTriangle className="h-3 w-3 text-rose-400" />
                  <span>{brokenCount} mídia(s) quebrada(s) detectada(s)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-700/80">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  <span>Todas as {scenes.length} mídias verificadas e prontas</span>
                </span>
              )}
            </div>

            <h2 className="text-base sm:text-lg font-black text-white truncate max-w-2xl">
              {studioTitle || (studioType === 'reportagem' ? 'Reportagem em Vídeo' : 'Vídeo Narrativo Completo')}
            </h2>
            <p className="text-xs text-neutral-400">
              Confira se as imagens e vídeos encontrados estão bons, substitua por link direto ou busque outra opção antes de renderizar o MP4.
            </p>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            {brokenCount > 0 && (
              <button
                type="button"
                onClick={handleAutoFixAllBroken}
                disabled={isAutoFixing}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-neutral-950 transition-all cursor-pointer shadow"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isAutoFixing ? 'animate-spin' : ''}`} />
                <span>Trocar Quebradas Automaticamente</span>
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                title="Fechar e continuar com as mídias atuais"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Simultaneous Audio Progress Strip */}
        {audioStatusText && (
          <div className="px-4 py-2 bg-neutral-950 border-b border-neutral-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-cyan-300 font-medium">
              <div
                className={`h-2 w-2 rounded-full ${
                  isAudioReady ? 'bg-emerald-400' : 'bg-cyan-400 animate-ping'
                }`}
              />
              <span>{audioStatusText}</span>
            </div>
            <span className="text-[11px] text-neutral-400 hidden sm:inline">
              Processamento paralelo ativo (sem perda de tempo)
            </span>
          </div>
        )}

        {/* Main Grid of Scenes + Optional Search Drawer */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Active Search Panel if opened for a scene */}
          {activeSearchSceneId && (
            <div className="rounded-xl border border-amber-500/60 bg-neutral-950 p-4 space-y-3 shadow-xl">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <Search className="h-3.5 w-3.5" />
                  <span>
                    Buscar nova imagem/vídeo para a Cena #
                    {(scenes.findIndex((s) => s.id === activeSearchSceneId) ?? 0) + 1}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setActiveSearchSceneId(null)}
                  className="text-xs text-neutral-400 hover:text-white px-2 py-0.5 rounded bg-neutral-800 cursor-pointer"
                >
                  Fechar Busca ✕
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      triggerWebSearch(searchQuery);
                    }
                  }}
                  placeholder="Digite palavras-chave ou cole um link direto https://..."
                  className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={() => triggerWebSearch(searchQuery)}
                  disabled={isSearching}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs cursor-pointer shrink-0"
                >
                  {isSearching ? 'Buscando...' : 'Pesquisar'}
                </button>
              </div>

              {searchResults.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2.5 max-h-56 overflow-y-auto pt-1">
                  {searchResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        updateSceneMedia(
                          activeSearchSceneId,
                          item.url,
                          item.type || 'image',
                          item.source || 'Busca Web'
                        );
                        setActiveSearchSceneId(null);
                      }}
                      className="group relative rounded-lg overflow-hidden border border-neutral-800 hover:border-amber-400 bg-neutral-900 text-left transition-all cursor-pointer flex flex-col"
                    >
                      <div className="h-24 w-full bg-black relative overflow-hidden">
                        <img
                          src={toSafePreviewUrl(item.thumbUrl || item.url, 'image')}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.opacity = '0.2';
                          }}
                        />
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-[9px] text-amber-300 font-bold">
                          Usar esta
                        </span>
                      </div>
                      <div className="p-1.5 text-[10px] text-neutral-300 truncate">{item.title}</div>
                    </button>
                  ))}
                </div>
              ) : (
                !isSearching && (
                  <p className="text-xs text-neutral-500">
                    Digite um termo acima e clique em Pesquisar para ver opções reais da web.
                  </p>
                )
              )}
            </div>
          )}

          {/* Scene Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {safeScenesList.map((scene, idx) => {
              const status = mediaStatusMap[scene.id] || 'loading';
              const isBroken = status === 'broken' || !scene.mediaUrl;
              const previewSrc = toSafePreviewUrl(scene.mediaUrl, scene.mediaType);
              const alternatives = [
                ...(Array.isArray(scene.candidateUrls) ? scene.candidateUrls : []),
                ...mergedExtraUrls,
              ]
                .filter((u) => u && u !== scene.mediaUrl && u !== scene.originalUrl)
                .slice(0, 4);

              return (
                <div
                  key={scene.id}
                  className={`rounded-xl border p-3.5 flex flex-col gap-3 transition-all ${
                    isBroken
                      ? 'border-rose-500/80 bg-rose-950/20'
                      : 'border-neutral-800 bg-neutral-950/80 hover:border-neutral-700'
                  }`}
                >
                  {/* Top Row: Scene Index & Status Badge */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-neutral-800 text-amber-300 font-mono text-xs font-bold">
                        Cena {idx + 1}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-neutral-400 font-medium">
                        {scene.mediaType === 'video' ? (
                          <>
                            <Film className="h-3 w-3 text-cyan-400" />
                            <span>Vídeo (Mudo)</span>
                          </>
                        ) : (
                          <>
                            <ImageIcon className="h-3 w-3 text-emerald-400" />
                            <span>Imagem</span>
                          </>
                        )}
                      </span>
                    </div>

                    {isBroken ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-900/80 text-rose-200 border border-rose-600">
                        <AlertTriangle className="h-3 w-3 text-rose-300" />
                        <span>Imagem Quebrada / Indisponível</span>
                      </span>
                    ) : status === 'ok' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                        <Check className="h-3 w-3" />
                        <span>Mídia OK</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-neutral-400 font-mono">Verificando...</span>
                    )}
                  </div>

                  {/* Media Preview Box + Narration Snippet */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                    <div className="sm:col-span-5 h-32 rounded-lg overflow-hidden bg-black border border-neutral-800 relative flex items-center justify-center">
                      {previewSrc ? (
                        scene.mediaType === 'video' ? (
                          <video
                            key={previewSrc}
                            src={previewSrc}
                            poster={scene.thumbnailUrl ? toSafePreviewUrl(scene.thumbnailUrl, 'image') : undefined}
                            muted
                            loop
                            autoPlay
                            playsInline
                            className="w-full h-full object-cover"
                            onLoadedData={() =>
                              setMediaStatusMap((prev) => ({ ...prev, [scene.id]: 'ok' }))
                            }
                            onError={() => {
                              if (scene.thumbnailUrl && scene.thumbnailUrl !== scene.mediaUrl) {
                                updateSceneMedia(scene.id, scene.thumbnailUrl, 'image', 'Quadro do Vídeo');
                              } else {
                                setMediaStatusMap((prev) => ({ ...prev, [scene.id]: 'broken' }));
                              }
                            }}
                          />
                        ) : (
                          <img
                            key={previewSrc}
                            src={previewSrc}
                            alt={`Cena ${idx + 1}`}
                            className="w-full h-full object-cover"
                            onLoad={(e) => {
                              const img = e.currentTarget;
                              if (img.naturalWidth <= 1 && img.naturalHeight <= 1) {
                                setMediaStatusMap((prev) => ({ ...prev, [scene.id]: 'broken' }));
                              } else {
                                setMediaStatusMap((prev) => ({ ...prev, [scene.id]: 'ok' }));
                              }
                            }}
                            onError={() =>
                              setMediaStatusMap((prev) => ({ ...prev, [scene.id]: 'broken' }))
                            }
                          />
                        )
                      ) : (
                        <div className="text-center p-2 text-rose-400 text-xs flex flex-col items-center gap-1">
                          <AlertTriangle className="h-5 w-5" />
                          <span>Sem mídia</span>
                        </div>
                      )}

                      {isBroken && (
                        <div className="absolute inset-0 bg-rose-950/85 flex flex-col items-center justify-center p-2 text-center gap-1.5">
                          <AlertTriangle className="h-5 w-5 text-rose-300" />
                          <span className="text-[10px] font-bold text-rose-200 leading-tight">
                            Falha ao carregar esta mídia
                          </span>
                          <button
                            type="button"
                            onClick={() => handleTryFallbackCandidate(scene)}
                            className="px-2.5 py-1 rounded bg-amber-400 hover:bg-amber-300 text-neutral-950 font-bold text-[10px] cursor-pointer shadow"
                          >
                            Substituir Agora
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="sm:col-span-7 space-y-2">
                      <p className="text-xs text-neutral-200 line-clamp-3 leading-relaxed bg-neutral-900/90 p-2 rounded-lg border border-neutral-800/80">
                        {scene.narrationSegment || scene.narrationText || scene.caption || `Cena ${idx + 1}`}
                      </p>

                      {/* Quick Action Buttons */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenSearchForScene(scene)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-amber-300 text-[11px] font-semibold transition-colors cursor-pointer border border-neutral-700"
                        >
                          <Search className="h-3 w-3" />
                          <span>Buscar Outra</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleTryFallbackCandidate(scene)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-cyan-300 text-[11px] font-semibold transition-colors cursor-pointer border border-neutral-700"
                          title="Trocar imediatamente pela próxima imagem/vídeo candidato"
                        >
                          <RefreshCw className="h-3 w-3" />
                          <span>Próxima Opção</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setUploadTargetSceneId(scene.id);
                            fileInputRef.current?.click();
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] font-semibold transition-colors cursor-pointer border border-neutral-700"
                        >
                          <Upload className="h-3 w-3" />
                          <span>Enviar Arquivo</span>
                        </button>

                        {(scene.originalUrl || scene.mediaUrl) && (
                          <a
                            href={scene.originalUrl || scene.mediaUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white text-[10px] border border-neutral-800"
                            title="Abrir link original em nova aba"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Direct Link Replacement Input */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <div className="relative flex-1">
                      <LinkIcon className="h-3 w-3 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="url"
                        value={linkInputMap[scene.id] || ''}
                        onChange={(e) =>
                          setLinkInputMap((prev) => ({ ...prev, [scene.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleApplyDirectLink(scene.id);
                          }
                        }}
                        placeholder="Cole outro link de imagem ou vídeo (https://...) para esta cena"
                        className="w-full pl-7 pr-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-[11px] text-white placeholder:text-neutral-500 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleApplyDirectLink(scene.id)}
                      disabled={!(linkInputMap[scene.id] || '').trim()}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 disabled:opacity-40 text-[11px] font-bold transition-colors cursor-pointer shrink-0"
                    >
                      Usar Link
                    </button>
                  </div>

                  {/* Mini Alternative Thumbnails if available */}
                  {alternatives.length > 0 && (
                    <div className="flex items-center gap-2 pt-1 border-t border-neutral-900">
                      <span className="text-[10px] text-neutral-500 shrink-0">Alternativas:</span>
                      <div className="flex items-center gap-1.5 overflow-x-auto">
                        {alternatives.map((altUrl, aIdx) => {
                          const { url: cleanAlt, type: altType } = normalizeUserLink(altUrl);
                          const safeThumb = toSafePreviewUrl(cleanAlt, altType);
                          return (
                            <button
                              key={aIdx}
                              type="button"
                              onClick={() =>
                                updateSceneMedia(scene.id, cleanAlt, altType, `Alternativa #${aIdx + 1}`)
                              }
                              className="h-9 w-14 rounded overflow-hidden border border-neutral-700 hover:border-amber-400 shrink-0 bg-black cursor-pointer"
                              title="Clique para trocar por esta mídia"
                            >
                              {altType === 'video' ? (
                                <video src={safeThumb} muted className="w-full h-full object-cover" />
                              ) : (
                                <img
                                  src={safeThumb}
                                  alt="Alternativa"
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="text-xs text-neutral-400 flex items-center gap-2">
            <span>
              {brokenCount > 0
                ? `⚠️ Recomendado substituir as ${brokenCount} mídia(s) sinalizada(s) antes de finalizar.`
                : '✓ Todas as imagens e vídeos foram validados sem links quebrados.'}
            </span>
          </div>

          <div className="flex items-center gap-2.5 justify-end">
            <button
              type="button"
              onClick={() => onConfirm(scenes)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-black text-xs sm:text-sm text-neutral-950 bg-gradient-to-r from-emerald-400 via-amber-300 to-amber-400 hover:from-emerald-300 hover:to-amber-300 active:scale-95 transition-all shadow-lg shadow-amber-950/40 cursor-pointer"
            >
              <CheckCircle2 className="h-4 w-4 stroke-[2.5]" />
              <span>Confirmar Mídias e Gerar Vídeo Completo</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
