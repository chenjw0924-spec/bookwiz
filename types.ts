
export interface Scene {
  text: string;
  summary: string; // New: Short summary (max 8 chars)
  imagePrompt: string;
  imageUrl?: string;
  audioBuffer?: AudioBuffer;
  audioBase64?: string; // Stored for export/serialization
  duration?: number;
}

export interface BookStoryData {
  title: string;
  author: string;
  styleDescription: string;
  scenes: Scene[];
}

export enum LoadingStatus {
  IDLE = 'IDLE',
  LOADING_SCRIPT = 'LOADING_SCRIPT',
  GENERATING_MEDIA = 'GENERATING_MEDIA',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export type VoiceType = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface AppSettings {
  voice: VoiceType;
  speechRate: number; // 0.5 to 2.0
  subtitleColor: string;
  subtitleFont: 'serif' | 'sans';
  subtitleSize: 'text-2xl' | 'text-4xl' | 'text-6xl';
  subtitleEffect: 'none' | 'glow' | 'outline' | 'glass';
}
