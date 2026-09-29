import React, { useRef, useState, useEffect } from 'react';
import {
  Upload,
  Clipboard,
  Trash2,
  Wand2,
  FileText,
  Clock,
  FileAudio,
  ShieldCheck,
  Mic,
  MicOff,
  BookOpen,
  Volume2,
  Plus,
  Check,
  X,
  Sparkles,
} from 'lucide-react';
import { estimateDurationSeconds, formatTime } from '../utils/audio';
import {
  getPronunciationRules,
  savePronunciationRules,
  applyPronunciation,
  PronunciationRule,
} from '../utils/pronunciation';

interface TextEditorProps {
  text: string;
  onChange: (val: string) => void;
  audioTitle?: string;
  onTitleChange?: (val: string) => void;
  maxChars?: number;
  disabled?: boolean;
  onSubmit?: () => void;
}

const SAMPLE_TEXTS = [
  {
    title: 'Exemplo: Narração / História',
    text: `Era uma manhã tranquila quando as primeiras notas de música começaram a ecoar pelo vale silencioso. [pausa 1.5s] O viajante parou à beira do caminho de pedras antigas, observando a névoa se dissipar sob a luz suave do sol. Ele sabia que aquela jornada estava apenas começando, mas cada passo dado trazia uma nova certeza de que o destino valeria todo o esforço. [pausa 1s] Com a mente serena e o coração cheio de esperança, ele respirou fundo e seguiu em frente.`,
  },
  {
    title: 'Exemplo: Artigo de Tecnologia',
    text: `A inteligência artificial transformou radicalmente a maneira como interagimos com computadores e consumimos informações. [pausa 1s] Hoje, a síntese de voz neural permite alcançar entonações humanas, pausas naturais e clareza acústica comparável a locuções profissionais de estúdio. Ferramentas abertas e gratuitas democratizam essa tecnologia, permitindo que educadores, criadores de conteúdo e pesquisadores convertam textos extensos em áudio acessível sem barreiras financeiras ou restrições de créditos.`,
  },
  {
    title: 'Exemplo: Texto Longo (3.500 caracteres)',
    text: `Capítulo 1: O Surgimento da Voz Digital.
Desde os primeiros experimentos com síntese mecânica de voz no século dezoito, a humanidade busca replicar a complexidade do aparelho fonador humano. Nos primeiros sintetizadores computacionais, as vozes soavam robóticas, monocórdicas e cansativas para o ouvinte. [pausa 1.5s] No entanto, a introdução das redes neurais profundas e dos modelos de atenção transformou completamente esse cenário.

Hoje, a conversão de texto em fala compreende o contexto gramatical, a pontuação, o ritmo da respiração e as variações sutis de ênfase que tornam uma leitura verdadeiramente natural e prazerosa. Esse avanço abre caminhos inéditos para acessibilidade digital: pessoas com deficiência visual agora têm acesso instantâneo a bibliotecas inteiras em áudio de alta fidelidade; estudantes podem revisar apostilas longas durante deslocamentos; e produtores de conteúdo podem gerar versões narradas de seus artigos em minutos.

A liberdade tecnológica é outro pilar fundamental. Por muito tempo, as melhores vozes neurais ficaram restritas a plataformas comerciais fechadas que cobravam assinaturas caras por minuto sintetizado. A proposta de ferramentas universais e ilimitadas é eliminar essas barreiras: permitir que qualquer pessoa processe textos curtos ou longos com velocidade, sem surpresas de saldo esgotado e com download direto dos arquivos gerados.

Com o processamento inteligente em blocos contínuos, até mesmo textos de milhares de caracteres são fragmentados respeitando as pausas naturais da linguagem falada. O resultado é um áudio unificado, cristalino e pronto para ser baixado nos formatos mais utilizados da indústria, como MP3 e WAV. O futuro da comunicação em áudio é acessível, livre e ilimitado.`.repeat(2),
  },
];

