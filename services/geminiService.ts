
import { GoogleGenAI, Type } from "@google/genai";
import { BookStoryData } from "../types";

export const decomposeScriptToStory = async (title: string, author: string): Promise<BookStoryData> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    你是一位顶级的电影导演和读书博主。请为书籍《${title}》（${author}）创作一个沉浸式的动态影像脚本。
    
    任务流程：
    1. 构思一个贯穿全篇的视觉风格描述（例如：复古温暖的油画感、冷峻的未来主义、或柔和的东方水墨风）。
    2. 将书籍的核心内容拆解为至少 10 个连续的视觉段落（Scenes）。
    3. 每个段落必须包含：
       - text: 该段落的配音文案（约 50-80 字，富有感染力）。
       - summary: 该段落内容的极简提炼（严格控制在 8 个汉字以内，用于导航栏显示）。
       - imagePrompt: 针对该段落文案的详细画面描述，需符合第一步定义的风格。
    
    输出格式：严格的 JSON 对象。
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          author: { type: Type.STRING },
          styleDescription: { type: Type.STRING, description: "全篇统一的视觉风格定义" },
          scenes: {
            type: Type.ARRAY,
            minItems: 10,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                summary: { type: Type.STRING, description: "不超过8个字的场景提炼" },
                imagePrompt: { type: Type.STRING }
              },
              required: ["text", "summary", "imagePrompt"]
            }
          }
        },
        required: ["title", "author", "styleDescription", "scenes"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("AI 返回内容为空");
  return JSON.parse(text) as BookStoryData;
};
