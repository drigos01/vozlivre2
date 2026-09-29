import React, { useState, useRef } from 'react';
import JSZip from 'jszip';
import {
  Play,
  Download,
  Trash2,
  Clock,
  Volume2,
  History as HistoryIcon,
  HardDrive,
  Pencil,
  Check,
  Film,
  Upload,
  UploadCloud,
  FileAudio,
  CheckCircle,
  Filter,
  Archive,
  Loader2,
  Search,
  X,
  RotateCcw,
} from 'lucide-react';
import { GeneratedAudio } from '../types';
import { formatTime, formatBytes, downloadAudio, downloadBlob, formatFilename } from '../utils/audio';

interface HistoryListProps {
  history: GeneratedAudio[];
  onSelectAudio: (audio: GeneratedAudio) => void;
  onDeleteAudio: (id: string) => void;
  onClearHistory: () => void;
  onUpdateTitle?: (id: string, newTitle: string) => void;
  onSendToVideoEditor?: (audio: GeneratedAudio) => void;
  onUploadAudio?: (file: File) => Promise<GeneratedAudio | null>;
  onLoadTextToEditor?: (text: string, title?: string) => void;
  currentAudioId?: string;
}

export const HistoryList: React.FC<HistoryListProps> = ({
  history,
  onSelectAudio,
  onDeleteAudio,
  onClearHistory,
  onUpdateTitle,
  onSendToVideoEditor,
  onUploadAudio,
  onLoadTextToEditor,
  currentAudioId,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'uploaded' | 'generated'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);
  const [uploadSuccessName, setUploadSuccessName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startEditing = (item: GeneratedAudio) => {
    setEditingId(item.id);
    setEditTitle(item.title || '');
  };

  const saveEditing = (id: string) => {
    const trimmed = editTitle.trim();
    if (trimmed && onUpdateTitle) {
      onUpdateTitle(id, trimmed);
    }
    setEditingId(null);
  };

  const handleDownloadZip = async () => {
    if (filteredHistory.length === 0 || isZipping) return;
    setIsZipping(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < filteredHistory.length; i++) {
        const item = filteredHistory[i];
        let blob: Blob;
        if (item.blob) {
          blob = item.blob;
        } else {
          const res = await fetch(item.audioUrl);
          blob = await res.blob();
        }
        const fname = formatFilename(item.title, `audio-${item.id.slice(0, 8)}`, 'mp3');
        zip.file(fname, blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, `vozlivre-audios-${Date.now()}.zip`);
    } catch (err) {
      console.error('Failed to create ZIP:', err);
    } finally {
      setIsZipping(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadAudio) return;
    e.target.value = '';

    setIsUploading(true);
    try {
      const saved = await onUploadAudio(file);
      if (saved) {
        setUploadSuccessName(saved.title);
        setTimeout(() => setUploadSuccessName(null), 4000);
      }
    } catch (err) {
      console.error('Failed to upload audio:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const uploadedCount = history.filter(
    (h) => h.isUploaded || h.voice?.id === 'custom-upload' || h.voice?.id === 'user-upload'
  ).length;
  const generatedCount = history.length - uploadedCount;

  const filteredHistory = history.filter((item) => {
    const isUp = item.isUploaded || item.voice?.id === 'custom-upload' || item.voice?.id === 'user-upload';
    if (filterType === 'uploaded' && !isUp) return false;
    if (filterType === 'generated' && isUp) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchTitle = (item.title || '').toLowerCase().includes(q);
      const matchSnippet = (item.textSnippet || '').toLowerCase().includes(q);
      const matchVoice = (item.voice?.name || '').toLowerCase().includes(q);
      if (!matchTitle && !matchSnippet && !matchVoice) return false;
    }
    return true;
  });

  const totalDurationSeconds = filteredHistory.reduce((acc, cur) => acc + (cur.durationSeconds || 0), 0);

  if (history.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-8 sm:p-12 text-center space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mp3,audio/wav,audio/ogg,audio/m4a,audio/aac,audio/*"
          onChange={handleFileChange}
          className="hidden"
        />
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-800 text-neutral-400">
          <HistoryIcon className="h-7 w-7" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-white">
            Nenhum áudio salvo ainda
          </h3>
          <p className="text-sm text-neutral-400 max-w-md mx-auto">
            Os áudios que você sintetizar ou enviar do seu computador ficam salvos permanentemente aqui no seu navegador para você escutar, baixar e usar em vídeos a qualquer momento.
          </p>
        </div>

        {onUploadAudio && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-neutral-950 bg-white hover:bg-neutral-200 rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              <span>{isUploading ? 'Salvando áudio...' : 'Enviar Áudio do Computador (MP3/WAV)'}</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mp3,audio/wav,audio/ogg,audio/m4a,audio/aac,audio/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Success Banner */}
      {uploadSuccessName && (
        <div className="rounded-xl border border-emerald-800/80 bg-emerald-950/60 p-3.5 flex items-center justify-between text-xs text-emerald-200 shadow-md">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>
              Áudio <strong>"{uploadSuccessName}"</strong> salvo com sucesso na sua biblioteca local!
            </span>
          </div>
          <span className="text-[10px] text-emerald-400/80 font-mono">Disponível no Editor Pro</span>
        </div>
      )}

      {/* Header with Title and Upload Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-900 pb-3">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <span>Biblioteca & Histórico de Áudios</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 font-mono">
              {history.length}
            </span>
          </h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            Áudios gerados e enviados ficam armazenados localmente para reutilização instantânea.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {filteredHistory.length > 0 && (
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={isZipping}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              title="Baixar todos os áudios filtrados compactados em um único arquivo ZIP"
            >
              {isZipping ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
              ) : (
                <Archive className="h-3.5 w-3.5 text-amber-400" />
              )}
              <span>{isZipping ? 'Compactando...' : `Baixar ZIP (${filteredHistory.length})`}</span>
            </button>
          )}

          {onUploadAudio && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer shadow-sm disabled:opacity-50"
              title="Salvar um áudio do computador na biblioteca"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>{isUploading ? 'Salvando...' : 'Enviar Áudio'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClearHistory}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-400 hover:text-rose-400 hover:bg-neutral-900 border border-transparent hover:border-neutral-800 rounded-lg transition-colors cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Limpar Histórico</span>
          </button>
        </div>
      </div>

      {/* Search Bar and Total Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-neutral-900/60 p-2.5 rounded-xl border border-neutral-800">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pesquisar por título, trecho do texto ou voz..."
            className="w-full bg-neutral-950/70 border border-neutral-800 focus:border-neutral-600 rounded-lg pl-8 pr-8 py-1.5 text-xs text-white placeholder:text-neutral-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-neutral-400 px-1 shrink-0">
          <Clock className="h-3.5 w-3.5 text-neutral-400" />
          <span>Total em áudio:</span>
          <strong className="font-mono text-neutral-200">
            {formatTime(totalDurationSeconds)}
          </strong>
        </div>
      </div>

      {/* Filter Tabs if user has both uploaded and generated audios */}
      {uploadedCount > 0 && (
        <div className="flex items-center gap-1.5 border-b border-neutral-800/60 pb-2">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterType === 'all'
                ? 'bg-neutral-800 text-white font-semibold'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
            }`}
          >
            Todos ({history.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('uploaded')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterType === 'uploaded'
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
            }`}
          >
            <UploadCloud className="h-3 w-3" />
            <span>Áudios Enviados ({uploadedCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterType('generated')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterType === 'generated'
                ? 'bg-neutral-800 text-white font-semibold'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
            }`}
          >
            <Volume2 className="h-3 w-3" />
            <span>Vozes Geradas ({generatedCount})</span>
          </button>
        </div>
      )}

      {/* Audio List */}
      <div className="divide-y divide-neutral-800/80 rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
        {filteredHistory.map((item) => {
          const isCurrent = item.id === currentAudioId;
          const isEditing = editingId === item.id;
          const isUp = item.isUploaded || item.voice?.id === 'custom-upload' || item.voice?.id === 'user-upload';
          const downloadFilename = formatFilename(item.title, `audio-${item.id.slice(0, 8)}`, 'mp3');
          const dateStr = new Date(item.createdAt).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });

          return (
            <div
              key={item.id}
              className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                isCurrent ? 'bg-neutral-800/50' : 'hover:bg-neutral-900/80'
              }`}
            >
              {/* Left Info */}
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {isUp ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                      <UploadCloud className="h-3 w-3" />
                      <span>Áudio Enviado</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                      <Volume2 className="h-3 w-3 text-neutral-400" />
                      <span>Voz Neural</span>
                    </span>
                  )}

                  {isEditing ? (
                    <div className="flex items-center gap-1.5 max-w-sm">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveEditing(item.id)}
                        autoFocus
                        className="bg-neutral-800 border border-neutral-700 px-2 py-0.5 text-sm text-white rounded focus:outline-none focus:border-white"
                      />
                      <button
                        type="button"
                        onClick={() => saveEditing(item.id)}
                        className="p-1 text-white bg-neutral-700 hover:bg-neutral-600 rounded cursor-pointer"
                        title="Salvar nome"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-white truncate max-w-md">
                        {item.title || item.textSnippet || 'Áudio sem título'}
                      </span>
                      {onUpdateTitle && (
                        <button
                          type="button"
                          onClick={() => startEditing(item)}
                          className="p-1 text-neutral-500 hover:text-white rounded transition-colors cursor-pointer"
                          title="Renomear este áudio"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}

                  {isCurrent && (
                    <span className="text-[10px] text-emerald-400 font-mono">
                      (Em reprodução)
                    </span>
                  )}
                </div>

                {/* Metadata */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                  <span>{item.voice.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{item.voice.langLabel}</span>
                  {item.charCount > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{item.charCount.toLocaleString('pt-BR')} caracteres</span>
                    </>
                  )}
                  {item.durationSeconds > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-white font-medium">{formatTime(item.durationSeconds)}</span>
                    </>
                  )}
                  {item.sizeBytes && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{formatBytes(item.sizeBytes)}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-400 flex items-center gap-1 font-medium">
                    <HardDrive className="h-3 w-3" />
                    <span>Salvo no Navegador</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{dateStr}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Puxar texto de volta para o editor para novas edições */}
                {onLoadTextToEditor && (
                  <button
                    type="button"
                    onClick={() => onLoadTextToEditor(item.fullText || item.textSnippet, item.title)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-cyan-300 bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-800/80 rounded-lg transition-colors cursor-pointer shadow-sm"
                    title="Puxar o texto original deste áudio para o editor para novas edições"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Puxar Texto</span>
                  </button>
                )}

                {/* Send to VideoVozLivre */}
                {onSendToVideoEditor && (
                  <button
                    type="button"
                    onClick={() => onSendToVideoEditor(item)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-violet-950/90 hover:bg-violet-900 border border-violet-700/80 rounded-lg transition-colors cursor-pointer shadow-sm"
                    title="Usar este áudio no VideoVozLivre"
                  >
                    <Film className="h-3.5 w-3.5 text-violet-300" />
                    <span>Criar Vídeo</span>
                  </button>
                )}

                {/* Play in main player */}
                <button
                  type="button"
                  onClick={() => onSelectAudio(item)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                  title="Ouvir este áudio no player principal"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>Ouvir</span>
                </button>

                {/* Download MP3 */}
                <button
                  type="button"
                  onClick={() => downloadAudio(item, downloadFilename)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                  title={`Baixar como "${downloadFilename}"`}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Baixar</span>
                </button>

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => onDeleteAudio(item.id)}
                  className="p-1.5 text-neutral-500 hover:text-rose-400 hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                  title="Excluir da biblioteca"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