export const TextEditor: React.FC<TextEditorProps> = ({
  text,
  onChange,
  audioTitle,
  onTitleChange,
  maxChars = 20000,
  disabled = false,
  onSubmit,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const durationEst = estimateDurationSeconds(charCount);
  const isNearLimit = charCount > maxChars * 0.9;
  const isOverLimit = charCount > maxChars;

  // Speech Recognition (Microphone to Text) State
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);

  // Pronunciation Modal State
  const [isPronunciationModalOpen, setIsPronunciationModalOpen] = useState<boolean>(false);
  const [rules, setRules] = useState<PronunciationRule[]>([]);
  const [newOriginal, setNewOriginal] = useState<string>('');
  const [newReplacement, setNewReplacement] = useState<string>('');

  useEffect(() => {
    setRules(getPronunciationRules());
  }, []);

  const handleToggleRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Reconhecimento de voz não é suportado pelo seu navegador atual. Recomendamos o Google Chrome ou Microsoft Edge.');
      return;
    }

    if (isRecording) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsRecording(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript + ' ';
          }
        }
        if (transcript) {
          onChange((text ? text + ' ' : '') + transcript.trim());
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
      setIsRecording(false);
    }
  };

  const insertTagAtCursor = (tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(text ? `${text} ${tag}` : tag);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = text.substring(start, end);

    let insertion = tag;
    if (tag.includes('{text}')) {
      insertion = tag.replace('{text}', selectedText || 'palavra');
    }

    const newText = text.substring(0, start) + insertion + text.substring(end);
    onChange(newText);

    setTimeout(() => {
      textarea.focus();
      const newPos = start + insertion.length;
      textarea.setSelectionRange(newPos, newPos);
    }, 50);
  };

  const handlePaste = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText) {
        onChange(clipboardText);
      }
    } catch {
      // Fallback: browser permission denied
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        onChange(content.slice(0, maxChars));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const cleanTextFormatting = () => {
    if (!text) return;
    const cleaned = text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/([.!?]){3,}/g, '$1$1$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    onChange(cleaned);
  };

  const applyPhoneticsNow = () => {
    const applied = applyPronunciation(text, rules);
    onChange(applied);
    setIsPronunciationModalOpen(false);
  };

  const handleAddRule = () => {
    if (!newOriginal.trim() || !newReplacement.trim()) return;
    const newRule: PronunciationRule = {
      id: `rule-${Date.now()}`,
      original: newOriginal.trim(),
      replacement: newReplacement.trim(),
      enabled: true,
    };
    const updated = [newRule, ...rules];
    setRules(updated);
    savePronunciationRules(updated);
    setNewOriginal('');
    setNewReplacement('');
  };

  const handleToggleRule = (id: string) => {
    const updated = rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
    setRules(updated);
    savePronunciationRules(updated);
  };

  const handleDeleteRule = (id: string) => {
    const updated = rules.filter((r) => r.id !== id);
    setRules(updated);
    savePronunciationRules(updated);
  };

  return (
    <div className="space-y-2">
      {/* Editor Top Bar with Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <div className="flex items-center gap-2">
          <label htmlFor="tts-text-input" className="text-sm font-medium text-white flex items-center gap-2">
            <span>Texto para Converter</span>
            {isRecording && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800 animate-pulse">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                Gravando voz...
              </span>
            )}
          </label>
          <span className="text-xs text-neutral-400">
            (Até 20.000 caracteres por geração)
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Speech-to-Text Microphone button */}
          <button
            type="button"
            onClick={handleToggleRecognition}
            disabled={disabled}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border transition-all cursor-pointer ${
              isRecording
                ? 'bg-rose-950 text-rose-300 border-rose-700 shadow-md shadow-rose-950/50'
                : 'text-neutral-300 bg-neutral-900 border-neutral-800 hover:text-white hover:border-neutral-700'
            }`}
            title="Falar no microfone para transcrever automaticamente em texto"
          >
            {isRecording ? <MicOff className="h-3.5 w-3.5 text-rose-400 animate-pulse" /> : <Mic className="h-3.5 w-3.5 text-cyan-400" />}
            <span>{isRecording ? 'Parar Gravação' : 'Transcrever Voz (Mic)'}</span>
          </button>

          {/* Pronunciation Dictionary Modal Trigger */}
          <button
            type="button"
            onClick={() => setIsPronunciationModalOpen(true)}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-neutral-300 bg-neutral-900 border border-neutral-800 rounded-md hover:text-white hover:border-neutral-700 transition-colors cursor-pointer"
            title="Dicionário de Pronúncia Personalizada (termos em inglês, siglas, jargões)"
          >
            <BookOpen className="h-3.5 w-3.5 text-amber-400" />
            <span className="hidden sm:inline">Dicionário Fonético</span>
          </button>

          {/* Quick Samples Dropdown */}
          <div className="relative group">
            <button
              type="button"
              disabled={disabled}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-neutral-300 bg-neutral-900 border border-neutral-800 rounded-md hover:text-white hover:border-neutral-700 transition-colors disabled:opacity-50"
            >
              <FileText className="h-3.5 w-3.5 text-neutral-400" />
              <span>Exemplos</span>
            </button>
            <div className="absolute right-0 mt-1 hidden group-hover:block group-focus-within:block z-30 w-56 rounded-lg border border-neutral-800 bg-neutral-900 shadow-xl p-1">
              {SAMPLE_TEXTS.map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onChange(sample.text)}
                  className="w-full text-left px-2.5 py-1.5 text-xs text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-md transition-colors"
                >
                  {sample.title}
                </button>
              ))}
            </div>
          </div>

          {/* Paste */}
          <button
            type="button"
            onClick={handlePaste}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-neutral-300 bg-neutral-900 border border-neutral-800 rounded-md hover:text-white hover:border-neutral-700 transition-colors disabled:opacity-50"
            title="Colar texto da área de transferência"
          >
            <Clipboard className="h-3.5 w-3.5 text-neutral-400" />
            <span className="hidden sm:inline">Colar</span>
          </button>

          {/* Upload Text File */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-neutral-300 bg-neutral-900 border border-neutral-800 rounded-md hover:text-white hover:border-neutral-700 transition-colors disabled:opacity-50"
            title="Carregar arquivo .txt ou .md"
          >
            <Upload className="h-3.5 w-3.5 text-neutral-400" />
            <span className="hidden sm:inline">.txt</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.srt"
            onChange={handleFileUpload}
            className="hidden"
          />

          {/* Clean redundant spacing */}
          {text.length > 0 && (
            <button
              type="button"
              onClick={cleanTextFormatting}
              disabled={disabled}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
              title="Otimizar espaçamentos e quebras de linha"
            >
              <Wand2 className="h-3 w-3" />
              <span className="hidden sm:inline">Formatar</span>
            </button>
          )}

          {/* Clear */}
          {text.length > 0 && (
            <button
              type="button"
              onClick={() => onChange('')}
              disabled={disabled}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-neutral-400 hover:text-rose-400 transition-colors"
              title="Limpar texto"
            >
              <Trash2 className="h-3 w-3" />
              <span>Limpar</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick Pause & Expression Insert Bar */}
      <div className="flex items-center gap-1.5 flex-wrap px-3 py-1.5 bg-neutral-900/40 border border-neutral-800/80 rounded-xl text-xs text-neutral-400">
        <span className="text-[11px] font-medium text-neutral-400 flex items-center gap-1">
          <Sparkles className="h-3 w-3 text-cyan-400" />
          <span>Inserir na Fala:</span>
        </span>
        <button
          type="button"
          onClick={() => insertTagAtCursor(' [pausa 1s] ')}
          className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] transition-colors cursor-pointer"
          title="Inserir pausa de 1 segundo"
        >
          + Pausa 1s
        </button>
        <button
          type="button"
          onClick={() => insertTagAtCursor(' [pausa 2s] ')}
          className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] transition-colors cursor-pointer"
          title="Inserir pausa de 2 segundos"
        >
          + Pausa 2s
        </button>
        <button
          type="button"
          onClick={() => insertTagAtCursor(' [pausa 500ms] ')}
          className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] transition-colors cursor-pointer"
          title="Inserir pausa curta de 500ms"
        >
          + Pausa 0.5s
        </button>
        <button
          type="button"
          onClick={() => insertTagAtCursor(' [ênfase]{text}[/ênfase] ')}
          className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] transition-colors cursor-pointer"
          title="Destacar palavra com ênfase vocal forte"
        >
          + Ênfase
        </button>
        <button
          type="button"
          onClick={() => insertTagAtCursor(' [sussurro]{text}[/sussurro] ')}
          className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] transition-colors cursor-pointer"
          title="Pronunciar em tom suave / sussurro"
        >
          + Sussurro
        </button>
        <button
          type="button"
          onClick={() => insertTagAtCursor(' [rápido]{text}[/rápido] ')}
          className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] transition-colors cursor-pointer"
          title="Pronunciar com velocidade acelerada"
        >
          + Rápido
        </button>
        <button
          type="button"
          onClick={() => insertTagAtCursor(' [lento]{text}[/lento] ')}
          className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] transition-colors cursor-pointer"
          title="Pronunciar em ritmo mais lento e pausado"
        >
          + Lento
        </button>
        <button
          type="button"
          onClick={() => insertTagAtCursor(' [grave]{text}[/grave] ')}
          className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] transition-colors cursor-pointer"
          title="Pronunciar com tom mais grave e encorpado"
        >
          + Grave
        </button>
      </div>

      {/* Audio Title / File Name Input Field */}
      {onTitleChange && (
        <div className="flex items-center gap-2.5 px-3.5 py-2 bg-neutral-900/60 border border-neutral-800 rounded-xl focus-within:border-neutral-600 transition-colors">
          <FileAudio className="h-4 w-4 text-neutral-400 shrink-0" />
          <label htmlFor="audio-title-input" className="text-xs font-medium text-neutral-300 shrink-0">
            Nome do Áudio:
          </label>
          <input
            id="audio-title-input"
            type="text"
            value={audioTitle || ''}
            onChange={(e) => onTitleChange(e.target.value)}
            disabled={disabled}
            placeholder="Ex: Capítulo 1 - O Início, Roteiro Podcast, Notícia de Hoje... (Opcional)"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-neutral-500 focus:outline-none"
          />
          <span className="text-[11px] font-mono text-neutral-500 shrink-0 hidden sm:inline">
            .mp3 / .wav
          </span>
        </div>
      )}

      {/* Main Textarea */}
      <div className="relative rounded-xl border border-neutral-800 bg-neutral-900/60 focus-within:border-neutral-500 focus-within:ring-1 focus-within:ring-neutral-500 transition-all">
        <textarea
          ref={textareaRef}
          id="tts-text-input"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              if (onSubmit && !disabled) {
                onSubmit();
              }
            }
          }}
          disabled={disabled}
          placeholder="Digite ou cole aqui o texto que deseja transformar em áudio natural... Suporta textos longos de até 20.000 caracteres e marcadores como [pausa 1s], [pausa 2s] e [ênfase]."
          rows={8}
          className="w-full bg-transparent px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none resize-y leading-relaxed font-sans"
        />

        {/* Bottom Metadata & Statistics Strip */}
        <div className="flex flex-wrap items-center justify-between border-t border-neutral-800/80 px-4 py-2.5 text-xs text-neutral-400 bg-neutral-900/40 rounded-b-xl gap-2">
          {/* Audio Reading Estimate */}
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-neutral-400" />
              <span>Duração estimada:</span>
              <strong className="font-mono text-neutral-200">
                {formatTime(durationEst)}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="font-mono text-neutral-200">{wordCount}</strong> palavras
            </span>
            {text.length > 0 && (
              <>
                <span aria-hidden="true" className="hidden sm:inline">·</span>
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium" title="Rascunho protegido automaticamente contra desligamento">
                  <ShieldCheck className="h-3 w-3" />
                  <span>Salvo automaticamente</span>
                </span>
              </>
            )}
            <span aria-hidden="true" className="hidden md:inline">·</span>
            <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-mono text-neutral-400 bg-neutral-800/80 px-1.5 py-0.5 rounded border border-neutral-700/60" title="Atalho para gerar áudio imediatamente">
              Ctrl + Enter ↵ para sintetizar
            </span>
          </div>

          {/* Character Counter */}
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  isOverLimit
                    ? 'bg-rose-500'
                    : isNearLimit
                    ? 'bg-amber-400'
                    : 'bg-neutral-300'
                }`}
                style={{ width: `${Math.min(100, (charCount / maxChars) * 100)}%` }}
              />
            </div>
            <span
              className={`font-mono text-xs tabular-nums ${
                isOverLimit
                  ? 'text-rose-400 font-bold'
                  : isNearLimit
                  ? 'text-amber-400'
                  : 'text-neutral-400'
              }`}
            >
              {charCount.toLocaleString('pt-BR')} / {maxChars.toLocaleString('pt-BR')} caracteres
            </span>
          </div>
        </div>
      </div>

      {/* Pronunciation & Phonetic Rules Modal */}
      {isPronunciationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950/60">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-amber-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Dicionário de Pronúncia Personalizada</h3>
                  <p className="text-[11px] text-neutral-400">Substitui termos em inglês, siglas e jargões para pronúncia perfeita.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPronunciationModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {/* Add New Rule */}
              <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl space-y-2">
                <span className="text-xs font-semibold text-white">Adicionar Novo Termo</span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Palavra original (ex: Wi-Fi)"
                    value={newOriginal}
                    onChange={(e) => setNewOriginal(e.target.value)}
                    className="bg-neutral-900 border border-neutral-700 px-3 py-1.5 text-xs text-white rounded-lg focus:outline-none focus:border-white"
                  />
                  <input
                    type="text"
                    placeholder="Como falar (ex: uai-fai)"
                    value={newReplacement}
                    onChange={(e) => setNewReplacement(e.target.value)}
                    className="bg-neutral-900 border border-neutral-700 px-3 py-1.5 text-xs text-white rounded-lg focus:outline-none focus:border-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddRule}
                  disabled={!newOriginal.trim() || !newReplacement.trim()}
                  className="w-full py-1.5 text-xs font-bold text-neutral-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors disabled:opacity-40 cursor-pointer"
                >
                  Adicionar ao Dicionário
                </button>
              </div>

              {/* Rules List */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-neutral-400">Termos Cadastrados ({rules.length}):</span>
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-950/60 border border-neutral-800 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={() => handleToggleRule(rule.id)}
                          className="rounded accent-amber-400"
                        />
                        <span className="font-semibold text-white">{rule.original}</span>
                        <span className="text-neutral-500">→</span>
                        <span className="font-mono text-amber-300">{rule.replacement}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="text-neutral-500 hover:text-rose-400"
                        title="Remover"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-neutral-800 bg-neutral-950 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setIsPronunciationModalOpen(false)}
                className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={applyPhoneticsNow}
                className="px-4 py-1.5 text-xs font-bold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer"
              >
                Aplicar no Texto Atual
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

