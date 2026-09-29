import React from 'react';
import { Sliders, RotateCcw } from 'lucide-react';
import { ProsodySettings } from '../types';

interface VoiceSettingsProps {
  settings: ProsodySettings;
  onChange: (settings: ProsodySettings) => void;
  disabled?: boolean;
}

export const VoiceSettings: React.FC<VoiceSettingsProps> = ({
  settings,
  onChange,
  disabled = false,
}) => {
  const speedOptions = [
    { label: '0.75x', value: '-25%' },
    { label: '1.0x (Padrão)', value: '+0%' },
    { label: '1.15x', value: '+15%' },
    { label: '1.25x', value: '+25%' },
    { label: '1.5x', value: '+50%' },
  ];

  const pitchOptions = [
    { label: 'Grave', value: '-15Hz' },
    { label: 'Natural', value: '+0Hz' },
    { label: 'Agudo', value: '+15Hz' },
  ];

  const resetDefaults = () => {
    onChange({
      rate: '+0%',
      pitch: '+0Hz',
      volume: '+0%',
    });
  };

  const isCustom = settings.rate !== '+0%' || settings.pitch !== '+0Hz';

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-neutral-400" />
          <h4 className="text-xs font-semibold text-white uppercase tracking-wider">
            Ajustes de Fala & Entonação
          </h4>
        </div>

        {isCustom && (
          <button
            type="button"
            onClick={resetDefaults}
            disabled={disabled}
            className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white transition-colors"
            title="Redefinir para valores padrões"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Restaurar padrão</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
        {/* Speed / Ritmo */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-400 font-medium">Velocidade da Narração</span>
            <span className="font-mono text-neutral-200">
              {speedOptions.find((o) => o.value === settings.rate)?.label || 'Personalizado'}
            </span>
          </div>

          <div className="flex items-center gap-1 p-1 bg-neutral-900 border border-neutral-800 rounded-lg">
            {speedOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...settings, rate: opt.value })}
                className={`flex-1 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  settings.rate === opt.value
                    ? 'bg-neutral-800 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {opt.label.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Pitch / Tom */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-400 font-medium">Tom da Voz (Grave / Agudo)</span>
            <span className="font-mono text-neutral-200">
              {pitchOptions.find((o) => o.value === settings.pitch)?.label || 'Natural'}
            </span>
          </div>

          <div className="flex items-center gap-1 p-1 bg-neutral-900 border border-neutral-800 rounded-lg">
            {pitchOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...settings, pitch: opt.value })}
                className={`flex-1 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  settings.pitch === opt.value
                    ? 'bg-neutral-800 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
