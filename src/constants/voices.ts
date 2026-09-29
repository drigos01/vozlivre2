export interface Voice {
  id: string;
  name: string;
  gender: string;
  lang: string;
  langLabel: string;
  description: string;
  isDefault?: boolean;
  voiceLocale?: string;
}

export const CURATED_VOICES: Voice[] = [
  // Portuguese - Brazil (Female)
  {
    id: 'pt-BR-FranciscaNeural',
    name: 'Francisca',
    gender: 'Feminino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Natural, expressiva e envolvente. Perfeita para histórias, artigos e audiobooks.',
    isDefault: true,
  },
  {
    id: 'pt-BR-ThalitaMultilingualNeural',
    name: 'Thalita',
    gender: 'Feminino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Suave, amigável e moderna. Ótima para podcasts e conteúdos descontraídos.',
  },

  // Portuguese - Brazil (Male)
  {
    id: 'pt-BR-AntonioNeural',
    name: 'Antônio',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz clássica, madura, firme e segura. Excelente para notícias, tutoriais e negócios.',
  },
  {
    id: 'en-US-AndrewMultilingualNeural',
    name: 'André',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz masculina jovem, dinâmica e natural. Ideal para vídeos, podcasts e narrativas contemporâneas.',
    voiceLocale: 'pt-BR',
  },
  {
    id: 'en-US-BrianMultilingualNeural',
    name: 'Bruno',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz encorpada, grave e com presença forte. Ótima para audiobooks, documentários e cinema.',
    voiceLocale: 'pt-BR',
  },
  {
    id: 'en-AU-WilliamMultilingualNeural',
    name: 'William',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz calorosa, calma e acolhedora. Perfeita para reflexões, histórias e leitura explicativa.',
    voiceLocale: 'pt-BR',
  },
  {
    id: 'fr-FR-RemyMultilingualNeural',
    name: 'Rodrigo',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz moderna, ágil e articulada. Ideal para apresentações e conteúdos didáticos.',
    voiceLocale: 'pt-BR',
  },
  {
    id: 'de-DE-FlorianMultilingualNeural',
    name: 'Fábio',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz serena, pausada e analítica. Perfeita para artigos longos e relatórios técnicos.',
    voiceLocale: 'pt-BR',
  },
  {
    id: 'it-IT-GiuseppeMultilingualNeural',
    name: 'Gustavo',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz comunicativa, enérgica e clara. Ótima para cursos online e treinamentos.',
    voiceLocale: 'pt-BR',
  },

  // Portuguese - Portugal
  {
    id: 'pt-PT-RaquelNeural',
    name: 'Raquel',
    gender: 'Feminino',
    lang: 'pt-PT',
    langLabel: 'Português (Portugal)',
    description: 'Clara e formal, com pronúncia nativa de Portugal.',
  },
  {
    id: 'pt-PT-DuarteNeural',
    name: 'Duarte',
    gender: 'Masculino',
    lang: 'pt-PT',
    langLabel: 'Português (Portugal)',
    description: 'Masculina profunda e pausada de Portugal.',
  },

  // English - US
  {
    id: 'en-US-JennyNeural',
    name: 'Jenny',
    gender: 'Feminino',
    lang: 'en-US',
    langLabel: 'Inglês (EUA)',
    description: 'Ultra-natural US English female voice for general content.',
  },
  {
    id: 'en-US-GuyNeural',
    name: 'Guy',
    gender: 'Masculino',
    lang: 'en-US',
    langLabel: 'Inglês (EUA)',
    description: 'Warm, natural US English male voice.',
  },
  {
    id: 'en-US-AriaNeural',
    name: 'Aria',
    gender: 'Feminino',
    lang: 'en-US',
    langLabel: 'Inglês (EUA)',
    description: 'Expressive and engaging US female narrator.',
  },

  // English - UK
  {
    id: 'en-GB-SoniaNeural',
    name: 'Sonia',
    gender: 'Feminino',
    lang: 'en-GB',
    langLabel: 'Inglês (Reino Unido)',
    description: 'Clear British English female voice.',
  },
  {
    id: 'en-GB-RyanNeural',
    name: 'Ryan',
    gender: 'Masculino',
    lang: 'en-GB',
    langLabel: 'Inglês (Reino Unido)',
    description: 'Natural British English male narrator.',
  },

  // Spanish
  {
    id: 'es-ES-ElviraNeural',
    name: 'Elvira',
    gender: 'Feminino',
    lang: 'es-ES',
    langLabel: 'Espanhol (Espanha)',
    description: 'Voz femenina natural de España.',
  },
  {
    id: 'es-ES-AlvaroNeural',
    name: 'Álvaro',
    gender: 'Masculino',
    lang: 'es-ES',
    langLabel: 'Espanhol (Espanha)',
    description: 'Voz masculina cálida de España.',
  },
  {
    id: 'es-MX-DaliaNeural',
    name: 'Dalia',
    gender: 'Feminino',
    lang: 'es-MX',
    langLabel: 'Espanhol (México)',
    description: 'Voz femenina latinoamericana.',
  },
];
