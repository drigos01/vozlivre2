import { NarratedStory } from '../types';
import { CURATED_VOICES } from './voices';

const defaultVoice = CURATED_VOICES[0]; // Francisca
const maleVoice = CURATED_VOICES.find((v) => v.id === 'en-US-BrianMultilingualNeural') || CURATED_VOICES[2]; // Bruno or Antônio

export const SAMPLE_STORIES: NarratedStory[] = [
  {
    id: 'story-ufo-1',
    title: 'História UFO: O Contato da Madrugada',
    description: 'Um mistério inexplicável nas estradas desertas de Minas Gerais em uma madrugada sem luar.',
    category: 'Mistério & Ficção',
    defaultVoice: maleVoice,
    defaultSettings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24,
    segments: [
      {
        id: 'seg-ufo-1',
        title: 'Parte 1: O Clarão na Estrada Velha',
        text: 'Eram exatamente três e quinze da madrugada quando a viagem rotineira pela rodovia vicinal foi interrompida. As árvores ao redor começaram a projetar sombras compridas e anômalas, iluminadas por uma luz azulada e silenciosa que descia direto das nuvens. O motor do carro deu um leve soluço e os faróis oscilaram.',
        voice: maleVoice,
        settings: { rate: '+0%', pitch: '-15Hz', volume: '+0%' },
        status: 'pending',
        order: 0,
      },
      {
        id: 'seg-ufo-2',
        title: 'Parte 2: A Interferência Eletromagnética',
        text: 'O rádio analógico emitiu uma sequência rápida de pulsos metálicos, como uma frequência codificada buscando sintonia. O motorista encostou no acostamento de terra. O ar lá fora parecia mais denso, quase elétrico, e um zumbido de baixa frequência vibrava no peito antes mesmo de ser ouvido.',
        voice: maleVoice,
        settings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
        status: 'pending',
        order: 1,
      },
      {
        id: 'seg-ufo-3',
        title: 'Parte 3: O Objeto Sobre o Vale',
        text: 'Entre a copa dos eucaliptos, uma estrutura geométrica de metal escuro flutuava sem produzir vento ou calor. Luzes sequenciais giravam ao redor do perímetro em velocidade ritmada. Por alguns segundos que pareceram horas, houve uma troca de olhares invisível entre quem estava no chão e o desconhecido.',
        voice: maleVoice,
        settings: { rate: '-25%', pitch: '+0Hz', volume: '+0%' },
        status: 'pending',
        order: 2,
      },
      {
        id: 'seg-ufo-4',
        title: 'Parte 4: A Partida Silenciosa',
        text: 'Em uma fração de segundo, a nave acelerou verticalmente cortando a atmosfera sem nenhum estrondo sônico, deixando apenas o reflexo prateado nas nuvens altas. O motor do veículo voltou a funcionar sozinho, mas o silêncio daquela noite nunca mais seria o mesmo.',
        voice: maleVoice,
        settings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
        status: 'pending',
        order: 3,
      },
    ],
  },
  {
    id: 'story-farm-1',
    title: 'História Fazenda: O Casarão do Velho Cedro',
    description: 'A jornada de retorno às origens no interior e a redescoberta de memórias escondidas há gerações.',
    category: 'Drama Rural & Memórias',
    defaultVoice: defaultVoice,
    defaultSettings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
    createdAt: Date.now() - 1000 * 60 * 60 * 12,
    updatedAt: Date.now() - 1000 * 60 * 60 * 12,
    segments: [
      {
        id: 'seg-farm-1',
        title: 'Parte 1: O Portão de Ferro Enferrujado',
        text: 'As porteiras de madeira da antiga fazenda rangeram ao serem empurradas após quase vinte anos de abandono. O cheiro de terra molhada pelo orvalho matinal misturava-se ao aroma adocicado das laranjeiras floridas que ainda resistiam bravamente ao tempo.',
        voice: defaultVoice,
        settings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
        status: 'pending',
        order: 0,
      },
      {
        id: 'seg-farm-2',
        title: 'Parte 2: O Assoalho do Quarto de Costura',
        text: 'Dentro do casarão principal, a poeira dançava nos feixes de sol que atravessavam as venezianas de madeira. Ao caminhar pelo corredor largo, uma tábua solta rangeu sob os passos. Abaixo dela, enrolado em um pano de algodão cru, repousava um estojo de couro antigo marcado pelas iniciais do bisavô.',
        voice: defaultVoice,
        settings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
        status: 'pending',
        order: 1,
      },
      {
        id: 'seg-farm-3',
        title: 'Parte 3: O Diário e a Promessa',
        text: 'As páginas amareladas guardavam anotações precisas sobre as safras de café, mas entre os números havia cartas de amor e relatos sobre um poço de água cristalina nascido na cabeceira da mata. Era a prova de que aquele lugar não era apenas terra, mas um legado de coragem.',
        voice: defaultVoice,
        settings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
        status: 'pending',
        order: 2,
      },
      {
        id: 'seg-farm-4',
        title: 'Parte 4: O Café Coado ao Entardecer',
        text: 'Com o fogo aceso no velho fogão a lenha, o som da chaleira fervendo trouxe de volta a alma da casa. Olhando o pôr do sol dourar os morros verdejantes, a decisão estava tomada: o casarão não seria vendido; ele voltaria a pulsar com vida nova.',
        voice: defaultVoice,
        settings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
        status: 'pending',
        order: 3,
      },
    ],
  },
];
