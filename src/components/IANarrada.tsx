import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Volume2,
  ArrowRight,
  Copy,
  Check,
  Download,
  Trash2,
  Plus,
  Search,
  BookOpen,
  MessageSquare,
  Clock,
  ShieldCheck,
  ChevronRight,
  Sliders,
  FileText,
  Bookmark,
  BookmarkCheck,
  Send,
  Loader2,
  StopCircle,
  FileCode,
  Share2,
  RefreshCw,
  Edit2,
  PanelLeftClose,
  PanelLeft,
  X,
  Zap,
  AlertCircle,
  Film,
} from 'lucide-react';
import { IANarradaConversation, IANarradaMessage } from '../types';
import {
  getAllConversationsFromDB,
  saveConversationToDB,
  deleteConversationFromDB,
  INITIAL_SAMPLE_CONVERSATION,
} from '../utils/iaNarradaStore';
import { ReportagemVideoStudio } from './ReportagemVideoStudio';
import { RoteiroCriativoVideoStudio } from './RoteiroCriativoVideoStudio';
import { WhatsAppVideoBot } from './WhatsAppVideoBot';
import { AudioTask, VideoTask } from '../types';

interface IANarradaProps {
  onTransferToVoice: (text: string, title?: string) => void;
  onTransferToVideo?: (audio: any) => void;
  initialVoice?: any;
  onAddAudioTask?: (task: AudioTask) => void;
  onUpdateAudioTask?: (id: string, updates: Partial<AudioTask>) => void;
  onAddVideoTask?: (task: VideoTask) => void;
  onUpdateVideoTask?: (id: string, updates: Partial<VideoTask>) => void;
  onOpenTaskManager?: () => void;
  resumeTaskId?: string | null;
  onResumeHandled?: () => void;
  requestedStudioMode?: 'reportagem' | 'escrita' | 'whatsapp' | null;
  onStudioModeHandled?: () => void;
}

const PRESET_TEMPLATES = [
  {
    label: '📖 Conto de Mistério',
    category: 'conto',
    prompt: 'Escreva um conto de suspense e mistério sobre uma pequena vila costeira onde o mar começa a sussurrar os segredos dos pescadores durante a maré alta. Desenvolva personagens cativantes e uma reviravolta no desfecho.',
  },
  {
    label: '🎙️ Roteiro para Locução',
    category: 'roteiro',
    prompt: 'Crie um roteiro dinâmico para narração de vídeo de 3 minutos sobre "A Fascinante Exploração das Luas de Júpiter". Use frases de impacto, pausas para respiração e linguagem convidativa.',
  },
  {
    label: '🌌 Ficção Científica Épica',
    category: 'conto',
    prompt: 'Crie uma história de ficção científica profunda e detalhada sobre a última nave estelar humana chegando a um planeta habitável onde a gravidade altera a passagem do tempo.',
  },
  {
    label: '🌿 Narrativa de Sono / Calma',
    category: 'conto',
    prompt: 'Escreva uma narrativa reconfortante e poética para relaxamento e sono, descrevendo uma caminhada tranquila por uma floresta de bambus sob uma chuva suave de verão.',
  },
  {
    label: '📰 Crônica Histórica',
    category: 'artigo',
    prompt: 'Escreva uma crônica narrativa envolvente sobre a construção das grandes catedrais medievais e o trabalho anônimo dos artesãos de pedra.',
  },
  {
    label: '🎧 Script de Podcast',
    category: 'roteiro',
    prompt: 'Escreva uma introdução e primeiro bloco de podcast instigante sobre os maiores mistérios arqueológicos ainda não decifrados pela humanidade.',
  },
];

