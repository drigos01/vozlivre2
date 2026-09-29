import React from 'react';
import { ShieldCheck, Zap, Layers, Download, CheckCircle2 } from 'lucide-react';

export const AboutSection: React.FC = () => {
  return (
    <div className="space-y-8 max-w-4xl mx-auto py-2">
      {/* Editorial Title */}
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          Como o VozLivre Funciona
        </h2>
        <p className="text-sm text-neutral-400 mt-1">
          Síntese de voz neural ilimitada, sem créditos e com suporte a textos longos.
        </p>
      </div>

      {/* Feature Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-800 text-neutral-200">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h3 className="font-semibold text-sm text-white">100% Gratuito & Sem Créditos</h3>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Diferente de serviços que impõem planos de assinatura ou bloqueiam quando os créditos acabam, o VozLivre utiliza o protocolo de voz neural do Microsoft Edge Read Aloud, garantindo uso constante e livre de cobranças.
          </p>
        </div>

        <div className="p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-800 text-neutral-200">
            <Zap className="h-5 w-5" />
          </div>
          <h3 className="font-semibold text-sm text-white">Geração Rápida em Paralelo</h3>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Textos extensos são processados em múltiplos blocos simultâneos. Isso permite converter 20.000 caracteres em questão de segundos com unificação perfeita de áudio.
          </p>
        </div>

        <div className="p-5 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-800 text-neutral-200">
            <Download className="h-5 w-5" />
          </div>
          <h3 className="font-semibold text-sm text-white">Download em MP3 e WAV</h3>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Baixe seu áudio instantaneamente em formato MP3 (ótimo para podcasts e narração) ou em WAV descompactado para edição profissional em softwares de áudio.
          </p>
        </div>
      </div>

      {/* Practical Guide */}
      <div className="p-6 rounded-xl border border-neutral-800 bg-neutral-900/30 space-y-4">
        <h3 className="text-base font-semibold text-white">
          Dicas para a Melhor Narração
        </h3>

        <div className="space-y-3 text-sm text-neutral-300">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">Pontuação expressiva:</strong> Use vírgulas para criar respirações e pausas curtas, pontos finais para pausas normais e reticências para reflexões.
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">Ajuste de velocidade e tom:</strong> Se você estiver narrando audiobooks longos, a velocidade de 1.1x ou 1.2x economiza tempo mantendo a clareza perfeita.
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">Textos acima de 20.000 caracteres:</strong> Basta dividir em partes e gerar cada uma sequencialmente. O histórico manterá todos os arquivos organizados para download.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
