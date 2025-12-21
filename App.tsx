
import React, { useState, useEffect, useRef } from 'react';
import { 
  BookOpen, Sparkles, Play, Pause, ChevronRight, ChevronLeft, 
  Loader2, Wand2, Library, Feather, Volume2, Maximize2, 
  RotateCcw, Download, ImageIcon, Settings2, Check, Type as TypeIcon,
  Palette, Sliders, Timer, Share2, Clock, SkipBack, Trash2, X, AlertCircle
} from 'lucide-react';
import { LoadingStatus, BookStoryData, Scene, VoiceType, AppSettings } from './types';
import { decomposeScriptToStory } from './services/geminiService';
import { GoogleGenAI, Modality, GenerateContentResponse } from "@google/genai";

// Audio Decoding Helpers
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function pcmToAudioBuffer(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length;
  const buffer = ctx.createBuffer(1, frameCount, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const RECOMMENDED_BOOKS = [
  { title: '小王子', author: '圣埃克苏佩里' },
  { title: '三体', author: '刘慈欣' },
  { title: '百年孤独', author: '马尔克斯' },
  { title: '月亮与六便士', author: '毛姆' }
];

const VOICE_OPTIONS: { id: VoiceType; label: string; desc: string }[] = [
  { id: 'Puck', label: '知性男声', desc: '儒雅温润' },
  { id: 'Charon', label: '深沉大叔', desc: '厚重磁性' },
  { id: 'Kore', label: '温柔女声', desc: '恬静从容' },
  { id: 'Fenrir', label: '力量男声', desc: '铿锵有力' },
  { id: 'Zephyr', label: '清爽少年', desc: '阳光明快' }
];

const COLOR_OPTIONS = [
  { id: 'text-white', label: '珍珠白', hex: '#FFFFFF' },
  { id: 'text-orange-400', label: '落日橙', hex: '#fb923c' },
  { id: 'text-yellow-200', label: '琥珀金', hex: '#fef08a' },
  { id: 'text-emerald-400', label: '翡翠绿', hex: '#34d399' },
  { id: 'text-sky-400', label: '晴空蓝', hex: '#38bdf8' },
  { id: 'text-rose-400', label: '蔷薇粉', hex: '#fb7185' },
  { id: 'text-purple-400', label: '幻境紫', hex: '#c084fc' }
];

const SIZE_OPTIONS: { id: AppSettings['subtitleSize']; label: string }[] = [
  { id: 'text-2xl', label: '精致' },
  { id: 'text-4xl', label: '标准' },
  { id: 'text-6xl', label: '宏大' }
];

const EFFECT_OPTIONS: { id: AppSettings['subtitleEffect']; label: string; desc: string }[] = [
  { id: 'none', label: '无效果', desc: '' },
  { id: 'glow', label: '柔光', desc: '' },
  { id: 'outline', label: '描边', desc: '' },
  { id: 'glass', label: '磨砂', desc: '' }
];

const App: React.FC = () => {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [status, setStatus] = useState<LoadingStatus>(LoadingStatus.IDLE);
  const [story, setStory] = useState<BookStoryData | null>(null);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [mediaProgress, setMediaProgress] = useState(0);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [retryInfo, setRetryInfo] = useState<{ count: number; nextWait: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const [settings, setSettings] = useState<AppSettings>({
    voice: 'Puck',
    speechRate: 1.0,
    subtitleColor: 'text-white',
    subtitleFont: 'serif',
    subtitleSize: 'text-4xl',
    subtitleEffect: 'glow'
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  const callWithRetry = async <T,>(fn: () => Promise<T>, maxRetries = 5): Promise<T> => {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
      try {
        setRetryInfo(null);
        return await fn();
      } catch (err: any) {
        lastError = err;
        const isQuotaError = String(err).includes('429') || String(err).toLowerCase().includes('quota');
        
        if (isQuotaError && i < maxRetries - 1) {
          const waitTime = Math.pow(2, i) * 5000 + Math.random() * 1000;
          setRetryInfo({ count: i + 1, nextWait: Math.round(waitTime / 1000) });
          await sleep(waitTime);
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };

  const startGeneration = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return;

    setErrorMessage(null);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    let currentStoryData = story;
    
    const isNewProject = !currentStoryData || currentStoryData.title !== title;

    if (isNewProject) {
      setStatus(LoadingStatus.LOADING_SCRIPT);
      try {
        currentStoryData = await callWithRetry(() => decomposeScriptToStory(title, author));
        setStory(currentStoryData);
      } catch (err: any) {
        setErrorMessage("剧本分析失败：API 配额超限，请稍候再试。");
        setStatus(LoadingStatus.ERROR);
        return;
      }
    }

    setStatus(LoadingStatus.GENERATING_MEDIA);
    
    try {
      const updatedScenes = [...currentStoryData!.scenes];
      const ctx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;

      const totalSteps = updatedScenes.length * 2;
      let completedSteps = 0;

      updatedScenes.forEach(s => {
        if (s.imageUrl) completedSteps++;
        if (s.audioBuffer) completedSteps++;
      });

      for (let i = 0; i < updatedScenes.length; i++) {
        if (!updatedScenes[i].imageUrl) {
          await sleep(2000); 
          const imgRes = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: `Style: ${currentStoryData!.styleDescription}. Scene: ${updatedScenes[i].imagePrompt}` }] }
          }));
          const imgPart = imgRes.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
          if (imgPart?.inlineData) {
            updatedScenes[i].imageUrl = `data:image/png;base64,${imgPart.inlineData.data}`;
          }
        }
        completedSteps = Math.max(completedSteps, (i * 2) + 1);
        setMediaProgress(Math.round((completedSteps / totalSteps) * 100));

        if (!updatedScenes[i].audioBuffer) {
          await sleep(2000); 
          const ttsRes = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: updatedScenes[i].text }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voice } } }
            }
          }));
          const base64Audio = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (base64Audio) {
            updatedScenes[i].audioBase64 = base64Audio;
            const pcmData = decodeBase64(base64Audio);
            updatedScenes[i].audioBuffer = await pcmToAudioBuffer(pcmData, ctx);
            updatedScenes[i].duration = (updatedScenes[i].audioBuffer?.duration || 5) / settings.speechRate;
          }
        }
        completedSteps = Math.max(completedSteps, (i * 2) + 2);
        setMediaProgress(Math.round((completedSteps / totalSteps) * 100));

        setStory({ ...currentStoryData!, scenes: [...updatedScenes] });
      }
      setStatus(LoadingStatus.SUCCESS);
    } catch (err: any) {
      setErrorMessage("视听同步受阻：配额已用完。进度已为您安全保存，请稍后点击“继续视听工程”。");
      setStatus(LoadingStatus.ERROR);
    }
  };

  const playScene = (index: number) => {
    if (!story || !story.scenes[index].audioBuffer) return;
    setCurrentSceneIndex(index);
    setIsPlaying(true);
    if (sourceNodeRef.current) {
      sourceNodeRef.current.onended = null;
      sourceNodeRef.current.stop();
    }
    const ctx = audioContextRef.current;
    if (ctx && ctx.state === 'suspended') ctx.resume();
    const source = ctx!.createBufferSource();
    source.buffer = story.scenes[index].audioBuffer!;
    source.playbackRate.value = settings.speechRate;
    source.connect(ctx!.destination);
    source.onended = () => {
      if (index < story.scenes.length - 1) playScene(index + 1);
      else setIsPlaying(false);
    };
    source.start(0);
    sourceNodeRef.current = source;
  };

  const togglePlay = () => isPlaying ? (sourceNodeRef.current?.stop(), setIsPlaying(false)) : playScene(currentSceneIndex);

  const getEffectClasses = () => {
    switch (settings.subtitleEffect) {
      case 'glow': return 'drop-shadow-[0_0_15px_rgba(255,255,255,0.7)]';
      case 'outline': return 'paint-order-markers [text-shadow:-1px_-1px_0_#000,1px_-1px_0_#000,-1px_1px_0_#000,1px_1px_0_#000]';
      case 'glass': return 'bg-black/40 backdrop-blur-md px-8 py-4 rounded-2xl border border-white/10';
      default: return 'drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]';
    }
  };

  const SidebarContent = () => (
    <div className="space-y-8 md:space-y-12 pb-10">
      <div className="flex items-center justify-between text-slate-900 border-b border-slate-50 pb-6">
        <div className="flex items-center gap-3">
          <div className="bg-orange-100 p-2.5 rounded-xl text-orange-600"><Settings2 size={24} /></div>
          <div>
            <h3 className="text-xl font-black tracking-tight">视听配置</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Studio Settings</p>
          </div>
        </div>
        <button onClick={() => setMobileSettingsOpen(false)} className="lg:hidden p-2 text-slate-400"><X size={24} /></button>
      </div>

      <section className="space-y-6">
        <div className="space-y-4">
          <h4 className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-[0.2em]"><Volume2 size={16} /> 朗读音色</h4>
          <div className="grid grid-cols-1 gap-3">
            {VOICE_OPTIONS.map(v => (
              <button key={v.id} type="button" onClick={() => setSettings(s => ({...s, voice: v.id}))} className={`p-4 rounded-2xl border-2 text-left transition-all flex items-center justify-between group ${settings.voice === v.id ? 'border-orange-500 bg-orange-50 shadow-sm' : 'border-slate-50 bg-slate-50 hover:bg-white hover:border-slate-200'}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${settings.voice === v.id ? 'bg-orange-500 text-white' : 'bg-white text-slate-300'}`}><Volume2 size={18} /></div>
                  <div><div className="font-bold text-slate-800 text-md">{v.label}</div><div className="text-[10px] text-slate-400 font-medium">{v.desc}</div></div>
                </div>
                {settings.voice === v.id && <div className="text-orange-500"><Check size={20} /></div>}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-[0.2em]"><Sliders size={16} /> 朗读语速</h4>
            <span className="text-orange-600 font-mono font-bold text-xs">{settings.speechRate.toFixed(1)}x</span>
          </div>
          <input type="range" min="0.5" max="2.0" step="0.1" value={settings.speechRate} onChange={(e) => setSettings(s => ({...s, speechRate: parseFloat(e.target.value)}))} className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-orange-500" />
        </div>
      </section>

      <section className="space-y-8">
        <h4 className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-[0.2em]"><Palette size={16} /> 字幕美学</h4>
        <div className="flex flex-wrap gap-3">
          {COLOR_OPTIONS.map(c => (
            <button key={c.id} type="button" onClick={() => setSettings(s => ({...s, subtitleColor: c.id}))} className={`w-10 h-10 rounded-full border-4 flex items-center justify-center transition-all ${settings.subtitleColor === c.id ? 'border-orange-500 scale-110 shadow-lg' : 'border-white shadow-sm hover:scale-110'}`} style={{ backgroundColor: c.hex }}>
              {settings.subtitleColor === c.id && <Check size={18} className={c.id === 'text-white' ? 'text-black' : 'text-white'} />}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <select value={settings.subtitleSize} onChange={(e) => setSettings(s => ({...s, subtitleSize: e.target.value as any}))} className="p-3 rounded-xl bg-slate-50 border border-slate-100 font-bold text-sm outline-none focus:border-orange-500">
            {SIZE_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
          </select>
          <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100">
            <button type="button" onClick={() => setSettings(s => ({...s, subtitleFont: 'serif'}))} className={`flex-1 py-1 rounded-lg transition-all text-xs font-bold ${settings.subtitleFont === 'serif' ? 'bg-white shadow-sm text-orange-600' : 'text-slate-400'}`}>衬线</button>
            <button type="button" onClick={() => setSettings(s => ({...s, subtitleFont: 'sans'}))} className={`flex-1 py-1 rounded-lg transition-all text-xs font-bold ${settings.subtitleFont === 'sans' ? 'bg-white shadow-sm text-orange-600' : 'text-slate-400'}`}>现代</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {EFFECT_OPTIONS.map(e => (
            <button key={e.id} type="button" onClick={() => setSettings(s => ({...s, subtitleEffect: e.id}))} className={`py-3 rounded-xl border transition-all text-xs font-bold ${settings.subtitleEffect === e.id ? 'border-orange-500 bg-orange-50 text-orange-600' : 'border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200'}`}>
              {e.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  return (
    <div className={`min-h-screen ${status === LoadingStatus.SUCCESS ? 'bg-black overflow-hidden' : 'bg-[#fcfaf7] overflow-y-auto font-sans text-slate-900'} transition-all duration-700`}>
      
      {(status === LoadingStatus.IDLE || status === LoadingStatus.LOADING_SCRIPT || status === LoadingStatus.GENERATING_MEDIA || status === LoadingStatus.ERROR) && (
        <div className="flex flex-col min-h-screen">
          <header className="py-6 px-6 md:px-12 flex items-center justify-between border-b border-slate-100 bg-white/50 backdrop-blur-md sticky top-0 z-50">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-orange-500 to-rose-600 p-2 rounded-xl text-white shadow-lg"><BookOpen size={24} /></div>
              <span className="font-extrabold text-2xl serif tracking-tighter">BookWiz <span className="text-orange-600 text-[10px] font-mono border border-orange-200 px-1 rounded ml-1">PRO</span></span>
            </div>
            
            <div className="flex items-center gap-3">
              {story && story.title === title && (
                <div className="hidden sm:flex items-center gap-2 bg-orange-50 text-orange-600 px-4 py-1.5 rounded-full text-xs font-bold border border-orange-100 animate-in fade-in">
                  <Sparkles size={12} /> 进度已保存
                  <button onClick={() => { setStory(null); setMediaProgress(0); }} className="ml-1 hover:text-rose-600"><Trash2 size={12} /></button>
                </div>
              )}
              <button onClick={() => setMobileSettingsOpen(true)} className="lg:hidden p-2 rounded-xl bg-slate-100 text-slate-600"><Settings2 size={20} /></button>
            </div>
          </header>

          <main className="flex-1 flex flex-col lg:flex-row">
            <div className="flex-1 p-6 md:p-16 flex flex-col items-center justify-center">
              <div className="w-full max-w-2xl space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="space-y-4 text-center lg:text-left">
                  <h1 className="text-3xl md:text-5xl font-black serif tracking-tight leading-tight">文字觉醒，<br/><span className="text-orange-600">视听重构</span></h1>
                </div>

                <form onSubmit={startGeneration} className="space-y-6">
                  <div className="grid gap-4">
                    <div className="relative group">
                      <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full pl-14 pr-4 py-6 rounded-3xl bg-white border-2 border-slate-100 focus:border-orange-500 outline-none text-xl font-bold shadow-xl shadow-slate-200/50 transition-all" placeholder="书籍名称" required disabled={status === LoadingStatus.GENERATING_MEDIA} />
                      <Library className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-orange-500" size={24} />
                    </div>
                    <div className="relative group">
                      <input value={author} onChange={(e) => setAuthor(e.target.value)} className="w-full pl-14 pr-4 py-6 rounded-3xl bg-white border-2 border-slate-100 focus:border-orange-500 outline-none text-xl font-bold shadow-xl shadow-slate-200/50 transition-all" placeholder="书籍作者" required disabled={status === LoadingStatus.GENERATING_MEDIA} />
                      <Feather className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-orange-500" size={24} />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 justify-center lg:justify-start">
                    {RECOMMENDED_BOOKS.map(b => (
                      <button key={b.title} type="button" onClick={() => { setTitle(b.title); setAuthor(b.author); }} className="px-4 py-2 rounded-full bg-slate-100 text-slate-500 text-xs font-black hover:bg-orange-500 hover:text-white transition-all">
                        {b.title}
                      </button>
                    ))}
                  </div>

                  {errorMessage && (
                    <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-3 text-rose-600 animate-in shake">
                      <AlertCircle className="shrink-0 mt-0.5" size={18} />
                      <div className="text-sm font-bold">{errorMessage}</div>
                    </div>
                  )}

                  <button type="submit" disabled={status === LoadingStatus.GENERATING_MEDIA || status === LoadingStatus.LOADING_SCRIPT} className="w-full py-6 rounded-[2.5rem] bg-slate-900 hover:bg-black text-white font-black text-xl flex items-center justify-center gap-4 shadow-2xl transition-all active:scale-[0.98]">
                    {status === LoadingStatus.GENERATING_MEDIA || status === LoadingStatus.LOADING_SCRIPT ? <Loader2 className="animate-spin" size={28} /> : <Wand2 size={28} />}
                    {status === LoadingStatus.ERROR ? '继续视听工程' : (story && story.title === title ? '继续生成' : '开启视听重构')}
                  </button>

                  {(status === LoadingStatus.GENERATING_MEDIA || status === LoadingStatus.LOADING_SCRIPT || retryInfo) && (
                    <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 space-y-4">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest">
                          {retryInfo ? <Timer className="text-rose-500 animate-pulse" size={14} /> : <Sparkles className="text-orange-500" size={14} />}
                          <span>{retryInfo ? `配额限制：冷却中 (${retryInfo.nextWait}s)` : (status === LoadingStatus.LOADING_SCRIPT ? '研读剧本中...' : '渲染视听中...')}</span>
                        </div>
                        <span className="text-orange-600 font-mono font-bold">{mediaProgress}%</span>
                      </div>
                      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full transition-all duration-1000 rounded-full ${retryInfo ? 'bg-rose-400' : 'bg-orange-500'}`} style={{ width: `${mediaProgress}%` }}></div>
                      </div>
                    </div>
                  )}
                </form>
              </div>
            </div>

            <aside className="hidden lg:block w-[450px] bg-white border-l border-slate-100 p-10 overflow-y-auto sticky top-24 h-[calc(100vh-88px)]">
              <SidebarContent />
            </aside>
          </main>

          {mobileSettingsOpen && (
            <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm animate-in fade-in lg:hidden">
              <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[2.5rem] p-8 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom-full duration-300">
                <SidebarContent />
                <button onClick={() => setMobileSettingsOpen(false)} className="w-full mt-4 py-4 rounded-2xl bg-slate-900 text-white font-bold">保存并返回</button>
              </div>
            </div>
          )}
        </div>
      )}

      {status === LoadingStatus.SUCCESS && story && (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-black overflow-hidden animate-in fade-in duration-1000">
          <nav className="absolute top-0 inset-x-0 z-50 p-6 flex justify-center pointer-events-none">
            <div className="flex gap-2 max-w-full overflow-x-auto pb-2 pointer-events-auto no-scrollbar bg-black/40 backdrop-blur-2xl border border-white/10 rounded-full p-2 pr-6">
              {story.scenes.map((s, idx) => (
                <button key={idx} onClick={() => playScene(idx)} className={`flex items-center gap-3 px-6 py-3 rounded-full transition-all whitespace-nowrap ${idx === currentSceneIndex ? 'bg-orange-500 text-white' : 'text-white/40'}`}>
                  <span className="font-mono text-[10px] opacity-30">{idx + 1}</span>
                  <span className="text-xs font-black tracking-tight">{s.summary}</span>
                </button>
              ))}
            </div>
          </nav>

          <div className="relative z-10 w-full max-w-6xl aspect-[16/10] px-4 md:px-8 flex items-center justify-center">
            <div className="w-full h-full rounded-[2.5rem] md:rounded-[4rem] overflow-hidden shadow-2xl border border-white/5 relative bg-neutral-900">
              {story.scenes.map((s, idx) => (
                <div key={idx} className={`absolute inset-0 transition-all duration-[1.5s] ${idx === currentSceneIndex ? 'opacity-100 scale-100' : 'opacity-0 scale-110 pointer-events-none'}`}>
                  {s.imageUrl && <img src={s.imageUrl} className={`w-full h-full object-cover transition-transform duration-[15s] ease-linear ${isPlaying ? 'scale-110' : 'scale-100'}`} />}
                </div>
              ))}
              <div className="absolute inset-x-0 bottom-0 p-12 md:p-24 bg-gradient-to-t from-black via-black/60 to-transparent flex flex-col items-center text-center">
                <div className={`transition-all duration-700 ${getEffectClasses()}`}>
                  <p className={`font-black leading-[1.3] tracking-tight ${settings.subtitleColor} ${settings.subtitleSize} ${settings.subtitleFont === 'serif' ? 'serif' : ''}`}>
                    {story.scenes[currentSceneIndex].text}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-20 mt-12 flex flex-col items-center gap-10">
            <div className="flex items-center gap-14">
              <button onClick={() => playScene(Math.max(0, currentSceneIndex - 1))} className="text-white/40 hover:text-white transition-all"><ChevronLeft size={48} /></button>
              <button onClick={togglePlay} className="w-24 h-24 rounded-full bg-white text-black flex items-center justify-center hover:scale-110 active:scale-95 transition-all">
                {isPlaying ? <Pause size={56} fill="black" /> : <Play size={56} className="ml-2" fill="black" />}
              </button>
              <button onClick={() => playScene(Math.min(story.scenes.length - 1, currentSceneIndex + 1))} className="text-white/40 hover:text-white transition-all"><ChevronRight size={48} /></button>
            </div>
            <button onClick={() => setStatus(LoadingStatus.IDLE)} className="text-white/20 text-xs font-black uppercase tracking-[0.3em] hover:text-orange-500 transition-all">
              <RotateCcw size={18} className="inline mr-2" /> 返回创作台
            </button>
          </div>
        </div>
      )}

      <style>{`
        .serif { font-family: 'Noto Serif SC', serif; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          background: #f97316;
          border-radius: 50%;
          cursor: pointer;
          border: 3px solid white;
          box-shadow: 0 4px 6px rgba(0,0,0,0.15);
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-in.shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  );
};

export default App;