export const IANarrada: React.FC<IANarradaProps> = ({
  onTransferToVoice,
  onTransferToVideo,
  initialVoice,
  onAddAudioTask,
  onUpdateAudioTask,
  onAddVideoTask,
  onUpdateVideoTask,
  onOpenTaskManager,
  resumeTaskId,
  onResumeHandled,
  requestedStudioMode,
  onStudioModeHandled,
}) => {
  // Main Studio Mode: 'reportagem' (Notícia para Vídeo) | 'escrita' (Roteiro Criativo) | 'whatsapp' (Automação WhatsApp)
  const [studioMode, setStudioMode] = useState<'reportagem' | 'escrita' | 'whatsapp'>('reportagem');

  useEffect(() => {
    if (requestedStudioMode) {
      setStudioMode(requestedStudioMode);
      if (onStudioModeHandled) onStudioModeHandled();
    }
  }, [requestedStudioMode]);

  useEffect(() => {
    if (resumeTaskId) {
      if (resumeTaskId.startsWith('nar-')) {
        setStudioMode('escrita');
      } else if (resumeTaskId.startsWith('rep-')) {
        setStudioMode('reportagem');
      }
    }
  }, [resumeTaskId]);

  // Conversations State
  const [conversations, setConversations] = useState<IANarradaConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  // Generation Controls State
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [lengthOption, setLengthOption] = useState<'short' | 'medium' | 'long' | 'epic'>('long');
  const [category, setCategory] = useState<string>('conto');
  const [includeVoiceTags, setIncludeVoiceTags] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [transferFeedback, setTransferFeedback] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const [editedTitle, setEditedTitle] = useState<string>('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<{ prompt: string; message: string } | null>(null);
  const [selectedEngine, setSelectedEngine] = useState<'auto' | 'gemma' | 'gemini'>('auto');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load conversations from local database on mount & prune any corrupted/empty messages
  useEffect(() => {
    getAllConversationsFromDB().then((items) => {
      const cleaned = items.map((conv) => {
        const validMessages = conv.messages.filter(
          (m) => m.content && m.content.trim().length > 0 && !m.content.startsWith('Desculpe, ocorreu uma instabilidade')
        );
        if (validMessages.length !== conv.messages.length) {
          const updatedConv = { ...conv, messages: validMessages };
          saveConversationToDB(updatedConv);
          return updatedConv;
        }
        return conv;
      });
      setConversations(cleaned);
      if (cleaned.length > 0) {
        setActiveConvId(cleaned[0].id);
      }
    });
  }, []);

  const activeConversation = conversations.find((c) => c.id === activeConvId) || conversations[0];

  useEffect(() => {
    if (activeConversation) {
      setEditedTitle(activeConversation.title);
      // Restore this chat's specific voice tags preference (defaulting to true if not explicitly false)
      setIncludeVoiceTags(activeConversation.includeVoiceTags !== false);
    }
  }, [activeConvId]);

  // Handle toggling voice tags and persist per chat
  const handleToggleIncludeVoiceTags = (checked: boolean) => {
    setIncludeVoiceTags(checked);
    if (activeConversation) {
      const updated = {
        ...activeConversation,
        includeVoiceTags: checked,
        updatedAt: Date.now(),
      };
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      saveConversationToDB(updated);
    }
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeConversation?.messages?.length, isGenerating]);

  // Handle New Conversation
  const handleCreateNewConversation = () => {
    const newConv: IANarradaConversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: 'Nova Narrativa',
      category: 'Geral',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      isFavorite: false,
      includeVoiceTags: true,
    };

    const updated = [newConv, ...conversations];
    setConversations(updated);
    setActiveConvId(newConv.id);
    saveConversationToDB(newConv);
    setInputPrompt('');
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  // Handle Save Edited Title
  const handleSaveTitle = () => {
    if (!activeConversation || !editedTitle.trim()) {
      setIsEditingTitle(false);
      return;
    }

    const updatedConv = {
      ...activeConversation,
      title: editedTitle.trim(),
      updatedAt: Date.now(),
    };

    const updatedList = conversations.map((c) => (c.id === updatedConv.id ? updatedConv : c));
    setConversations(updatedList);
    saveConversationToDB(updatedConv);
    setIsEditingTitle(false);
  };

  // Handle Delete Conversation
  const handleDeleteConversation = async (id: string) => {
    await deleteConversationFromDB(id);
    const filtered = conversations.filter((c) => c.id !== id);
    setConversations(filtered);
    setDeleteConfirmId(null);

    if (activeConvId === id) {
      if (filtered.length > 0) {
        setActiveConvId(filtered[0].id);
      } else {
        handleCreateNewConversation();
      }
    }
  };

  // Handle Toggle Favorite
  const handleToggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = conversations.map((c) =>
      c.id === id ? { ...c, isFavorite: !c.isFavorite, updatedAt: Date.now() } : c
    );
    setConversations(updated);
    const target = updated.find((c) => c.id === id);
    if (target) {
      saveConversationToDB(target);
    }
  };

  // Handle Export Conversation (.txt or .md)
  const handleExportConversation = (conv: IANarradaConversation, format: 'txt' | 'md') => {
    let content = `# ${conv.title}\n\n`;
    content += `Data: ${new Date(conv.createdAt).toLocaleString('pt-BR')}\n`;
    content += `Categoria: ${conv.category || 'Geral'}\n`;
    content += `========================================\n\n`;

    conv.messages.forEach((msg, idx) => {
      content += `[${msg.role === 'user' ? 'USUÁRIO' : 'IA NARRADA'}] - ${new Date(msg.createdAt).toLocaleTimeString('pt-BR')}\n`;
      content += `${msg.content}\n\n`;
      content += `----------------------------------------\n\n`;
    });

    const blob = new Blob([content], { type: format === 'md' ? 'text/markdown' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conv.title.toLowerCase().replace(/[^a-z0-9]/gi, '_')}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Handle Copy text
  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Handle Pull / Transfer to Natural Voice Converter
  const handlePullToVoice = (text: string, title?: string) => {
    onTransferToVoice(text, title || activeConversation?.title);
    setTransferFeedback('Texto transferido com sucesso para a aba de Voz Natural!');
    setTimeout(() => setTransferFeedback(null), 3500);
  };

  // Handle Generate Message
  const handleGenerate = async (customPrompt?: string, overrideEngine?: 'auto' | 'gemma' | 'gemini') => {
    const textToSend = (customPrompt || inputPrompt).trim();
    if (!textToSend || isGenerating) return;

    setGenerationError(null);

    // If active conversation is missing, create a new one immediately
    let targetConv = activeConversation;
    if (!targetConv) {
      const newConv: IANarradaConversation = {
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: textToSend.slice(0, 45).replace(/\n/g, ' ') + (textToSend.length > 45 ? '...' : ''),
        category: category === 'conto' ? 'Conto & Ficção' : category === 'roteiro' ? 'Roteiro' : 'Narrativa',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        isFavorite: false,
      };
      targetConv = newConv;
      setActiveConvId(newConv.id);
    }

    // Check if the last message in this conversation was already this exact user prompt
    const lastMsg = targetConv.messages[targetConv.messages.length - 1];
    const isRetryOfLastUserMsg = lastMsg && lastMsg.role === 'user' && lastMsg.content === textToSend;

    let baseMessages = targetConv.messages.filter(
      (m) => m.content && m.content.trim().length > 0 && !m.content.startsWith('Desculpe, ocorreu uma instabilidade')
    );

    if (!isRetryOfLastUserMsg) {
      const userMsgId = `msg-u-${Date.now()}`;
      const userMessage: IANarradaMessage = {
        id: userMsgId,
        role: 'user',
        content: textToSend,
        createdAt: Date.now(),
        charCount: textToSend.length,
        wordCount: textToSend.split(/\s+/).length,
      };
      baseMessages = [...baseMessages, userMessage];
    }

    // Auto-update conversation title from user message if default or empty
    let updatedTitle = targetConv.title;
    if (targetConv.messages.length <= 1 || targetConv.title === 'Nova Narrativa') {
      updatedTitle = textToSend.slice(0, 45).replace(/\n/g, ' ') + (textToSend.length > 45 ? '...' : '');
    }

    const updatedConversation: IANarradaConversation = {
      ...targetConv,
      title: updatedTitle,
      category: category === 'conto' ? 'Conto & Ficção' : category === 'roteiro' ? 'Roteiro' : 'Narrativa',
      messages: baseMessages,
      includeVoiceTags,
      updatedAt: Date.now(),
    };

    // Update conversation in memory & store
    const newConvList = conversations.some((c) => c.id === updatedConversation.id)
      ? conversations.map((c) => (c.id === updatedConversation.id ? updatedConversation : c))
      : [updatedConversation, ...conversations];
    setConversations(newConvList);
    saveConversationToDB(updatedConversation);

    if (!customPrompt) {
      setInputPrompt('');
    }
    setIsGenerating(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const assistantMsgId = `msg-a-${Date.now()}`;
    let accumulatedContent = '';

    // History payload should only be prior messages (exclude the current user prompt)
    const priorMessages = baseMessages.slice(0, -1);
    const historyPayload = priorMessages
      .filter((m) => m.content && m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('/api/ia-narrada/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          prompt: textToSend,
          history: historyPayload,
          category,
          lengthOption,
          includeVoiceTags,
          preferredEngine: overrideEngine || selectedEngine,
        }),
      });

      if (!res.ok) {
        throw new Error(`Falha no servidor de IA (HTTP ${res.status}).`);
      }

      if (!res.body) {
        throw new Error('Fluxo de dados vazio.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let isDone = false;

      while (!isDone) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith(':')) {
            // SSE comment / keepalive ping, safely ignore
            continue;
          }
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') {
              isDone = true;
              break;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (parsed.text) {
                accumulatedContent += parsed.text;

                // Update UI in real-time with non-empty content
                const currentAssistantMsg: IANarradaMessage = {
                  id: assistantMsgId,
                  role: 'assistant',
                  content: accumulatedContent,
                  createdAt: Date.now(),
                  charCount: accumulatedContent.length,
                  wordCount: accumulatedContent.trim().split(/\s+/).length,
                };

                const liveConversation: IANarradaConversation = {
                  ...updatedConversation,
                  messages: [...baseMessages, currentAssistantMsg],
                  updatedAt: Date.now(),
                };

                setConversations((prev) =>
                  prev.map((c) => (c.id === liveConversation.id ? liveConversation : c))
                );
              }
            } catch (jsonErr: any) {
              if (jsonErr.message && !jsonErr.message.includes('JSON')) {
                throw jsonErr;
              }
            }
          }
        }
      }

      if (isDone) {
        try {
          await reader.cancel();
        } catch {}
      }

      // Flush any remaining buffer line if present
      if (buffer.trim()) {
        const remainingLines = buffer.split('\n');
        for (const line of remainingLines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            if (dataStr !== '[DONE]') {
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.text) {
                  accumulatedContent += parsed.text;
                }
              } catch {}
            }
          }
        }
      }

      // Check if any text was actually received
      if (!accumulatedContent.trim()) {
        throw new Error('A transmissão em fluxo não retornou texto.');
      }

      // Final save when stream completes successfully
      const finalAssistantMsg: IANarradaMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: accumulatedContent,
        createdAt: Date.now(),
        charCount: accumulatedContent.length,
        wordCount: accumulatedContent.trim().split(/\s+/).length,
      };

      const finalConv: IANarradaConversation = {
        ...updatedConversation,
        messages: [...baseMessages, finalAssistantMsg],
        includeVoiceTags,
        updatedAt: Date.now(),
      };

      setConversations((prev) => prev.map((c) => (c.id === finalConv.id ? finalConv : c)));
      saveConversationToDB(finalConv);
      setGenerationError(null);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Streaming error or empty content, executing immediate direct fallback:', err?.message);

        // Immediate fallback: standard POST request
        let fallbackSuccess = false;
        try {
          const fallbackRes = await fetch('/api/ia-narrada/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: textToSend,
              history: historyPayload,
              category,
              lengthOption,
              includeVoiceTags,
              preferredEngine: overrideEngine || selectedEngine,
            }),
          });

          const rawText = await fallbackRes.text();
          let data: any = null;
          try {
            data = JSON.parse(rawText);
          } catch {
            console.warn('Fallback response was not JSON:', rawText.slice(0, 100));
          }

          if (fallbackRes.ok && data?.text && data.text.trim()) {
            fallbackSuccess = true;
            const fallbackMsg: IANarradaMessage = {
              id: assistantMsgId,
              role: 'assistant',
              content: data.text.trim(),
              createdAt: Date.now(),
              charCount: data.text.trim().length,
              wordCount: data.text.trim().split(/\s+/).length,
            };

            const fallbackConv: IANarradaConversation = {
              ...updatedConversation,
              messages: [...baseMessages, fallbackMsg],
              includeVoiceTags,
              updatedAt: Date.now(),
            };

            setConversations((prev) => prev.map((c) => (c.id === fallbackConv.id ? fallbackConv : c)));
            saveConversationToDB(fallbackConv);
            setGenerationError(null);
          } else {
            const errMessage = data?.error || 'Os servidores de IA estão com alta demanda temporária. Tente novamente.';
            setGenerationError({
              prompt: textToSend,
              message: errMessage,
            });
          }
        } catch (fbErr: any) {
          console.warn('Direct fallback request failed:', fbErr?.message || fbErr);
          setGenerationError({
            prompt: textToSend,
            message: 'Instabilidade temporária nos servidores da IA. Tente novamente em instantes.',
          });
        }

        if (!fallbackSuccess) {
          // If we accumulated significant text before the drop, preserve it!
          if (accumulatedContent.trim().length > 30) {
            const partialMsg: IANarradaMessage = {
              id: assistantMsgId,
              role: 'assistant',
              content: accumulatedContent.trim(),
              createdAt: Date.now(),
              charCount: accumulatedContent.trim().length,
              wordCount: accumulatedContent.trim().split(/\s+/).length,
            };
            const partialConv = {
              ...updatedConversation,
              messages: [...baseMessages, partialMsg],
              updatedAt: Date.now(),
            };
            setConversations((prev) => prev.map((c) => (c.id === partialConv.id ? partialConv : c)));
            saveConversationToDB(partialConv);
          } else {
            const revertedConv = {
              ...updatedConversation,
              messages: baseMessages,
            };
            setConversations((prev) => prev.map((c) => (c.id === revertedConv.id ? revertedConv : c)));
            saveConversationToDB(revertedConv);
          }

          setGenerationError({
            prompt: textToSend,
            message: err?.message || 'Houve uma oscilação na rede ao entregar o texto. Clique no botão abaixo para tentar novamente.',
          });
        }
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  // Stop Generation
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
    }
  };

  // Filter conversations
  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Toast Notification for Transfer */}
      {transferFeedback && (
        <div className="fixed top-20 right-6 z-50 rounded-xl bg-emerald-950 border border-emerald-700/80 px-4 py-3 shadow-2xl flex items-center gap-3 text-emerald-200 animate-in slide-in-from-top-3 duration-200">
          <Check className="h-5 w-5 text-emerald-400 shrink-0" />
          <span className="text-xs sm:text-sm font-medium">{transferFeedback}</span>
        </div>
      )}

      {/* Hero Header & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <span>IA Narrada</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
                100% Free
              </span>
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-neutral-400 mt-1 max-w-2xl">
            Converta matérias e reportagens da web em vídeos com fotos, trechos de vídeos e voz neural, ou crie histórias e roteiros detalhados.
          </p>
        </div>

        {/* Studio Mode Toggle (Reportagem vs Escrita Criativa) */}
        <div className="flex items-center gap-1.5 bg-neutral-900/90 p-1 rounded-xl border border-neutral-800 shrink-0">
          <button
            type="button"
            onClick={() => setStudioMode('reportagem')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              studioMode === 'reportagem'
                ? 'bg-red-600 text-white shadow-md shadow-red-950/50'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Film className="h-3.5 w-3.5 text-amber-300" />
            <span>Matéria para Vídeo</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-red-950 text-red-300 border border-red-800 font-extrabold uppercase">
              NOVO
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStudioMode('escrita')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              studioMode === 'escrita'
                ? 'bg-white text-neutral-950 shadow-md'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            <span>Roteiro Criativo</span>
          </button>

          <button
            type="button"
            onClick={() => setStudioMode('whatsapp')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              studioMode === 'whatsapp'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5 text-emerald-300" />
            <span>WhatsApp</span>
          </button>

          {studioMode === 'escrita' && (
            <button
              type="button"
              onClick={handleCreateNewConversation}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-all ml-1 cursor-pointer"
              title="Nova narrativa"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Novo</span>
            </button>
          )}
        </div>
      </div>

      {/* Keep both Studio Modes mounted so background queues and preloaded bitmaps never unmount */}
      <div className={studioMode === 'reportagem' ? 'block' : 'hidden'}>
        <ReportagemVideoStudio
          onTransferToVoice={onTransferToVoice}
          onTransferToVideo={onTransferToVideo}
          initialVoice={initialVoice}
          onAddAudioTask={onAddAudioTask}
          onUpdateAudioTask={onUpdateAudioTask}
          onAddVideoTask={onAddVideoTask}
          onUpdateVideoTask={onUpdateVideoTask}
          onOpenTaskManager={onOpenTaskManager}
          resumeTaskId={resumeTaskId?.startsWith('rep-') ? resumeTaskId : null}
          onResumeHandled={onResumeHandled}
        />
      </div>
      <div className={studioMode === 'escrita' ? 'block' : 'hidden'}>
        <RoteiroCriativoVideoStudio
          onTransferToVoice={onTransferToVoice}
          onTransferToVideo={onTransferToVideo}
          initialVoice={initialVoice}
          onAddAudioTask={onAddAudioTask}
          onUpdateAudioTask={onUpdateAudioTask}
          onAddVideoTask={onAddVideoTask}
          onUpdateVideoTask={onUpdateVideoTask}
          onOpenTaskManager={onOpenTaskManager}
          resumeTaskId={resumeTaskId?.startsWith('nar-') ? resumeTaskId : null}
          onResumeHandled={onResumeHandled}
        />
      </div>
      <div className={studioMode === 'whatsapp' ? 'block' : 'hidden'}>
        <WhatsAppVideoBot onSwitchStudioMode={setStudioMode} />
      </div>

      {false && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Sidebar: Histórias e Conversas Salvas */}
        {isSidebarOpen && (
          <aside className="lg:col-span-4 bg-neutral-900/70 border border-neutral-800 rounded-2xl p-4 flex flex-col h-[750px] shadow-lg">
            {/* Sidebar Header */}
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800/80">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-cyan-400" />
                <h2 className="text-xs font-bold text-white tracking-wide uppercase">
                  Histórias Salvas ({conversations.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                className="lg:hidden p-1 text-neutral-400 hover:text-white"
                title="Fechar lista"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="relative mt-3 mb-2">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-500" />
              <input
                type="text"
                placeholder="Buscar histórias salvas..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
              />
            </div>

            {/* Saved Items List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 mt-1">
              {/* Quick Launcher: Matéria para Vídeo */}
              <div
                onClick={() => setStudioMode('reportagem')}
                className="group relative p-3 rounded-xl border border-red-800/80 bg-gradient-to-br from-red-950/60 via-neutral-900 to-rose-950/40 hover:border-red-500/80 transition-all cursor-pointer shadow-md mb-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 flex items-center justify-center shrink-0">
                      <Film className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-xs font-bold text-red-200 truncate">
                          Matéria para Vídeo
                        </h3>
                        <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-red-900 text-red-300 border border-red-700 shrink-0 uppercase">
                          NOVO
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-400 mt-0.5 truncate">
                        URL de notícia em vídeo com fotos e voz
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              {filteredConversations.length === 0 ? (
                <div className="text-center py-12 text-xs text-neutral-500">
                  Nenhuma história encontrada.
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const isActive = conv.id === activeConvId;
                  const lastMessage = conv.messages[conv.messages.length - 1];
                  const snippet = lastMessage?.content?.slice(0, 90).replace(/\n/g, ' ') || 'História sem mensagens ainda...';

                  return (
                    <div
                      key={conv.id}
                      onClick={() => setActiveConvId(conv.id)}
                      className={`group relative p-3 rounded-xl border transition-all cursor-pointer ${
                        isActive
                          ? 'bg-neutral-800/90 border-cyan-800/80 shadow-md'
                          : 'bg-neutral-950/50 border-neutral-800/80 hover:bg-neutral-800/40 hover:border-neutral-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <h3 className="text-xs font-semibold text-white truncate max-w-[190px]">
                              {conv.title}
                            </h3>
                            {conv.isFavorite && (
                              <Bookmark className="h-3 w-3 text-amber-400 fill-amber-400 shrink-0" />
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-400 mt-1 line-clamp-2 leading-relaxed">
                            {snippet}
                          </p>
                        </div>

                        {/* Favorite & Action Buttons */}
                        <div className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={(e) => handleToggleFavorite(conv.id, e)}
                            className="p-1 text-neutral-400 hover:text-amber-400 transition-colors"
                            title={conv.isFavorite ? 'Remover dos favoritos' : 'Favoritar história'}
                          >
                            <Bookmark
                              className={`h-3.5 w-3.5 ${conv.isFavorite ? 'text-amber-400 fill-amber-400' : ''}`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(conv.id);
                            }}
                            className="p-1 text-neutral-500 hover:text-rose-400 transition-colors"
                            title="Excluir história"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Bottom metadata */}
                      <div className="flex items-center justify-between text-[10px] text-neutral-500 mt-2.5 pt-2 border-t border-neutral-800/40">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono">
                            {new Date(conv.updatedAt).toLocaleDateString('pt-BR')}
                          </span>
                          <span>•</span>
                          <span>{conv.messages.length} msgs</span>
                        </div>

                        {/* Per-chat Voice Tags status badge */}
                        {conv.includeVoiceTags === false ? (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-900 text-neutral-500 border border-neutral-800 font-medium">
                            Sem Locução
                          </span>
                        ) : (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-medium flex items-center gap-0.5">
                            🎙️ Locução Ativa
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Sidebar Footer Info */}
            <div className="mt-3 pt-3 border-t border-neutral-800 text-[11px] text-neutral-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Salvo no dispositivo</span>
              </span>
              <span className="font-mono text-[10px] text-neutral-500">IndexedDB</span>
            </div>
          </aside>
        )}

        {/* Chat / Story Creation Canvas */}
        <section
          className={`${
            isSidebarOpen ? 'lg:col-span-8' : 'lg:col-span-12'
          } bg-neutral-900/60 border border-neutral-800 rounded-2xl flex flex-col h-[750px] shadow-xl overflow-hidden`}
        >
          {/* Top Canvas Header Bar */}
          <div className="p-3.5 px-5 border-b border-neutral-800 bg-neutral-950/70 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {!isSidebarOpen && (
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(true)}
                  className="p-1.5 text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800 rounded-lg transition-colors cursor-pointer mr-1"
                  title="Abrir Histórias Salvas"
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
              )}

              {/* Editable Title */}
              {isEditingTitle ? (
                <div className="flex items-center gap-1.5 flex-1 max-w-md">
                  <input
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveTitle();
                      if (e.key === 'Escape') setIsEditingTitle(false);
                    }}
                    autoFocus
                    className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-white"
                  />
                  <button
                    type="button"
                    onClick={handleSaveTitle}
                    className="px-2 py-1 text-xs bg-white text-neutral-950 font-bold rounded-lg"
                  >
                    Salvar
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 truncate">
                  <h2 className="text-sm sm:text-base font-bold text-white truncate">
                    {activeConversation?.title || 'História Sem Título'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsEditingTitle(true)}
                    className="text-neutral-500 hover:text-neutral-300 p-0.5 rounded cursor-pointer"
                    title="Editar título"
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Quick Actions for Current Story */}
            <div className="flex items-center gap-1.5 shrink-0">
              {activeConversation && (
                <>
                  <button
                    type="button"
                    onClick={() => handleExportConversation(activeConversation, 'txt')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-neutral-300 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 transition-colors"
                    title="Baixar história completa em arquivo .txt"
                  >
                    <Download className="h-3.5 w-3.5 text-neutral-400" />
                    <span className="hidden sm:inline">.TXT</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportConversation(activeConversation, 'md')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-neutral-300 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 transition-colors"
                    title="Baixar em formato Markdown (.md)"
                  >
                    <FileCode className="h-3.5 w-3.5 text-neutral-400" />
                    <span className="hidden sm:inline">.MD</span>
                  </button>
                </>
              )}

              {isSidebarOpen && (
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(false)}
                  className="hidden lg:flex p-1.5 text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800 rounded-lg transition-colors cursor-pointer"
                  title="Expandir espaço de escrita"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Messages & Stories Scrollable Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {(!activeConversation || activeConversation.messages.length === 0) && (
              <div className="max-w-xl mx-auto py-8 text-center space-y-4">
                <div className="h-12 w-12 rounded-2xl bg-cyan-950/80 border border-cyan-800 text-cyan-400 flex items-center justify-center mx-auto shadow-inner">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Pronto para criar narrativas extraordinárias</h3>
                  <p className="text-xs text-neutral-400 mt-1 max-w-md mx-auto">
                    Peça contos, crônicas, roteiros ou textos grandes. Se gostar da história, clique em <strong className="text-white">"Puxar para Voz Natural"</strong> para convertê-la em fala humana com um clique.
                  </p>
                </div>

                {/* Preset Templates */}
                <div className="pt-2 text-left">
                  <span className="text-[11px] font-semibold text-neutral-400 block mb-2 text-center uppercase tracking-wider">
                    Sugestões de Inspiração
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PRESET_TEMPLATES.map((tpl, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setCategory(tpl.category);
                          setInputPrompt(tpl.prompt);
                          setTimeout(() => {
                            textareaRef.current?.focus();
                          }, 50);
                        }}
                        className="p-3 text-left rounded-xl bg-neutral-950/60 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-800/50 transition-all text-xs text-neutral-300 cursor-pointer"
                      >
                        <span className="font-semibold text-white block">{tpl.label}</span>
                        <span className="text-[11px] text-neutral-400 line-clamp-2 mt-1">
                          {tpl.prompt}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Conversation Messages */}
            {activeConversation?.messages
              .filter((msg) => msg.content && msg.content.trim().length > 0)
              .map((msg) => {
                const isAssistant = msg.role === 'assistant';

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}
                  >
                    <div className="flex items-center gap-2 mb-1.5 text-[11px] text-neutral-400">
                      <span className="font-semibold text-neutral-300">
                        {isAssistant ? 'IA Narrada' : 'Você'}
                      </span>
                      <span>·</span>
                      <span className="font-mono">
                        {new Date(msg.createdAt).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {isAssistant && msg.charCount && msg.charCount > 0 && (
                        <>
                          <span>·</span>
                          <span className="font-mono text-cyan-300 font-semibold">
                            {msg.charCount.toLocaleString('pt-BR')} caracteres
                          </span>
                          <span>·</span>
                          <span className="font-mono text-neutral-400">
                            {msg.wordCount?.toLocaleString('pt-BR')} palavras
                          </span>
                        </>
                      )}
                    </div>

                    <div
                      className={`rounded-2xl p-4 sm:p-5 max-w-3xl text-sm leading-relaxed whitespace-pre-wrap transition-all shadow-md ${
                        isAssistant
                          ? 'bg-neutral-950/80 border border-neutral-800 text-neutral-100'
                          : 'bg-neutral-800 text-white border border-neutral-700/80 self-end'
                      }`}
                    >
                      {msg.content}

                      {/* AI Message Action Toolbar (prominent "Puxar para Voz Natural") - only if content exists */}
                      {isAssistant && msg.content && msg.content.trim().length > 0 && (
                        <div className="mt-4 pt-3.5 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-2.5">
                          {/* THE REQUESTED PROMINENT BUTTON: Puxar para o texto em voz natural */}
                          <button
                            type="button"
                            onClick={() => handlePullToVoice(msg.content, activeConversation.title)}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-neutral-950 bg-white hover:bg-neutral-200 active:scale-95 transition-all shadow-lg cursor-pointer"
                            title="Transferir este texto para o Conversor de Voz Neural e abrir a aba de locução"
                          >
                            <Volume2 className="h-4 w-4 text-neutral-950" />
                            <span>Puxar para Voz Natural</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>

                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Copy button */}
                            <button
                              type="button"
                              onClick={() => handleCopyText(msg.content, msg.id)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-neutral-300 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 transition-colors cursor-pointer"
                              title="Copiar texto"
                            >
                              {copiedId === msg.id ? (
                                <>
                                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                                  <span className="text-emerald-400 font-medium">Copiado!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5 text-neutral-400" />
                                  <span>Copiar</span>
                                </>
                              )}
                            </button>

                            {/* Download as .txt */}
                            <button
                              type="button"
                              onClick={() => {
                                const blob = new Blob([msg.content], { type: 'text/plain;charset=utf-8' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `narrativa-${msg.id.slice(-6)}.txt`;
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800 transition-colors"
                              title="Baixar trecho em .txt"
                            >
                              <Download className="h-3.5 w-3.5" />
                              <span>.txt</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

            {/* In-line Generation Error Card with Instant Retry */}
            {generationError && (
              <div className="rounded-2xl border border-rose-900/80 bg-rose-950/40 p-4 sm:p-5 space-y-3 shadow-lg animate-in fade-in duration-200">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h4 className="text-xs sm:text-sm font-bold text-white">Falha momentânea na entrega do texto</h4>
                    <p className="text-xs text-rose-300/90 leading-relaxed">
                      {generationError?.message}
                    </p>
                  </div>
                </div>

                {/* Formas de Contornar (Opções para contornar sobrecarga imediatamente) */}
                <div className="pt-2 border-t border-rose-900/40 space-y-2">
                  <span className="text-[11px] font-semibold text-rose-200 flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                    <span>Opções para contornar e gerar imediatamente:</span>
                  </span>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Contorno 1: Motor Gemma 4 (Sem Fila / Zero 503) */}
                    <button
                      type="button"
                      onClick={() => {
                        const p = generationError?.prompt || '';
                        setSelectedEngine('gemma');
                        setGenerationError(null);
                        handleGenerate(p, 'gemma');
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 shadow-md transition-all cursor-pointer"
                      title="Usar motor alternativo ultra resiliente sem fila de espera"
                    >
                      <Zap className="h-3.5 w-3.5 text-amber-300" />
                      <span>⚡ Contornar com Motor Sem Fila (Gemma 4)</span>
                    </button>

                    {/* Contorno 2: Tentar Novamente com auto-bypass */}
                    <button
                      type="button"
                      onClick={() => {
                        const p = generationError?.prompt || '';
                        setGenerationError(null);
                        handleGenerate(p);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-neutral-950 bg-white hover:bg-neutral-200 active:scale-95 shadow-md transition-all cursor-pointer"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Tentar Novamente Agora</span>
                    </button>

                    {/* Contorno 3: Editar comando */}
                    <button
                      type="button"
                      onClick={() => {
                        setInputPrompt(generationError?.prompt || '');
                        setGenerationError(null);
                        textareaRef.current?.focus();
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-neutral-300 hover:text-white bg-neutral-900 border border-neutral-800 rounded-xl transition-colors cursor-pointer"
                      title="Editar o comando na caixa de escrita"
                    >
                      <Edit2 className="h-3 w-3" />
                      <span>Editar Comando</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setGenerationError(null)}
                      className="px-2.5 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer ml-auto"
                    >
                      Dispensar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Quick-trigger button if the last message in conversation was from user and awaiting response */}
            {(() => {
              const validMsgs = (activeConversation?.messages || []).filter(
                (m) => m.content && m.content.trim().length > 0
              );
              const last = validMsgs[validMsgs.length - 1];
              if (last && last.role === 'user' && !isGenerating && !generationError) {
                return (
                  <div className="flex items-center gap-2 pt-1 animate-in fade-in duration-200">
                    <button
                      type="button"
                      onClick={() => handleGenerate(last.content)}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-neutral-950 bg-cyan-400 hover:bg-cyan-300 active:scale-95 shadow-lg transition-all cursor-pointer"
                      title="Gerar narrativa para o último pedido enviado"
                    >
                      <Sparkles className="h-4 w-4" />
                      <span>Gerar Resposta Deste Pedido</span>
                    </button>
                  </div>
                );
              }
              return null;
            })()}

            {/* Live Generating Animation Indicator */}
            {isGenerating && (
              <div className="flex flex-col items-start space-y-2">
                <div className="flex items-center gap-2 text-xs text-cyan-400 font-medium">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Escrevendo narrativa detalhada...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Creation Options Bar (Length & Voice Tags) */}
          <div className="px-4 py-2 bg-neutral-950/80 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-400">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Length Selector */}
              <div className="flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5 text-neutral-400" />
                <span>Extensão:</span>
                <div className="inline-flex rounded-lg bg-neutral-900 p-0.5 border border-neutral-800">
                  <button
                    type="button"
                    onClick={() => setLengthOption('short')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      lengthOption === 'short' ? 'bg-neutral-800 text-white font-bold' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Curto
                  </button>
                  <button
                    type="button"
                    onClick={() => setLengthOption('medium')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      lengthOption === 'medium' ? 'bg-neutral-800 text-white font-bold' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Médio
                  </button>
                  <button
                    type="button"
                    onClick={() => setLengthOption('long')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      lengthOption === 'long' ? 'bg-neutral-800 text-white font-bold' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Longo
                  </button>
                  <button
                    type="button"
                    onClick={() => setLengthOption('epic')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      lengthOption === 'epic' ? 'bg-cyan-950 text-cyan-300 font-bold border border-cyan-800' : 'text-neutral-400 hover:text-white'
                    }`}
                    title="História densa e épica de milhares de palavras"
                  >
                    ⚡ Épico (Super Longo)
                  </button>
                </div>
              </div>

              {/* Natural Voice Tags Checkbox */}
              <label className="flex items-center gap-1.5 cursor-pointer text-neutral-300 hover:text-white select-none">
                <input
                  type="checkbox"
                  checked={includeVoiceTags}
                  onChange={(e) => handleToggleIncludeVoiceTags(e.target.checked)}
                  className="rounded accent-cyan-400 cursor-pointer"
                />
                <span>Incluir Marcadores de Locução ([pausa 1s], [ênfase])</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Engine Selector (Forma de contornar fila e sobrecarga) */}
              <div className="flex items-center gap-1 bg-neutral-900/90 p-0.5 rounded-lg border border-neutral-800">
                <span className="text-[10px] text-neutral-400 px-1 font-semibold">Motor:</span>
                <button
                  type="button"
                  onClick={() => setSelectedEngine('gemma')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    selectedEngine === 'gemma'
                      ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-800'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                  title="Motor resiliente sem fila e sem erro de sobrecarga"
                >
                  ⚡ Gemma 4 (Sem Fila)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEngine('auto')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    selectedEngine === 'auto'
                      ? 'bg-neutral-800 text-white font-bold'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                  title="Alternância inteligente e contorno de tráfego automático"
                >
                  🔄 Auto-Bypass
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEngine('gemini')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    selectedEngine === 'gemini'
                      ? 'bg-cyan-950 text-cyan-300 font-bold border border-cyan-800'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                  title="Gemini Flash"
                >
                  Gemini Flash
                </button>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                <span>
                  {selectedEngine === 'gemma'
                    ? 'Gemma 4 (Sem Fila / Zero 503)'
                    : selectedEngine === 'gemini'
                    ? 'Gemini 3.8 Flash (Free)'
                    : 'Auto-Contorno Ativo'}
                </span>
              </div>
            </div>
          </div>

          {/* Input Box Area */}
          <div className="p-3 sm:p-4 bg-neutral-950 border-t border-neutral-800">
            <div className="relative rounded-xl border border-neutral-800 bg-neutral-900/80 focus-within:border-neutral-500 focus-within:ring-1 focus-within:ring-neutral-500 transition-all flex flex-col">
              <textarea
                ref={textareaRef}
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
                disabled={isGenerating}
                placeholder="Ex: Crie um conto detalhado sobre um astronauta que descobre uma floresta de vidro... ou peça para continuar a narrativa."
                rows={3}
                className="w-full bg-transparent px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none resize-none leading-relaxed"
              />

              {/* Input Action Controls */}
              <div className="flex items-center justify-between px-3 py-2 border-t border-neutral-800/60 bg-neutral-950/40 rounded-b-xl">
                <span className="text-[11px] text-neutral-500 hidden sm:inline">
                  Pressione <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 font-mono text-[10px]">Enter</kbd> para gerar
                </span>

                <div className="flex items-center gap-2 ml-auto">
                  {isGenerating ? (
                    <button
                      type="button"
                      onClick={handleStopGeneration}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-300 bg-rose-950 border border-rose-800 hover:bg-rose-900 transition-colors cursor-pointer"
                    >
                      <StopCircle className="h-4 w-4 text-rose-400" />
                      <span>Parar Geração</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleGenerate()}
                      disabled={!inputPrompt.trim()}
                      className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold text-neutral-950 bg-white hover:bg-neutral-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Gerar Narrativa</span>
                      <Send className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-white">Excluir esta história?</h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Tem certeza de que deseja apagar esta narrativa do armazenamento local? Esta ação não pode ser desfeita.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDeleteConversation(deleteConfirmId)}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors cursor-pointer"
              >
                Excluir Definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

